import { SocialError } from './store.js';

const fail = (status, code, message) => { throw new SocialError(status, code, message); };
const COLUMNS = 'p.account_id, p.handle, p.display_name, p.bio, p.avatar_id, p.created_at, p.updated_at, p.revision, p.social_epoch';
// Cursors bind the query, viewer and list being paged. They carry no authorization;
// current membership/block rules are always checked again for each candidate.
function decodeCursor(cursor, context) {
  if (!cursor) return '';
  try {
    if (typeof cursor !== 'string' || cursor.length > 1000) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (value.context !== context || typeof value.after !== 'string' || value.after.length > 64) throw new Error();
    return value.after;
  } catch { fail(400, 'cursor-invalid', 'Reload this list to continue.'); }
}

export function createSocialGraph({ db, active, row, project, policy, transaction }) {
  const visible = (viewer, id) => policy.canView(viewer, id) && !!db.prepare('SELECT 1 FROM profiles WHERE account_id=?').get(id);
  const requireVisible = (viewer, target) => {
    if (!visible(viewer, target)) fail(404, 'profile-missing', 'Profile not found.');
  };
  const requireProfile = viewer => {
    if (!active(viewer)) fail(401, 'not-signed-in', 'Not signed in.');
    if (!row(viewer)) fail(409, 'profile-required', 'Create your profile first.');
  };
  // Bound database work even if many disabled accounts/blocks must be filtered in JS.
  // Advance past scanned invisible rows so subsequent pages cannot get stuck on them.
  const page = (viewer, context, { cursor, limit = 20 } = {}, query) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, 'limit-invalid', 'Page size must be 1–50.');
    const after = decodeCursor(cursor, context);
    const candidates = query(after, 201);
    const items = [];
    let last = after, consumed = 0;
    for (const p of candidates.slice(0, 200)) {
      last = p.account_id; consumed++;
      if (visible(viewer, p.account_id)) items.push(project(p));
      if (items.length === limit) break;
    }
    const more = consumed < candidates.length;
    return { people: items, nextCursor: more ? Buffer.from(JSON.stringify({ context, after: last })).toString('base64url') : null };
  };
  return {
    relationship(viewer, target) {
      requireVisible(viewer, target);
      const count = direction => {
        const col = direction === 'followers' ? 'follower_id' : 'followed_id';
        const own = direction === 'followers' ? 'followed_id' : 'follower_id';
        return db.prepare(`SELECT ${col} id FROM follows WHERE ${own}=?`).all(target)
          .filter(r => visible(viewer, r.id) && visible(target, r.id)).length;
      };
      return {
        isFollowing: !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?').get(viewer, target),
        isFollowedBy: !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?').get(target, viewer),
        followerCount: count('followers'), followingCount: count('following')
      };
    },
    people(viewer, q, options) {
      if (typeof q !== 'string' || q.trim().length > 60) fail(400, 'query-invalid', 'Search must contain at most 60 characters.');
      const term = q.trim().replace(/^@/, '').normalize('NFKC').toLowerCase();
      const needle = term.replace(/[\\%_]/g, ch => '\\' + ch) + '%';
      return page(viewer, JSON.stringify(['people', viewer, term]), options, (after, cap) => db.prepare(`SELECT ${COLUMNS} FROM profiles p
        WHERE p.account_id>? AND p.account_id<>? AND (p.handle LIKE ? ESCAPE '\\' OR p.search_name LIKE ? ESCAPE '\\')
        ORDER BY p.account_id LIMIT ?`).all(after, viewer, needle, needle, cap));
    },
    list(viewer, target, kind, options) {
      requireVisible(viewer, target);
      if (!['followers', 'following'].includes(kind)) fail(400, 'list-invalid', 'Invalid member list.');
      const col = kind === 'followers' ? 'follower_id' : 'followed_id';
      const own = kind === 'followers' ? 'followed_id' : 'follower_id';
      return page(viewer, JSON.stringify([kind, viewer, target]), options, (after, cap) => db.prepare(`SELECT ${COLUMNS}
        FROM follows f JOIN profiles p ON p.account_id=f.${col}
        WHERE f.${own}=? AND p.account_id>? ORDER BY p.account_id LIMIT ?`).all(target, after, cap));
    },
    follow(viewer, target, enabled) {
      requireProfile(viewer); requireVisible(viewer, target);
      if (viewer === target) fail(400, 'self-follow', 'You cannot follow yourself.');
      if (enabled) db.prepare('INSERT OR IGNORE INTO follows(follower_id,followed_id,created_at) VALUES(?,?,?)').run(viewer, target, Date.now());
      else db.prepare('DELETE FROM follows WHERE follower_id=? AND followed_id=?').run(viewer, target);
      return this.relationship(viewer, target);
    },
    block(viewer, target, enabled) {
      if (!active(viewer)) fail(401, 'not-signed-in', 'Not signed in.');
      if (viewer === target) fail(400, 'self-block', 'You cannot block yourself.');
      if (!enabled) { db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(viewer, target); return; }
      // A repeated block is idempotent even though the target is now hidden.
      if (db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(viewer, target)) return;
      requireVisible(viewer, target);
      transaction(() => {
        db.prepare('INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)').run(viewer, target, Date.now());
        db.prepare('DELETE FROM follows WHERE (follower_id=? AND followed_id=?) OR (follower_id=? AND followed_id=?)').run(viewer, target, target, viewer);
      });
    },
    blocks(viewer, options = {}) {
      // Deliberate exception: only the blocker can see their own management list.
      // No bios or avatar grants; retain the ID to permit unblocking after opt-out.
      const context = JSON.stringify(['blocks', viewer]);
      const after = decodeCursor(options.cursor, context), limit = options.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, 'limit-invalid', 'Page size must be 1–50.');
      const all = db.prepare(`SELECT b.blocked_id id, p.handle, p.display_name displayName FROM blocks b
        LEFT JOIN profiles p ON p.account_id=b.blocked_id WHERE b.blocker_id=? AND b.blocked_id>? ORDER BY b.blocked_id LIMIT ?`).all(viewer, after, limit + 1);
      return { people: all.slice(0, limit).map(r => ({ id: r.id, handle: r.handle, displayName: r.displayName })),
        nextCursor: all.length > limit ? Buffer.from(JSON.stringify({ context, after: all[limit - 1].id })).toString('base64url') : null };
    }
  };
}
