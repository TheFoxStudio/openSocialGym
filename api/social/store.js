// Social identity is opt-in and separate from the private training documents.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSocialPolicy } from './policy.js';
import { createSocialGraph } from './graph.js';
import { createPosts } from './posts.js';
import { SocialError } from './errors.js';
import { createCursorCodec } from './cursors.js';
import { createModeration } from './moderation.js';
export { SocialError } from './errors.js';

const fail = (status, code, message) => { throw new SocialError(status, code, message); };
const RESERVED = new Set(['admin', 'administrator', 'api', 'help', 'me', 'opengym', 'opensocialgym', 'settings', 'support', 'system']);
export function profileFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'profile-invalid', 'Invalid profile.');
  const { handle, displayName, bio } = body;
  if (typeof handle !== 'string' || !/^[a-zA-Z0-9_]{3,30}$/.test(handle) || RESERVED.has(handle.toLowerCase())) {
    fail(400, 'handle-invalid', 'Use 3–30 letters, numbers or underscores and choose a non-reserved handle.');
  }
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 60 || /[\x00-\x1f\x7f]/.test(displayName)) {
    fail(400, 'name-invalid', 'Display name must contain 1–60 characters.');
  }
  if (typeof bio !== 'string' || bio.trim().length > 300 || /[\x00-\x08\x0b-\x1f\x7f]/.test(bio)) fail(400, 'bio-invalid', 'Bio must contain at most 300 characters.');
  return { handle: handle.toLowerCase(), displayName: displayName.trim(), bio: bio.trim() };
}

