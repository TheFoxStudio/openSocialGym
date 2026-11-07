import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { backupInstance, restoreInstance, verifyBackup } from '../../scripts/instance-backup.mjs';
import { createSocialStore } from '../social/store.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-backup-')), source = path.join(dir, 'data'), backup = path.join(dir, 'backup'), restored = path.join(dir, 'restored');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'secret'), crypto.randomBytes(32));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, source, backup, restored };
}
test('offline backup and clean restore preserve accounts, training, graph, avatars, posts and photo bytes', async t => {
  const h = fixture(t), accountExists = id => ['one', 'two'].includes(id);
  fs.writeFileSync(path.join(h.source, 'db.json'), JSON.stringify({ users: [{ id: 'one' }, { id: 'two' }], creds: [{ id: 'credential' }] }));
  fs.writeFileSync(path.join(h.source, 'state-one.json'), JSON.stringify({ workouts: [{ note: 'private training' }] }));
  fs.mkdirSync(path.join(h.source, 'uploads')); fs.writeFileSync(path.join(h.source, 'uploads', 'private-media'), 'private media');
  fs.mkdirSync(path.join(h.source, '.backups')); fs.writeFileSync(path.join(h.source, '.backups', 'older'), 'exclude nested backups');
  let store = createSocialStore({ dataDir: h.source, accountExists });
  for (const id of ['one', 'two']) store.save(id, { handle: 'lifter_' + id, displayName: id, bio: 'Bio', accepted: true });
  const avatar = store.setAvatar('two', Buffer.from('avatar')), asset = crypto.randomUUID();
  store.follow('one', 'two', true); store.putPostAsset('two', asset, Buffer.from('post photo'), 'digest');
  const post = store.publishPost('two', { profileEpoch: store.get('two').socialEpoch, requestId: crypto.randomUUID(), sourceWorkoutId: 'workout', caption: 'Shared', audience: 'followers', assetId: asset,
    snapshot: { version: 1, title: 'Workout', date: '2026-11-06', durationSec: 60, exercises: [{ name: 'Squat', unit: 'kg', sets: [{ mode: 'reps', type: 'straight', weight: 20, reps: 5 }] }] } });
  store.close();
  await assert.rejects(backupInstance(h.source, h.backup), /Stop the API/);
  const result = await backupInstance(h.source, h.backup, { offline: true }); assert.ok(result.files >= 6);
  assert.equal(fs.existsSync(path.join(h.backup, '.backups')), false);
  await verifyBackup(h.backup); await restoreInstance(h.backup, h.restored);
  assert.deepEqual(fs.readFileSync(path.join(h.source, 'secret')), fs.readFileSync(path.join(h.restored, 'secret')));
  assert.deepEqual(fs.readFileSync(path.join(h.source, 'db.json')), fs.readFileSync(path.join(h.restored, 'db.json')));
  assert.match(fs.readFileSync(path.join(h.restored, 'state-one.json'), 'utf8'), /private training/);
  assert.equal(fs.readFileSync(path.join(h.restored, 'uploads', 'private-media'), 'utf8'), 'private media');
  store = createSocialStore({ dataDir: h.restored, accountExists });
  try {
    assert.equal(store.feed('one').posts[0].id, post.id);
    assert.equal(store.postPhoto('one', post.id).toString(), 'post photo');
    assert.equal(Buffer.from(store.avatar('two', avatar.avatarId, 'one')).toString(), 'avatar');
  } finally { store.close(); }
  await assert.rejects(restoreInstance(h.backup, h.restored), /already exists/);
  await assert.rejects(backupInstance(h.source, path.join(h.source, 'nested'), { offline: true }), /separate/);
});
test('verification and restore reject corrupted, added, missing or unsafe backup files', async t => {
  const h = fixture(t); await backupInstance(h.source, h.backup, { offline: true });
  fs.writeFileSync(path.join(h.backup, 'extra'), 'unexpected'); await assert.rejects(verifyBackup(h.backup), /file list/);
  fs.unlinkSync(path.join(h.backup, 'extra'));
  fs.writeFileSync(path.join(h.backup, 'secret'), 'damaged'); await assert.rejects(restoreInstance(h.backup, h.restored), /checksum/);
  assert.equal(fs.existsSync(h.restored), false);
  fs.unlinkSync(path.join(h.backup, 'secret')); await assert.rejects(verifyBackup(h.backup), /file list/);
});
