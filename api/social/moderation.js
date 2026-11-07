import crypto from 'node:crypto';
import { SocialError } from './errors.js';
const fail = (status, code, message) => { throw new SocialError(status, code, message); };
const UUID = /^[a-f0-9-]{36}$/;
const REPORT = r => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, details: r.details, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });
export function createModeration({ db, active, policy, transaction, posts, cursors }) {
  const profile = id => db.prepare('SELECT account_id,handle,display_name,bio,avatar_id,social_epoch,created_at,updated_at FROM profiles WHERE account_id=?').get(id);
  const profileData = p => p ? { id: p.account_id, handle: p.handle, displayName: p.display_name, bio: p.bio, avatarId: p.avatar_id, createdAt: p.created_at, updatedAt: p.updated_at } : null;
  const get = id => { const r = db.prepare('SELECT * FROM reports WHERE id=?').get(id); if (!r) fail(404, 'report-missing', 'Report not found.'); return r; };
  const target = r => {
    const owner = profile(r.target_owner);
    if (!active(r.target_owner) || owner?.social_epoch !== r.target_epoch) return null;
    return r.target_type === 'post' ? posts.reviewPost(r.target_id) : profileData(owner);
  };
  return {
    report(viewer, body) {
      if (!body || !['profile', 'post'].includes(body.targetType) || typeof body.targetId !== 'string' || body.targetId.length > 64 || !UUID.test(body.requestId || '') ||
        !['spam', 'harassment', 'privacy', 'other'].includes(body.reason) || typeof body.details !== 'string' || body.details.length > 1000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(body.details)) fail(400, 'report-invalid', 'Invalid report.');
      const digest = crypto.createHash('sha256').update(JSON.stringify([body.targetType, body.targetId, body.reason, body.details.trim()])).digest('hex');
      const prior = db.prepare('SELECT * FROM reports WHERE reporter_id=? AND request_id=?').get(viewer, body.requestId);
      if (prior) {
        if (prior.request_digest !== digest) fail(409, 'request-conflict', 'This report request changed.');
        return { report: REPORT(prior) };
      }
      const owner = body.targetType === 'post' ? posts.getPost(viewer, body.targetId).authorId : body.targetId;
      const p = profile(owner);
      if (!p || !policy.canView(viewer, owner)) fail(404, 'target-missing', 'Content not found.');
      if (owner === viewer) fail(400, 'self-report', 'You cannot report your own content.');
      const duplicate = db.prepare('SELECT * FROM reports WHERE reporter_id=? AND target_type=? AND target_id=? AND target_epoch=?').get(viewer, body.targetType, body.targetId, p.social_epoch);
      if (duplicate) return { report: REPORT(duplicate) };
      const id = crypto.randomUUID(), at = Date.now();
      db.prepare('INSERT INTO reports(id,reporter_id,target_type,target_id,target_owner,target_epoch,reason,details,request_id,request_digest,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, viewer, body.targetType, body.targetId, owner, p.social_epoch, body.reason, body.details.trim(), body.requestId, digest, at, at);
      return { report: REPORT(get(id)) };
    },
    reports(admin, { cursor, limit = 20 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, 'limit-invalid', 'Invalid page size.');
      const context = JSON.stringify(['reports', admin]);
      const at = cursor ? cursors.decode(cursor, context) : { time: Number.MAX_SAFE_INTEGER, id: 'z' };
      if (!Number.isSafeInteger(at.time) || typeof at.id !== 'string') fail(400, 'cursor-invalid', 'Reload this list to continue.');
      const rows = db.prepare('SELECT * FROM reports WHERE created_at<? OR (created_at=? AND id<?) ORDER BY created_at DESC,id DESC LIMIT ?').all(at.time, at.time, at.id, limit + 1);
      return { viewerId: admin, reports: rows.slice(0, limit).map(r => ({ ...REPORT(r), reporterId: r.reporter_id })),
        nextCursor: rows.length > limit ? cursors.encode({ context, time: rows[limit - 1].created_at, id: rows[limit - 1].id }) : null };
    },
    reviewReport(id) { const r = get(id), data = target(r); return { report: { ...REPORT(r), reporterId: r.reporter_id }, target: data }; },
    reportPhoto(id) {
      const r = get(id), data = target(r); if (!data) return null;
      return r.target_type === 'post' ? posts.reviewPhoto(r.target_id) : db.prepare('SELECT avatar FROM profiles WHERE account_id=?').get(r.target_owner)?.avatar;
    },
    resolveReport(id, action) {
      if (!['dismiss', 'remove'].includes(action)) fail(400, 'report-invalid', 'Invalid moderation action.');
      const r = get(id);
      if (r.status !== 'open') return this.reviewReport(id);
      const oldPhoto = r.target_type === 'post' ? posts.reviewPost(r.target_id)?.assetId : null;
      transaction(() => {
        if (action === 'remove') {
          const current = profile(r.target_owner);
          if (current && current.social_epoch !== r.target_epoch) fail(409, 'target-changed', 'This profile was recreated. Review the current content separately.');
          if (r.target_type === 'post') db.prepare('DELETE FROM posts WHERE id=? AND author_id=?').run(r.target_id, r.target_owner);
          else {
            db.prepare('DELETE FROM posts WHERE author_id=?').run(r.target_owner);
            db.prepare('DELETE FROM profiles WHERE account_id=?').run(r.target_owner);
          }
        }
        db.prepare('UPDATE reports SET status=?,updated_at=? WHERE id=?').run(action === 'remove' ? 'removed' : 'dismissed', Date.now(), id);
      });
      if (action === 'remove' && oldPhoto) posts.discardPostAsset(r.target_owner, oldPhoto);
      posts.sweepPostAssets();
      return this.reviewReport(id);
    },
    exportSocial(viewer, section, { cursor, limit = 50 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, 'limit-invalid', 'Invalid page size.');
      if (section === 'profile') {
        if (cursor) fail(400, 'cursor-invalid', 'Invalid profile cursor.');
        return { ownerId: viewer, items: [profileData(profile(viewer))], nextCursor: null };
      }
      if (section === 'posts') { const p = posts.exportPosts(viewer, { cursor, limit }); return { ownerId: viewer, items: p.posts, nextCursor: p.nextCursor }; }
      const queries = {
        following: ['SELECT followed_id id,created_at createdAt FROM follows WHERE follower_id=? AND followed_id>? ORDER BY followed_id LIMIT ?', 'id'],
        followers: ['SELECT follower_id id,created_at createdAt FROM follows WHERE followed_id=? AND follower_id>? ORDER BY follower_id LIMIT ?', 'id'],
        blocks: ['SELECT blocked_id id,created_at createdAt FROM blocks WHERE blocker_id=? AND blocked_id>? ORDER BY blocked_id LIMIT ?', 'id'],
        reports: ['SELECT * FROM reports WHERE reporter_id=? AND id>? ORDER BY id LIMIT ?', 'id']
      };
      if (!queries[section]) fail(400, 'export-invalid', 'Invalid export section.');
      const context = JSON.stringify(['export', viewer, section]), at = cursor ? cursors.decode(cursor, context).after : '';
      if (typeof at !== 'string' || at.length > 64) fail(400, 'cursor-invalid', 'Invalid export cursor.');
      const rows = db.prepare(queries[section][0]).all(viewer, at, limit + 1);
      return { ownerId: viewer, items: rows.slice(0, limit).map(r => section === 'reports' ? REPORT(r) : r),
        nextCursor: rows.length > limit ? cursors.encode({ context, after: rows[limit - 1].id }) : null };
    }
  };
}
