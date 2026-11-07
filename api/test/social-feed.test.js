import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createSocialStore } from '../social/store.js';
import { createCursorCodec } from '../social/cursors.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-feed-')), accounts = new Set(['one', 'two', 'three']);
  const s = createSocialStore({ dataDir: dir, accountExists: id => accounts.has(id) });
  for (const id of accounts) s.save(id, { handle: 'lifter_' + id, displayName: id, bio: '', accepted: true });
  t.after(() => { s.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const body = (id, source, patch = {}) => ({ requestId: crypto.randomUUID(), sourceWorkoutId: source, caption: source, audience: 'members', assetId: null,
    profileEpoch: s.get(id).socialEpoch, snapshot: { version: 1, title: 'Squats', date: '2026-11-06', durationSec: 60, exercises: [{ name: 'Squat', unit: 'kg', sets: [{ mode: 'reps', type: 'straight', reps: 5, weight: 80 }] }] }, ...patch });
  return { s, dir, accounts, body, publish: (id, source, patch) => s.publishPost(id, body(id, source, patch)) };
}
test('following feed includes self and friends, rechecks edits, follows, blocks and account visibility', t => {
  const h = fixture(t), { s } = h;
  const own = h.publish('one', 'own'), friend = h.publish('two', 'friend', { audience: 'followers' }); h.publish('three', 'stranger');
  assert.deepEqual(s.feed('one').posts.map(p => p.id), [own.id]);
  s.follow('one', 'two', true);
  assert.equal(s.feed('one').posts.length, 2);
  const seen = s.checkFeed('one', [friend.id, own.id, friend.id]); assert.equal(seen.posts.length, 2);
  assert.equal(seen.posts[0].sourceWorkoutId, undefined); assert.equal(seen.posts[0].author.displayName, 'two');
  s.editPost('two', friend.id, h.body('two', 'friend', { revision: 1, caption: 'changed' }));
  assert.equal(s.checkFeed('one', [friend.id]).posts[0].caption, 'changed');
  s.follow('one', 'two', false); assert.deepEqual(s.checkFeed('one', [friend.id]).posts, []);
  s.follow('one', 'two', true); s.block('two', 'one', true); assert.deepEqual(s.checkFeed('one', [friend.id]).posts, []);
  h.accounts.delete('one'); assert.throws(() => s.feed('one'), { status: 401 });
  assert.throws(() => s.checkFeed('two', Array(51).fill(own.id)), { status: 400 });
});
test('feed pagination has a stable publication ceiling, deterministic ties and scoped opaque cursors', t => {
  const h = fixture(t), { s } = h; s.follow('one', 'two', true);
  const originals = Array.from({ length: 8 }, (_, i) => h.publish('two', 'original-' + i));
  const db = new DatabaseSync(path.join(h.dir, 'social', 'social.sqlite'));
  db.prepare('UPDATE posts SET created_at=?').run(123456);
  const first = s.feed('one', { limit: 2 }); assert.ok(first.nextCursor);
  assert.throws(() => s.feed('two', { cursor: first.nextCursor }), { code: 'cursor-invalid' });
  assert.throws(() => s.profilePosts('one', 'two', { cursor: first.nextCursor }), { code: 'cursor-invalid' });
  assert.throws(() => s.feed('one', { cursor: first.nextCursor.slice(0, -4) + 'AAAA' }), { code: 'cursor-invalid' });
  const added = h.publish('two', 'later'); db.prepare('UPDATE posts SET created_at=? WHERE id=?').run(123456, added.id);
  db.close();
  const ids = first.posts.map(p => p.id); let cursor = first.nextCursor;
  while (cursor) { const page = s.feed('one', { limit: 2, cursor }); ids.push(...page.posts.map(p => p.id)); cursor = page.nextCursor; }
  assert.equal(ids.length, 8); assert.equal(new Set(ids).size, 8); assert.deepEqual(ids, originals.map(p => p.id).sort().reverse());
  assert.equal(s.feed('one').posts.length, 9);
});
test('encrypted cursor expires and rejects changed contexts', () => {
  let now = 100; const codec = createCursorCodec(crypto.randomBytes(32).toString('hex'), () => now);
  const value = codec.encode({ context: 'one', time: 42 }); assert.equal(codec.decode(value, 'one').time, 42);
  assert.throws(() => codec.decode(value, 'two'), { code: 'cursor-invalid' });
  now += 3600001; assert.throws(() => codec.decode(value, 'one'), { code: 'cursor-invalid' });
});
test('reports retry safely, export only submitted reports, and takedown removes photos and prevents replay', t => {
  const h = fixture(t), { s } = h, asset = crypto.randomUUID();
  s.putPostAsset('two', asset, Buffer.from('photo'), 'digest');
  const payload = h.body('two', 'reported', { assetId: asset }), post = s.publishPost('two', payload);
  const input = { targetType: 'post', targetId: post.id, requestId: crypto.randomUUID(), reason: 'privacy', details: 'Please review' };
  const r = s.report('one', input).report;
  assert.equal(s.report('one', input).report.id, r.id);
  assert.equal(s.report('one', { ...input, requestId: crypto.randomUUID() }).report.id, r.id);
  assert.throws(() => s.report('one', { ...input, details: 'changed' }), { status: 409 });
  assert.throws(() => s.report('two', { ...input, requestId: crypto.randomUUID() }), { code: 'self-report' });
  assert.equal(s.exportSocial('one', 'reports').items.length, 1); assert.deepEqual(s.exportSocial('two', 'reports').items, []);
  assert.equal(s.reviewReport(r.id).target.sourceWorkoutId, undefined);
  assert.equal(s.reportPhoto(r.id).toString(), 'photo');
  assert.equal(s.resolveReport(r.id, 'remove').report.status, 'removed');
  assert.equal(s.reviewReport(r.id).target, null); assert.equal(s.reportPhoto(r.id), null);
  assert.throws(() => s.publishPost('two', payload), { status: 410 });
  assert.equal(fs.existsSync(path.join(h.dir, 'social', 'post-photos', asset + '.webp')), false);
  assert.ok(s.get('two'), 'post takedown preserves profile and private account');
});
test('old reports cannot remove recreated profiles and profile takedown cascades social content only', t => {
  const h = fixture(t), { s } = h;
  const report = () => s.report('one', { targetType: 'profile', targetId: 'two', requestId: crypto.randomUUID(), reason: 'spam', details: '' }).report;
  const old = report(); s.remove('two'); s.save('two', { handle: 'new_two', displayName: 'New', bio: '', accepted: true });
  assert.equal(s.reviewReport(old.id).target, null);
  assert.throws(() => s.resolveReport(old.id, 'remove'), { code: 'target-changed' });
  const fresh = report(); assert.notEqual(fresh.id, old.id);
  const p = h.publish('two', 'workout'); s.follow('one', 'two', true);
  s.resolveReport(fresh.id, 'remove'); assert.equal(s.get('two'), null);
  assert.throws(() => s.getPost('one', p.id), { status: 404 });
  assert.equal(h.accounts.has('two'), true);
});
test('export pagination is owner and section bound and excludes incoming reports and secret fields', t => {
  const h = fixture(t), { s } = h; s.follow('one', 'two', true); s.follow('one', 'three', true);
  h.publish('one', 'mine'); h.publish('two', 'theirs');
  const first = s.exportSocial('one', 'following', { limit: 1 }); assert.ok(first.nextCursor);
  assert.throws(() => s.exportSocial('two', 'following', { cursor: first.nextCursor }), { code: 'cursor-invalid' });
  assert.throws(() => s.exportSocial('one', 'followers', { cursor: first.nextCursor }), { code: 'cursor-invalid' });
  assert.equal(s.exportSocial('one', 'following', { cursor: first.nextCursor }).items.length, 1);
  const posts = s.exportSocial('one', 'posts'); assert.equal(posts.items.length, 1); assert.equal(posts.items[0].sourceWorkoutId, 'mine');
  const data = JSON.stringify(s.exportSocial('one', 'profile')); assert.equal(data.includes('socialEpoch'), false); assert.equal(data.includes('cursor_key'), false);
});

test('schema-three upgrade and an offline directory restore preserve posts, graph and pagination', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-feed-upgrade-')), restored = dir + '-restored';
  const open = dataDir => createSocialStore({ dataDir, accountExists: id => ['one', 'two'].includes(id) });
  let store = open(dir);
  try {
    for (const id of ['one', 'two']) store.save(id, { handle: 'lifter_' + id, displayName: id, bio: '', accepted: true });
    store.follow('one', 'two', true); const epoch = store.get('two').socialEpoch;
    const snapshot = { version: 1, title: 'Workout', date: '2026-11-06', durationSec: 60, exercises: [{ name: 'Squat', unit: 'kg', sets: [{ mode: 'reps', type: 'straight', reps: 5, weight: 10 }] }] };
    for (let i = 0; i < 3; i++) store.publishPost('two', { profileEpoch: epoch, requestId: crypto.randomUUID(), sourceWorkoutId: 'w' + i, snapshot, caption: '', audience: 'followers', assetId: null });
    store.close(); store = null;
    const db = new DatabaseSync(path.join(dir, 'social', 'social.sqlite'));
    db.exec('DROP TABLE post_likes; DROP TABLE post_comments; DROP TABLE reports; DROP TABLE social_meta; DROP INDEX posts_sequence; ALTER TABLE posts DROP COLUMN publication_seq; PRAGMA user_version=3;'); db.close();
    store = open(dir); assert.equal(store.get('two').socialEpoch, epoch);
    const page = store.feed('one', { limit: 1 }); assert.equal(page.posts.length, 1); assert.ok(page.nextCursor);
    store.close(); store = null;
    fs.cpSync(dir, restored, { recursive: true }); store = open(restored);
    assert.equal(store.feed('one', { cursor: page.nextCursor }).posts.length, 2);
    assert.equal(store.relationship('one', 'two').isFollowing, true);
  } finally { store?.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(restored, { recursive: true, force: true }); }
});
