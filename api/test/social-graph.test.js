import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createSocialStore } from '../social/store.js';

const fields = (handle, displayName = handle) => ({ handle, displayName, bio: '', accepted: true });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-social-graph-'));
  const accounts = new Set(['one', 'two', 'three', 'four']), disabled = new Set();
  const args = { dataDir: dir, accountExists: id => accounts.has(id), accountVisible: id => accounts.has(id) && !disabled.has(id) };
  let store = createSocialStore(args);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  for (const id of accounts) store.save(id, fields('lifter_' + id));
  return { dir, accounts, disabled, get store() { return store; }, reopen() { store.close(); store = createSocialStore(args); } };
}
test('following is idempotent, counts/lists agree, and self-follow or non-profile writers are refused', t => {
  const h = fixture(t), s = h.store;
  s.follow('one', 'two', true); s.follow('one', 'two', true); s.follow('three', 'two', true);
  assert.deepEqual(s.relationship('one', 'two'), { isFollowing: true, isFollowedBy: false, followerCount: 2, followingCount: 0 });
  assert.deepEqual(s.list('one', 'two', 'followers').people.map(p => p.id), ['one', 'three']);
  s.follow('two', 'one', true); assert.equal(s.relationship('one', 'two').isFollowedBy, true);
  s.follow('one', 'two', false); s.follow('one', 'two', false);
  assert.equal(s.relationship('one', 'two').followerCount, 1);
  assert.throws(() => s.follow('one', 'one', true), { code: 'self-follow' });
  s.remove('four'); assert.throws(() => s.follow('four', 'one', true), { code: 'profile-required' });
});
test('blocking revokes both directions across reads, avatars, discovery and lists; unblock never restores follows', t => {
  const h = fixture(t), s = h.store;
  const photo = s.setAvatar('two', Buffer.from('avatar'));
  s.follow('one', 'two', true); s.follow('two', 'one', true); s.follow('three', 'two', true);
  s.block('one', 'two', true); s.block('one', 'two', true);
  for (const [a, b] of [['one', 'two'], ['two', 'one']]) {
    assert.equal(s.get(b, a), null);
    assert.equal(s.people(a, '').people.some(p => p.id === b), false);
    assert.throws(() => s.follow(a, b, true), { status: 404 });
    assert.throws(() => s.list(a, b, 'followers'), { status: 404 });
  }
  assert.equal(s.avatar('two', photo.avatarId, 'one'), null);
  assert.equal(s.avatar('two', photo.avatarId, 'three').toString(), 'avatar');
  assert.equal(s.list('one', 'three', 'following').people.some(p => p.id === 'two'), false);
  assert.deepEqual(s.blocks('one').people.map(p => p.id), ['two']); assert.equal(s.blocks('two').people.length, 0);
  assert.throws(() => s.block('one', 'one', true), { code: 'self-block' });
  s.block('one', 'two', false); s.block('one', 'two', false);
  assert.equal(s.relationship('one', 'two').isFollowing, false); assert.equal(s.relationship('two', 'one').isFollowing, false);
});
test('search/pagination is bounded, cursor-scoped, literal and Unicode case-normalized', t => {
  const h = fixture(t), s = h.store;
  s.save('two', { ...fields('lifter_two', 'ÉMILIE'), revision: s.get('two').revision });
  assert.equal(s.people('one', 'émilie').people[0].id, 'two');
  assert.equal(s.people('one', '@LIFTER_TWO').people[0].id, 'two');
  assert.equal(s.people('one', '%').people.length, 0);
  assert.equal(s.people('one', 'lifter_').people.length, 3);
  const first = s.people('one', '', { limit: 1 }), second = s.people('one', '', { limit: 1, cursor: first.nextCursor });
  assert.notEqual(first.people[0].id, second.people[0].id);
  assert.throws(() => s.people('two', '', { cursor: first.nextCursor }), { code: 'cursor-invalid' });
  assert.throws(() => s.people('one', 'new query', { cursor: first.nextCursor }), { code: 'cursor-invalid' });
  assert.throws(() => s.people('one', '', { limit: 51 }), { code: 'limit-invalid' });
  h.disabled.add('two'); assert.equal(s.people('one', '@lifter_two').people.length, 0);
});
test('opt-out cascades follows but preserves block intent; account deletion removes graph data', t => {
  const h = fixture(t), s = h.store;
  s.follow('one', 'three', true); s.block('one', 'two', true); s.remove('one');
  s.save('one', fields('new_handle'));
  assert.equal(s.get('two', 'one'), null); assert.equal(s.relationship('one', 'three').isFollowing, false);
  s.remove('one', { accountDeleted: true }); assert.equal(s.blocks('one').people.length, 0);
  s.save('one', fields('new_handle')); assert.notEqual(s.get('two', 'one'), null);
  s.block('one', 'two', true); h.accounts.delete('two'); h.reopen(); h.accounts.add('two');
  assert.equal(h.store.blocks('one').people.length, 0);
});
test('pagination advances over a bounded batch of invisible members without leaking their profiles', t => {
  const h = fixture(t), s = h.store;
  for (let i = 0; i < 205; i++) {
    const id = 'member_' + String(i).padStart(3, '0'); h.accounts.add(id);
    s.save(id, fields('scan_' + i)); if (i < 204) h.disabled.add(id);
  }
  const first = s.people('one', 'scan_');
  assert.deepEqual(first.people, []); assert.ok(first.nextCursor);
  const last = s.people('one', 'scan_', { cursor: first.nextCursor });
  assert.deepEqual(last.people.map(p => p.id), ['member_204']); assert.equal(last.nextCursor, null);
});
test('schema v1 upgrades transactionally, preserves profile/avatars, and can be backed up and reopened', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-social-v1-'));
  fs.mkdirSync(path.join(dir, 'social'));
  const db = new DatabaseSync(path.join(dir, 'social', 'social.sqlite'));
  db.exec(`CREATE TABLE profiles(account_id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL, bio TEXT NOT NULL, avatar BLOB, avatar_id TEXT, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1); PRAGMA user_version=1;`);
  db.prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?,?)').run('one', 'old_handle', 'Émilie', '', Buffer.from('avatar'), 'original', 1, 2, 3); db.close();
  const args = { dataDir: dir, accountExists: () => true };
  let store = createSocialStore(args);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal(store.get('one').revision, 3); assert.equal(store.avatar('one', 'original').toString(), 'avatar');
  assert.equal(store.people('two', 'émilie').people[0].id, 'one');
  store.save('two', fields('new_member')); store.follow('two', 'one', true);
  store.backup(path.join(dir, 'backup.sqlite')); store.close(); store = createSocialStore(args);
  assert.equal(store.relationship('two', 'one').isFollowing, true);
  fs.mkdirSync(path.join(dir, 'restored', 'social'), { recursive: true });
  fs.copyFileSync(path.join(dir, 'backup.sqlite'), path.join(dir, 'restored', 'social', 'social.sqlite'));
  const restored = createSocialStore({ ...args, dataDir: path.join(dir, 'restored') });
  assert.equal(restored.relationship('two', 'one').isFollowing, true); restored.close();
});
