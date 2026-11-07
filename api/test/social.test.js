import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSocialStore } from '../social/store.js';
import { processAvatar, AVATAR_INPUT_MAX } from '../social/avatar.js';
import sharp from 'sharp';

const fields = (handle = 'lifter_one') => ({ handle, displayName: 'Lifter', bio: 'Training together', accepted: true });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-social-'));
  const accounts = new Set(['one', 'two']);
  const args = { dataDir: dir, accountExists: id => accounts.has(id) };
  let store = createSocialStore(args);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, accounts, get store() { return store; }, reopen() { store.close(); store = createSocialStore(args); } };
}
test('opt-in, unique normalized handles and allowlisted profile data survive restart', t => {
  const h = fixture(t);
  assert.equal(h.store.get('one'), null);
  assert.throws(() => h.store.save('one', { ...fields(), accepted: false }), { code: 'opt-in-required' });
  const p = h.store.save('one', { ...fields('Lifter_One'), password: 'secret', workouts: ['private'] });
  assert.equal(p.handle, 'lifter_one');
  assert.equal(p.password, undefined); assert.equal(p.workouts, undefined);
  assert.throws(() => h.store.save('two', fields('LIFTER_ONE')), { code: 'handle-taken' });
  assert.throws(() => h.store.save('two', fields('admin')), { code: 'handle-invalid' });
  h.store.save('two', fields('lifter_two'));
  h.reopen(); assert.deepEqual(h.store.get('one'), p);
});
test('revisions prevent lost edits; removed accounts cannot read/write and are reconciled', t => {
  const h = fixture(t), p = h.store.save('one', fields());
  h.store.save('one', { ...fields(), bio: 'New bio', revision: p.revision });
  assert.throws(() => h.store.save('one', { ...fields(), revision: p.revision }), { code: 'profile-conflict' });
  h.accounts.delete('one');
  assert.equal(h.store.get('one'), null);
  assert.throws(() => h.store.setAvatar('one', Buffer.from('x')), { status: 401 });
  h.reopen(); h.accounts.add('one'); assert.equal(h.store.get('one'), null);
});
test('avatars replace atomically, old IDs stop resolving, and backup restores bytes and schema', t => {
  const h = fixture(t); h.store.save('one', fields());
  const a = h.store.setAvatar('one', Buffer.from('first'));
  const b = h.store.setAvatar('one', Buffer.from('second'));
  assert.equal(h.store.avatar('one', a.avatarId), null);
  assert.deepEqual(h.store.avatar('one', b.avatarId), Buffer.from('second'));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-social-restore-'));
  t.after(() => fs.rmSync(backupDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(backupDir, 'social'));
  h.store.backup(path.join(backupDir, 'social', 'social.sqlite'));
  const restored = createSocialStore({ dataDir: backupDir, accountExists: () => true });
  assert.deepEqual(restored.get('one'), b);
  assert.deepEqual(restored.avatar('one', b.avatarId), Buffer.from('second')); restored.close();
  h.store.remove('one'); assert.equal(h.store.avatar('one', b.avatarId), null);
  h.reopen(); assert.equal(h.store.get('one'), null);
});
test('server decodes and resizes still photos, removes EXIF, and rejects invalid/oversized/animated input', async () => {
  const input = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#ac3366' } })
    .jpeg().withMetadata({ exif: { IFD0: { Artist: 'Private author', ImageDescription: 'Private location' } } }).toBuffer();
  const out = await processAvatar(input);
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 512); assert.equal(meta.height, 512); assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined);
  await assert.rejects(processAvatar(Buffer.from('not an image')), { status: 415 });
  await assert.rejects(processAvatar(Buffer.alloc(AVATAR_INPUT_MAX + 1)), { status: 413 });
  await assert.rejects(processAvatar(Buffer.from([0xff, 0xd8, 0xff, 0x00])), { code: 'avatar-invalid' });
  const gif = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).gif().toBuffer();
  await assert.rejects(processAvatar(gif), { status: 415 });
});