export function createSocialStore({ dataDir, accountExists, accountVisible = accountExists }) {
  const dir = path.join(dataDir, 'social');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'social.sqlite');
  const db = new DatabaseSync(file);
  try { fs.chmodSync(file, 0o600); } catch { /* host filesystem may not support Unix modes */ }
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 4) { db.close(); throw new Error('Social database is newer than this server; restore a compatible version.'); }
  if (version === 0) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE profiles (
      account_id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL, bio TEXT NOT NULL,
      avatar BLOB, avatar_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1
    );
    PRAGMA user_version=1;
    COMMIT;`);
  if (version < 2) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`ALTER TABLE profiles ADD COLUMN search_name TEXT NOT NULL DEFAULT '';
    CREATE TABLE follows (
      follower_id TEXT NOT NULL REFERENCES profiles(account_id) ON DELETE CASCADE,
      followed_id TEXT NOT NULL REFERENCES profiles(account_id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, PRIMARY KEY(follower_id,followed_id), CHECK(follower_id<>followed_id)
    );
    CREATE INDEX follows_reverse ON follows(followed_id,follower_id);
    CREATE TABLE blocks (
      blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id<>blocked_id)
    );
    CREATE INDEX blocks_reverse ON blocks(blocked_id,blocker_id);
    CREATE INDEX profiles_name ON profiles(search_name COLLATE NOCASE);`);
      for (const p of db.prepare('SELECT account_id, display_name FROM profiles').all()) {
        db.prepare('UPDATE profiles SET search_name=? WHERE account_id=?').run(p.display_name.normalize('NFKC').toLowerCase(), p.account_id);
      }
      db.exec('PRAGMA user_version=2; COMMIT;');
    } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
  }
  const active = uid => accountVisible(uid);
  if (version < 3) {
    try {
    db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE profiles ADD COLUMN social_epoch TEXT NOT NULL DEFAULT '';
    CREATE TABLE post_assets (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES profiles(account_id) ON DELETE CASCADE,
      digest TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX post_assets_owner ON post_assets(owner_id);
    CREATE TABLE posts (
      id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES profiles(account_id) ON DELETE CASCADE,
      source_id TEXT NOT NULL, snapshot TEXT NOT NULL, caption TEXT NOT NULL, audience TEXT NOT NULL,
      asset_id TEXT REFERENCES post_assets(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, UNIQUE(author_id, source_id)
    );
    CREATE INDEX posts_author_date ON posts(author_id, created_at DESC, id DESC);
    CREATE UNIQUE INDEX posts_asset ON posts(asset_id) WHERE asset_id IS NOT NULL;
    CREATE TABLE publish_requests (
      author_id TEXT NOT NULL REFERENCES profiles(account_id) ON DELETE CASCADE,
      request_id TEXT NOT NULL, digest TEXT NOT NULL, post_id TEXT NOT NULL,
      PRIMARY KEY(author_id, request_id)
    );
    PRAGMA user_version=3;`);
    for (const p of db.prepare('SELECT account_id FROM profiles').all()) db.prepare('UPDATE profiles SET social_epoch=? WHERE account_id=?').run(crypto.randomUUID(), p.account_id);
    db.exec('COMMIT;');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} db.close(); throw e; }
  }
  if (version < 4) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`ALTER TABLE posts ADD COLUMN publication_seq INTEGER;
        UPDATE posts SET publication_seq=rowid;
        CREATE UNIQUE INDEX posts_sequence ON posts(publication_seq);
        CREATE TABLE social_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        INSERT INTO social_meta SELECT 'post_sequence',CAST(coalesce(max(publication_seq),0) AS TEXT) FROM posts;
        CREATE TABLE reports (
          id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,
          target_owner TEXT NOT NULL,target_epoch TEXT NOT NULL,reason TEXT NOT NULL,details TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',
          request_id TEXT NOT NULL,request_digest TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
          UNIQUE(reporter_id,request_id),UNIQUE(reporter_id,target_type,target_id,target_epoch)
        );
        CREATE INDEX reports_date ON reports(created_at DESC,id DESC);
        CREATE INDEX reports_owner ON reports(target_owner);`);
      db.prepare('INSERT INTO social_meta VALUES(?,?)').run('cursor_key', crypto.randomBytes(32).toString('hex'));
      db.exec('PRAGMA user_version=4; COMMIT;');
    } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
  }
  const cursors = createCursorCodec(db.prepare("SELECT value FROM social_meta WHERE key='cursor_key'").get().value);
  const row = uid => active(uid) ? db.prepare('SELECT * FROM profiles WHERE account_id=?').get(uid) : null;
  const project = r => r ? { id: r.account_id, handle: r.handle, displayName: r.display_name, bio: r.bio,
    avatarId: r.avatar_id, createdAt: r.created_at, updatedAt: r.updated_at, revision: r.revision, socialEpoch: r.social_epoch } : null;
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); db.exec('COMMIT'); return out; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  const requireAccount = uid => { if (!active(uid)) fail(401, 'not-signed-in', 'Not signed in.'); };
  const policy = createSocialPolicy({ db, active });
  const graph = createSocialGraph({ db, active, row, project, policy, transaction });
  const posts = createPosts({ db, active, policy, transaction, dataDir: dir, cursors });
  const moderation = createModeration({ db, active, policy, transaction, posts, cursors });
  // A crash after account JSON was saved but before cleanup is repaired on next boot.
  for (const r of db.prepare('SELECT account_id FROM profiles').all()) {
    if (!accountExists(r.account_id)) { db.prepare('DELETE FROM posts WHERE author_id=?').run(r.account_id); db.prepare('DELETE FROM profiles WHERE account_id=?').run(r.account_id); }
  }
  for (const r of db.prepare('SELECT blocker_id, blocked_id FROM blocks').all()) {
    if (!accountExists(r.blocker_id) || !accountExists(r.blocked_id)) db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(r.blocker_id, r.blocked_id);
  }
  for (const r of db.prepare('SELECT DISTINCT reporter_id,target_owner FROM reports').all()) {
    if (!accountExists(r.reporter_id)) db.prepare('DELETE FROM reports WHERE reporter_id=?').run(r.reporter_id);
    if (!accountExists(r.target_owner)) db.prepare('DELETE FROM reports WHERE target_owner=?').run(r.target_owner);
  }
  posts.sweepPostAssets();
  return {
    ...graph,
    ...posts,
    ...moderation,
    get(uid, viewer = uid) { return policy.canView(viewer, uid) ? project(row(uid)) : null; },
    save(uid, body) {
      requireAccount(uid);
      const fields = profileFields(body);
      return transaction(() => {
        const old = row(uid);
        if (!old && body.accepted !== true) fail(400, 'opt-in-required', 'Confirm that your profile will be visible to server members.');
        if (old && body.revision !== old.revision) fail(409, 'profile-conflict', 'Your profile changed. Reload before saving.');
        const taken = db.prepare('SELECT account_id FROM profiles WHERE handle=? COLLATE NOCASE').get(fields.handle);
        if (taken && taken.account_id !== uid) fail(409, 'handle-taken', 'That handle is already taken.');
        const now = Date.now();
        const nameKey = fields.displayName.normalize('NFKC').toLowerCase();
        if (old) db.prepare('UPDATE profiles SET handle=?, display_name=?, search_name=?, bio=?, updated_at=?, revision=revision+1 WHERE account_id=?')
          .run(fields.handle, fields.displayName, nameKey, fields.bio, now, uid);
        else db.prepare('INSERT INTO profiles(account_id,handle,display_name,search_name,bio,created_at,updated_at,social_epoch) VALUES(?,?,?,?,?,?,?,?)')
          .run(uid, fields.handle, fields.displayName, nameKey, fields.bio, now, now, crypto.randomUUID());
        return project(row(uid));
      });
    },
    setAvatar(uid, bytes) {
      requireAccount(uid);
      if (!row(uid)) fail(409, 'profile-required', 'Create your profile first.');
      if (bytes && bytes.length > 256 * 1024) fail(413, 'avatar-too-large', 'Processed avatar is too large.');
      db.prepare('UPDATE profiles SET avatar=?, avatar_id=?, updated_at=?, revision=revision+1 WHERE account_id=?')
        .run(bytes || null, bytes ? crypto.randomUUID() : null, Date.now(), uid);
      return project(row(uid));
    },
    avatar(uid, id, viewer = uid) {
      if (!policy.canView(viewer, uid)) return null;
      const r = row(uid);
      return r && r.avatar_id === id && r.avatar ? Buffer.from(r.avatar) : null;
    },
    remove(uid, { accountDeleted = false } = {}) {
      transaction(() => {
        // Assets reference profiles, while posts reference assets: remove the posts first.
        db.prepare('DELETE FROM posts WHERE author_id=?').run(uid);
        db.prepare('DELETE FROM profiles WHERE account_id=?').run(uid);
        if (accountDeleted) db.prepare('DELETE FROM blocks WHERE blocker_id=? OR blocked_id=?').run(uid, uid);
        if (accountDeleted) db.prepare('DELETE FROM reports WHERE reporter_id=? OR target_owner=?').run(uid, uid);
      });
      posts.sweepPostAssets();
    },
    // VACUUM INTO takes a consistent database snapshot, including transactional avatar bytes.
    backup(destination) { db.prepare('VACUUM INTO ?').run(destination); },
    close() { db.close(); }
  };
}
