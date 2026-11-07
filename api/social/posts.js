import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite } from '../durable.js';
import { SocialError } from './errors.js';
import { postFields } from './snapshot.js';
import { socialVolume } from './metrics.js';
import { engagementSummary } from './engagement.js';

const fail = (status, code, message) => { throw new SocialError(status, code, message); };
const UUID = /^[a-f0-9-]{36}$/;
export function createPosts({ db, active, policy, transaction, dataDir, cursors, now = Date.now }) {
  const dir = path.join(dataDir, 'post-photos');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const profileExists = id => active(id) && !!db.prepare('SELECT 1 FROM profiles WHERE account_id=?').get(id);
  const requireAuthor = id => { if (!profileExists(id)) fail(409, 'profile-required', 'Create your profile first.'); };
  const row = id => db.prepare('SELECT * FROM posts WHERE id=?').get(id);
  const visible = (viewer, p) => !!p && profileExists(p.author_id) && policy.canView(viewer, p.author_id) && (viewer === p.author_id || p.audience === 'members' ||
    !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?').get(viewer, p.author_id));
  const authorOf = id => {
    const a = db.prepare('SELECT account_id,handle,display_name,avatar_id FROM profiles WHERE account_id=?').get(id);
    return a ? { id: a.account_id, handle: a.handle, displayName: a.display_name, avatarId: a.avatar_id } : null;
  };
  const project = (p, viewer = p.author_id) => ({ id: p.id, authorId: p.author_id, author: authorOf(p.author_id), ...(viewer === p.author_id ? { sourceWorkoutId: p.source_id } : {}), snapshot: JSON.parse(p.snapshot), caption: p.caption,
    audience: p.audience, assetId: p.asset_id, createdAt: p.created_at, updatedAt: p.updated_at, revision: p.revision,
    engagement:engagementSummary(db,viewer,p.id) });
  const owned = (author, id) => { const p = row(id); if (!p || p.author_id !== author) fail(404, 'post-missing', 'Post not found.'); return p; };
  const linked = asset => !!db.prepare('SELECT 1 FROM posts WHERE asset_id=?').get(asset);
  const file = id => path.join(dir, id + '.webp');
  const mutate = (author, input, id = null) => {
    requireAuthor(author);
    const fields = postFields(input);
    if (db.prepare('SELECT social_epoch FROM profiles WHERE account_id=?').get(author)?.social_epoch !== fields.profileEpoch) fail(409, 'profile-changed', 'Your social profile changed. Review this post again.');
    const digest = crypto.createHash('sha256').update(JSON.stringify({ ...fields, requestId: undefined, postId: id, revision: id ? input.revision : null })).digest('hex');
    return transaction(() => {
      const prior = db.prepare('SELECT * FROM publish_requests WHERE author_id=? AND request_id=?').get(author, fields.requestId);
      if (prior) {
        if (prior.digest !== digest) fail(409, 'request-conflict', 'This publish request has changed.');
        const p = row(prior.post_id);
        if (!p) fail(410, 'post-deleted', 'This post was deleted. Start a new post to publish again.');
        return project(p);
      }
      const old = id ? owned(author, id) : null;
      if (old && (input.revision !== old.revision || fields.sourceWorkoutId !== old.source_id)) fail(409, 'post-conflict', 'This post changed. Reload before saving.');
      if (!old && db.prepare('SELECT 1 FROM posts WHERE author_id=? AND source_id=?').get(author, fields.sourceWorkoutId)) fail(409, 'post-exists', 'This workout already has a post. Open it to edit.');
      if (fields.assetId) {
        const asset = db.prepare('SELECT * FROM post_assets WHERE id=? AND owner_id=?').get(fields.assetId, author);
        const used = db.prepare('SELECT id FROM posts WHERE asset_id=?').get(fields.assetId);
        if (!asset || !fs.existsSync(file(fields.assetId)) || (used && used.id !== id)) fail(400, 'photo-missing', 'Upload your selected photo again.');
      }
      const postId = old?.id || crypto.randomUUID(), at = now();
      if (old) db.prepare('UPDATE posts SET snapshot=?,caption=?,audience=?,asset_id=?,updated_at=?,revision=revision+1 WHERE id=?')
        .run(JSON.stringify(fields.snapshot), fields.caption, fields.audience, fields.assetId, at, postId);
      else {
        db.exec("UPDATE social_meta SET value=CAST(value AS INTEGER)+1 WHERE key='post_sequence'");
        const seq = +db.prepare("SELECT value FROM social_meta WHERE key='post_sequence'").get().value;
        db.prepare('INSERT INTO posts(id,author_id,source_id,snapshot,caption,audience,asset_id,created_at,updated_at,publication_seq) VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(postId, author, fields.sourceWorkoutId, JSON.stringify(fields.snapshot), fields.caption, fields.audience, fields.assetId, at, at, seq);
      }
      db.prepare('INSERT INTO publish_requests(author_id,request_id,digest,post_id) VALUES(?,?,?,?)').run(author, fields.requestId, digest, postId);
      return project(row(postId));
    });
  };
  const inFeed = (viewer, p) => visible(viewer, p) && (p.author_id === viewer || !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?').get(viewer, p.author_id));
  const page = (viewer, author, { cursor, limit = 20 } = {}) => {
    if (!active(viewer)) fail(401, 'not-signed-in', 'Not signed in.');
    if (author && (!profileExists(author) || !policy.canView(viewer, author))) fail(404, 'profile-missing', 'Profile not found.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, 'limit-invalid', 'Invalid page size.');
    const context = JSON.stringify(['posts-workout-date-v1', viewer, author || 'feed']);
    const position = cursor ? cursors.decode(cursor, context) : { date:'9999-12-31', time: Number.MAX_SAFE_INTEGER, id: 'z', ceiling: +db.prepare("SELECT value FROM social_meta WHERE key='post_sequence'").get().value };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(position.date) || !Number.isSafeInteger(position.time) || !Number.isSafeInteger(position.ceiling) || position.ceiling < 0 || typeof position.id !== 'string') fail(400, 'cursor-invalid', 'Reload this list to continue.');
    const target = author ? 'p.author_id=?' : 'p.author_id IN (SELECT followed_id FROM follows WHERE follower_id=? UNION SELECT ?)';
    const args = author ? [author] : [viewer, viewer];
    const all = db.prepare(`SELECT p.* FROM posts p INDEXED BY posts_author_workout_date WHERE ${target}
      AND p.publication_seq<=? AND (json_extract(p.snapshot,'$.date'),p.created_at,p.id)<(?,?,?) ORDER BY json_extract(p.snapshot,'$.date') DESC,p.created_at DESC,p.id DESC LIMIT 201`)
      .all(...args, position.ceiling, position.date, position.time, position.id);
    const posts = []; let scanned = 0, last;
    for (const p of all.slice(0, 200)) { scanned++; last = p; if (author ? visible(viewer, p) : inFeed(viewer, p)) posts.push(project(p, viewer)); if (posts.length === limit) break; }
    return { viewerId: viewer, posts, nextCursor: scanned < all.length ? cursors.encode({ context, ceiling: position.ceiling, date:JSON.parse(last.snapshot).date, time: last.created_at, id: last.id }) : null };
  };
  return {
    reviewPost(id) { const p = row(id); return p ? project(p, '') : null; },
    reviewPhoto(id) { const p = row(id); if (!p?.asset_id) return null; try { return fs.readFileSync(file(p.asset_id)); } catch { return null; } },
    exportPosts(viewer, options) { return profileExists(viewer) ? page(viewer, viewer, options) : { viewerId: viewer, posts: [], nextCursor: null }; },
    feed(viewer, options) { return page(viewer, null, options); },
    checkFeed(viewer, ids) {
      if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== 'string' || !UUID.test(id))) fail(400, 'posts-invalid', 'Invalid post list.');
      return { viewerId: viewer, posts: [...new Set(ids)].map(row).filter(p => inFeed(viewer, p)).map(p => project(p, viewer)) };
    },
    publishPost(author, input) { return mutate(author, input); },
    editPost(author, id, input) {
      const old = row(id), post = mutate(author, input, id);
      if (old?.author_id === author && old.asset_id && old.asset_id !== post.assetId) this.discardPostAsset(author, old.asset_id);
      return post;
    },
    getPost(viewer, id) { const p = row(id); if (!visible(viewer, p)) fail(404, 'post-missing', 'Post not found.'); return project(p, viewer); },
    ownPost(author, source) { const p = db.prepare('SELECT * FROM posts WHERE author_id=? AND source_id=?').get(author, source); return p ? project(p) : null; },
    deletePost(author, id) {
      const p = owned(author, id); db.prepare('DELETE FROM posts WHERE id=?').run(id);
      if (p.asset_id) this.discardPostAsset(author, p.asset_id);
    },
    profileOverview(viewer, author) {
      if (!profileExists(author) || !policy.canView(viewer, author)) fail(404,'profile-missing','Profile not found.');
      let totalWorkouts=0,totalVolumeKg=0;const photos=[];
      for(const p of db.prepare("SELECT * FROM posts WHERE author_id=? ORDER BY json_extract(snapshot,'$.date') DESC,created_at DESC,id DESC").iterate(author)) {
        if(!visible(viewer,p))continue;
        totalWorkouts++;const volume=socialVolume(JSON.parse(p.snapshot),'kg');
        totalVolumeKg+=volume.value*(volume.unit==='lb'?0.45359237:1);
        if(p.asset_id&&photos.length<4)photos.push(project(p,viewer));
      }
      return {totalWorkouts,totalVolumeKg,photos};
    },
    profilePosts(viewer, author, options) { return page(viewer, author, options); },
    putPostAsset(author, id, bytes, digest) {
      requireAuthor(author);
      if (!UUID.test(id) || !bytes.length || bytes.length > 1024 * 1024) fail(400, 'photo-invalid', 'Invalid workout photo.');
      const old = db.prepare('SELECT * FROM post_assets WHERE id=?').get(id);
      if (old) {
        if (old.owner_id !== author || old.digest !== digest) fail(409, 'photo-conflict', 'Choose this photo again.');
        if (!fs.existsSync(file(id))) atomicWrite(file(id), bytes, 0o600);
        return { assetId: id };
      }
      const stats = db.prepare('SELECT coalesce(sum(size),0) bytes, count(*) n FROM post_assets WHERE owner_id=?').get(author);
      const pending = db.prepare('SELECT count(*) n FROM post_assets a WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM posts p WHERE p.asset_id=a.id)').get(author).n;
      if (stats.bytes + bytes.length > 100 * 1024 * 1024 || pending >= 10) fail(413, 'photo-quota', 'Your workout photo storage is full.');
      const disk = fs.statfsSync(dir);
      if (disk.bavail * disk.bsize < bytes.length + 16 * 1024 * 1024) fail(507, 'storage-full', 'The server is running out of photo storage.');
      // Bytes are durable before the referencing row. A crash leaves an orphan file which GC
      // can remove; it never leaves an acknowledged database row with an incomplete file.
      atomicWrite(file(id), bytes, 0o600);
      try { db.prepare('INSERT INTO post_assets(id,owner_id,digest,size,created_at) VALUES(?,?,?,?,?)').run(id, author, digest, bytes.length, now()); }
      catch (e) { try { fs.unlinkSync(file(id)); } catch {} throw e; }
      return { assetId: id };
    },
    postPhoto(viewer, id) {
      const p = row(id);
      if (!visible(viewer, p) || !p.asset_id) fail(404, 'photo-missing', 'Photo not found.');
      try { return fs.readFileSync(file(p.asset_id)); } catch { fail(404, 'photo-missing', 'Photo not found.'); }
    },
    discardPostAsset(author, id) {
      const asset = db.prepare('SELECT owner_id FROM post_assets WHERE id=?').get(id);
      if (!asset || asset.owner_id !== author || linked(id)) return;
      db.prepare('DELETE FROM post_assets WHERE id=?').run(id);
      try { fs.unlinkSync(file(id)); } catch {}
    },
    sweepPostAssets() {
      for (const a of db.prepare('SELECT id,created_at FROM post_assets').all()) {
        if (now() - a.created_at > 86400000 && !linked(a.id)) { db.prepare('DELETE FROM post_assets WHERE id=?').run(a.id); try { fs.unlinkSync(file(a.id)); } catch {} }
      }
      for (const name of fs.readdirSync(dir)) {
        if (!/^[a-f0-9-]{36}\.webp(?:\.tmp)?$/.test(name)) continue;
        const id = name.slice(0, 36);
        if (!db.prepare('SELECT 1 FROM post_assets WHERE id=?').get(id)) { try { fs.unlinkSync(path.join(dir, name)); } catch {} }
      }
    }
  };
}
