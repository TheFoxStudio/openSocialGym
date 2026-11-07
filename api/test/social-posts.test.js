import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createSocialStore } from '../social/store.js';
import { snapshotFields } from '../social/snapshot.js';

const snapshot = () => ({ version: 1, title: 'Leg day', date: '2026-11-06', durationSec: 3600, exercises: [{ name: 'Squat', unit: 'kg', sets: [{ mode: 'reps', type: 'straight', weight: 80, reps: 5 }] }] });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-social-posts-')), accounts = new Set(['one', 'two', 'three']);
  let store = createSocialStore({ dataDir: dir, accountExists: id => accounts.has(id) });
  for (const id of accounts) store.save(id, { handle: 'lifter_' + id, displayName: id, bio: '', accepted: true });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const body = (sourceWorkoutId = 'workout-1', patch = {}) => ({ requestId: crypto.randomUUID(), sourceWorkoutId, caption: 'Great session',
    audience: 'followers', snapshot: snapshot(), assetId: null, profileEpoch: store.get('one').socialEpoch, ...patch });
  return { dir, accounts, get store() { return store; }, body, reopen() { store.close(); store = createSocialStore({ dataDir: dir, accountExists: id => accounts.has(id) }); } };
}
test('public snapshots are a strict allowlist, valid bounded numbers, dates and collections', () => {
  const s = snapshot(); s.bw = 75; s.note = 'private'; s.gym = { name: 'Home' }; s.exercises[0].note = 'injury'; s.exercises[0].sets[0].hr = 160;
  const publicData = snapshotFields(s), encoded = JSON.stringify(publicData);
  for (const term of ['private', 'injury', 'Home', '"bw"', '"hr"']) assert.equal(encoded.includes(term), false);
  assert.throws(() => snapshotFields({ ...s, date: '2026-02-30' }), { code: 'post-invalid' });
  assert.throws(() => snapshotFields({ ...s, exercises: [] }), { code: 'post-invalid' });
  s.exercises[0].sets[0].weight = Infinity; assert.throws(() => snapshotFields(s), { code: 'post-invalid' });
});
test('publish response loss, second devices, edits and deleted-request tombstones never duplicate posts', t => {
  const h = fixture(t), s = h.store, body = h.body();
  const p = s.publishPost('one', body); assert.deepEqual(s.publishPost('one', body), p);
  const other = s.publishPost('two', { ...body, profileEpoch: s.get('two').socialEpoch });
  assert.notEqual(other.id, p.id, 'request IDs and source workout IDs are isolated per author');
  assert.throws(() => s.publishPost('one', { ...body, caption: 'Different' }), { code: 'request-conflict' });
  assert.throws(() => s.publishPost('one', h.body()), { code: 'post-exists' });
  const edit = h.body('workout-1', { revision: p.revision, caption: 'Edited', audience: 'members' });
  const updated = s.editPost('one', p.id, edit); assert.equal(updated.revision, 2);
  assert.deepEqual(s.editPost('one', p.id, edit), updated);
  assert.throws(() => s.editPost('one', p.id, h.body('workout-1', { revision: 1 })), { code: 'post-conflict' });
  assert.throws(() => s.editPost('two', p.id, { ...h.body(), profileEpoch: s.get('two').socialEpoch }), { status: 404 });
  s.deletePost('one', p.id);
  assert.throws(() => s.publishPost('one', body), { status: 410 });
  assert.throws(() => s.deletePost('two', p.id), { status: 404 });
  assert.equal(s.ownPost('one', 'workout-1'), null);
  assert.notEqual(s.publishPost('one', h.body()).id, p.id, 'only a new explicit request may republish');
});
test('post and photo reads use current audience, follows, blocks and enabled account policy', t => {
  const h = fixture(t), s = h.store, asset = crypto.randomUUID();
  s.putPostAsset('one', asset, Buffer.from('processed'), 'digest');
  const p = s.publishPost('one', h.body('2026-11-06|private-start', { assetId: asset }));
  assert.throws(() => s.getPost('two', p.id), { status: 404 }); assert.throws(() => s.postPhoto('two', p.id), { status: 404 });
  s.follow('two', 'one', true);
  assert.equal(s.getPost('two', p.id).sourceWorkoutId, undefined, 'internal workout keys never reach other members');
  assert.equal(s.postPhoto('two', p.id).toString(), 'processed');
  s.follow('two', 'one', false); assert.throws(() => s.postPhoto('two', p.id), { status: 404 });
  s.editPost('one', p.id, h.body(p.sourceWorkoutId, { revision: 1, audience: 'members', assetId: asset }));
  assert.equal(s.getPost('three', p.id).audience, 'members');
  s.block('one', 'three', true); assert.throws(() => s.getPost('three', p.id), { status: 404 });
  assert.throws(() => s.postPhoto('three', p.id), { status: 404 });
  s.remove('one'); assert.throws(() => s.getPost('two', p.id), { status: 404 });
  assert.equal(fs.readdirSync(path.join(h.dir, 'social', 'post-photos')).length, 0);
});
test('photos are owned, immutable and single-post references; replacement/deletion removes their files', t => {
  const h = fixture(t), s = h.store, a = crypto.randomUUID();
  s.putPostAsset('one', a, Buffer.from('image'), 'a'); s.putPostAsset('one', a, Buffer.from('image'), 'a');
  assert.throws(() => s.putPostAsset('two', a, Buffer.from('image'), 'a'), { status: 409 });
  assert.throws(() => s.putPostAsset('one', a, Buffer.from('other'), 'b'), { status: 409 });
  assert.throws(() => s.publishPost('two', { ...h.body(), assetId: a, profileEpoch: s.get('two').socialEpoch }), { code: 'photo-missing' });
  const p = s.publishPost('one', h.body('workout-1', { assetId: a }));
  assert.throws(() => s.publishPost('one', h.body('workout-2', { assetId: a })), { code: 'photo-missing' });
  s.discardPostAsset('one', a); assert.equal(s.postPhoto('one', p.id).toString(), 'image', 'linked photo survives cleanup');
  s.editPost('one', p.id, h.body('workout-1', { revision: 1 }));
  assert.equal(fs.existsSync(path.join(h.dir, 'social', 'post-photos', a + '.webp')), false);
  s.deletePost('one', p.id);
});
test('profile recreation invalidates queued publication from the previous opt-in lifetime', t => {
  const h = fixture(t), old = h.body();
  h.store.remove('one'); h.store.save('one', { handle: 'lifter_one', displayName: 'one', bio: '', accepted: true });
  assert.throws(() => h.store.publishPost('one', old), { code: 'profile-changed' });
  const p = h.store.publishPost('one', h.body()); h.accounts.delete('one'); h.reopen();
  assert.throws(() => h.store.getPost('two', p.id), { status: 404 });
});
test('profile pagination is scoped, deterministic, and filters followers-only posts', t => {
  const h = fixture(t), s = h.store;
  for (let i = 0; i < 4; i++) s.publishPost('one', h.body('workout-' + i, { audience: i === 1 ? 'followers' : 'members' }));
  const first = s.profilePosts('two', 'one', { limit: 1 }); assert.equal(first.posts.length, 1);
  assert.throws(() => s.profilePosts('three', 'one', { cursor: first.nextCursor }), { code: 'cursor-invalid' });
  let page = first; const ids = [];
  do { ids.push(...page.posts.map(p => p.id)); page = page.nextCursor ? s.profilePosts('two', 'one', { limit: 1, cursor: page.nextCursor }) : null; } while (page);
  assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3);
});
test('unreferenced photos expire, referenced photos survive, and orphan files are removed on restart', t => {
  const h = fixture(t), s = h.store, a = crypto.randomUUID(), b = crypto.randomUUID();
  s.putPostAsset('one', a, Buffer.from('keep'), 'a'); s.putPostAsset('one', b, Buffer.from('expire'), 'b');
  s.publishPost('one', h.body('workout-1', { assetId: a }));
  const db = new DatabaseSync(path.join(h.dir, 'social', 'social.sqlite'));
  db.exec('UPDATE post_assets SET created_at=0'); db.close();
  const orphan = crypto.randomUUID() + '.webp'; fs.writeFileSync(path.join(h.dir, 'social', 'post-photos', orphan), 'orphan');
  h.reopen();
  assert.deepEqual(fs.readdirSync(path.join(h.dir, 'social', 'post-photos')), [a + '.webp']);
});
test('a failed publish is rolled back and pending photo quotas are recoverable', t => {
  const h = fixture(t), s = h.store, ids = Array.from({ length: 11 }, () => crypto.randomUUID());
  const body = h.body('workout-1', { assetId: ids[0] });
  assert.throws(() => s.publishPost('one', body), { code: 'photo-missing' });
  for (const id of ids.slice(0, 10)) s.putPostAsset('one', id, Buffer.from('photo'), id);
  assert.throws(() => s.putPostAsset('one', ids[10], Buffer.from('photo'), 'last'), { code: 'photo-quota' });
  const p = s.publishPost('one', body); assert.ok(p.id, 'same failed request can succeed after its upload becomes ready');
  s.discardPostAsset('one', ids[1]); assert.ok(s.putPostAsset('one', ids[10], Buffer.from('photo'), 'last'));
});
test('schema v2 migrates with follows/blocks/avatars intact and assigns stable profile lifetimes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-social-v2-posts-')); fs.mkdirSync(path.join(dir, 'social'));
  const db = new DatabaseSync(path.join(dir, 'social', 'social.sqlite'));
  db.exec(`CREATE TABLE profiles(account_id TEXT PRIMARY KEY,handle TEXT UNIQUE COLLATE NOCASE,display_name TEXT,bio TEXT,avatar BLOB,avatar_id TEXT,
    created_at INTEGER,updated_at INTEGER,revision INTEGER DEFAULT 1,search_name TEXT);
    CREATE TABLE follows(follower_id TEXT REFERENCES profiles(account_id) ON DELETE CASCADE,followed_id TEXT REFERENCES profiles(account_id) ON DELETE CASCADE,created_at INTEGER,PRIMARY KEY(follower_id,followed_id));
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT,created_at INTEGER,PRIMARY KEY(blocker_id,blocked_id)); PRAGMA user_version=2;`);
  for (const id of ['one', 'two', 'three']) db.prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, 'lifter_' + id, id, '', Buffer.from('avatar'), 'avatar-' + id, 1, 2, 3, id);
  db.exec("INSERT INTO follows VALUES('one','two',1); INSERT INTO blocks VALUES('one','three',1)"); db.close();
  let store = createSocialStore({ dataDir: dir, accountExists: () => true });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const epoch = store.get('one').socialEpoch;
  assert.match(epoch, /^[a-f0-9-]{36}$/); assert.equal(store.relationship('one', 'two').isFollowing, true);
  assert.equal(store.get('three', 'one'), null); assert.equal(store.avatar('one', 'avatar-one').toString(), 'avatar');
  store.close(); store = createSocialStore({ dataDir: dir, accountExists: () => true }); assert.equal(store.get('one').socialEpoch, epoch);
});
