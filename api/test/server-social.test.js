import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { boundPort } from './helpers.mjs';

const API = fileURLToPath(new URL('../', import.meta.url));
async function server(t, enabled = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-social-http-'));
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dir, 'secret'), secret);
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'one', name: 'Account One' }, { id: 'two', name: 'Account Two' }, { id: 'operator', name: 'Operator', admin: true }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, env: { ...process.env, PORT: '0', DATA_DIR: dir, ORIGIN: 'http://localhost:8080', SOCIAL_ENABLED: enabled ? '1' : '0', COACH_ENABLED: '', INTEGRATIONS: '', PASSWORD_LOGIN: '', ADMIN_UIDS: '', AUDIT_LOG: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(async () => { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + await boundPort(child, () => log);
  const token = uid => {
    const body = `${uid}:${Date.now() + 86400000}:0`;
    return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
  };
  const req = (url, { uid = 'one', method = 'GET', body, raw, headers = {} } = {}) => fetch(base + url, {
    method, headers: { ...(uid ? { Authorization: 'Bearer ' + token(uid) } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: raw || (body ? JSON.stringify(body) : undefined)
  });
  return { dir, req, token };
}
const fields = handle => ({ handle, displayName: 'Social name', bio: 'Bio', accepted: true });

test('timeline, reporting, owner export and administrator takedown enforce HTTP authorization', async t => {
  const h = await server(t);
  const { profile } = await (await h.req('/api/social/me', { method: 'PUT', body: fields('lifter_one') })).json();
  await h.req('/api/social/me', { uid: 'two', method: 'PUT', body: fields('lifter_two') });
  const body = { sourceWorkoutId: 'workout', profileEpoch: profile.socialEpoch, requestId: crypto.randomUUID(), caption: 'Done', audience: 'members', assetId: null,
    snapshot: { version: 1, title: 'Squats', date: '2026-11-06', durationSec: 60, exercises: [{ name: 'Squat', unit: 'kg', sets: [{ mode: 'reps', type: 'straight', weight: 40, reps: 8 }] }] } };
  const { post } = await (await h.req('/api/social/posts', { method: 'POST', body })).json();
  assert.equal((await h.req('/api/social/feed', { uid: null })).status, 401);
  assert.equal((await (await h.req('/api/social/feed', { uid: 'two' })).json()).posts.length, 0);
  await h.req('/api/social/follows/one', { uid: 'two', method: 'PUT' });
  assert.equal((await (await h.req('/api/social/feed', { uid: 'two' })).json()).posts[0].id, post.id);
  assert.equal((await (await h.req('/api/social/feed/check', { uid: 'two', method: 'POST', body: { ids: [post.id] } })).json()).viewerId, 'two');
  assert.equal((await h.req('/api/admin/social/reports', { uid: null })).status, 401);
  assert.equal((await h.req('/api/admin/social/reports', { uid: 'two' })).status, 403);
  const { report } = await (await h.req('/api/social/reports', { uid: 'two', method: 'POST', body: { targetType: 'post', targetId: post.id, requestId: crypto.randomUUID(), reason: 'privacy', details: 'Review' } })).json();
  const queue = await h.req('/api/admin/social/reports', { uid: 'operator' }); assert.equal(queue.status, 200);
  assert.equal((await queue.json()).reports[0].id, report.id);
  const detail = await (await h.req('/api/admin/social/reports/' + report.id, { uid: 'operator' })).json();
  assert.equal(detail.target.sourceWorkoutId, undefined);
  const exported = await (await h.req('/api/social/export?section=posts&uid=one', { uid: 'two' })).json();
  assert.equal(exported.ownerId, 'two'); assert.deepEqual(exported.items, []);
  assert.equal((await h.req('/api/admin/social/reports/' + report.id, { uid: 'two', method: 'PUT', body: { action: 'remove' } })).status, 403);
  assert.equal((await h.req('/api/admin/social/reports/' + report.id, { uid: 'operator', method: 'PUT', body: { action: 'remove' } })).status, 200);
  assert.equal((await h.req('/api/social/posts/' + post.id)).status, 404);
  assert.equal((await (await h.req('/api/social/feed', { uid: 'two' })).json()).posts.length, 0);
  assert.equal((await h.req('/api/me')).status, 200);
});
test('real API enforces sessions, profile ownership, opt-in and handle collisions; avatars are member-only', async t => {
  const h = await server(t);
  assert.equal((await (await h.req('/api/config', { uid: null })).json()).social.enabled, true);
  assert.equal((await h.req('/api/social/me', { uid: null })).status, 401);
  assert.equal((await h.req('/api/social/me', { uid: null, method: 'PUT', body: fields('attacker') })).status, 401);
  assert.deepEqual(await (await h.req('/api/social/me')).json(), { profile: null });
  let res = await h.req('/api/social/me', { method: 'PUT', body: fields('one_lifter') }); assert.equal(res.status, 200);
  assert.equal((await h.req('/api/social/me', { method: 'PUT', uid: 'two', body: fields('ONE_LIFTER') })).status, 409);
  res = await h.req('/api/social/me', { method: 'PUT', uid: 'two', body: { ...fields('two_lifter'), id: 'one' } }); assert.equal(res.status, 200);
  assert.equal((await res.json()).profile.id, 'two');
  assert.equal((await h.req('/api/social/profiles/one', { uid: null })).status, 401);
  assert.equal((await h.req('/api/social/profiles/one', { method: 'DELETE', uid: 'two' })).status, 404);
  const photo = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#f0f' } }).png().toBuffer();
  res = await h.req('/api/social/me/avatar', { method: 'PUT', raw: photo, headers: { 'Content-Type': 'image/png' } }); assert.equal(res.status, 200);
  const { profile } = await res.json();
  const asset = '/api/social/profiles/one/avatar/' + profile.avatarId;
  assert.equal((await h.req(asset, { uid: null })).status, 401);
  res = await h.req(asset, { uid: 'two' }); assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width, 512);
  assert.equal((await h.req('/api/social/me', { method: 'DELETE' })).status, 200);
  assert.equal((await h.req(asset, { uid: 'two' })).status, 404);
  assert.equal((await h.req('/api/me')).status, 200, 'opting out keeps authentication');
  assert.equal(fs.existsSync(path.join(h.dir, 'state-one.json')), false, 'social never writes private training');
});
test('feature-off preserves compatibility and creates no social database', async t => {
  const h = await server(t, false);
  assert.equal((await (await h.req('/api/config')).json()).social, undefined);
  assert.equal((await h.req('/api/social/me')).status, 404);
  assert.equal(fs.existsSync(path.join(h.dir, 'social')), false);
});
test('graph HTTP routes authorize members and apply blocks to direct avatar and profile URLs', async t => {
  const h = await server(t);
  for (const uid of ['one', 'two']) assert.equal((await h.req('/api/social/me', { uid, method: 'PUT', body: fields('lifter_' + uid) })).status, 200);
  assert.equal((await h.req('/api/social/people', { uid: null })).status, 401);
  const find = await (await h.req('/api/social/people?q=LIFTER_TWO')).json(); assert.equal(find.people[0].id, 'two');
  assert.equal((await h.req('/api/social/follows/one', { method: 'PUT' })).status, 400);
  for (const [uid, target] of [['one', 'two'], ['two', 'one']]) {
    assert.equal((await h.req('/api/social/follows/' + target, { uid, method: 'PUT' })).status, 200);
    assert.equal((await h.req('/api/social/follows/' + target, { uid, method: 'PUT' })).status, 200);
  }
  assert.equal((await (await h.req('/api/social/profiles/two/followers')).json()).people.length, 1);
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#456' } }).png().toBuffer();
  const { profile } = await (await h.req('/api/social/me/avatar', { uid: 'two', method: 'PUT', raw: png })).json();
  assert.equal((await h.req('/api/social/blocks/two', { method: 'PUT' })).status, 200);
  assert.equal((await h.req('/api/social/blocks/two', { method: 'PUT' })).status, 200);
  for (const [uid, target] of [['one', 'two'], ['two', 'one']]) {
    assert.equal((await h.req('/api/social/profiles/' + target, { uid })).status, 404);
    assert.equal((await h.req('/api/social/profiles/' + target + '/followers', { uid })).status, 404);
    assert.equal((await h.req('/api/social/follows/' + target, { uid, method: 'PUT' })).status, 404);
  }
  assert.equal((await h.req('/api/social/profiles/two/avatar/' + profile.avatarId)).status, 404);
  assert.deepEqual((await (await h.req('/api/social/people')).json()).people, []);
  assert.equal((await (await h.req('/api/social/blocks')).json()).people[0].id, 'two');
  assert.equal((await h.req('/api/social/blocks/two', { method: 'DELETE' })).status, 200);
  const restored = await (await h.req('/api/social/profiles/two')).json();
  assert.equal(restored.relationship.isFollowing, false); assert.equal(restored.relationship.isFollowedBy, false);
  assert.equal((await h.req('/api/social/people?limit=51')).status, 400);
});
test('workout publishing HTTP contract enforces audience, image ownership, retry safety and auth', async t => {
  const h = await server(t);
  let epoch;
  for (const uid of ['one', 'two']) {
    const { profile } = await (await h.req('/api/social/me', { uid, method: 'PUT', body: fields('lifter_' + uid) })).json();
    if (uid === 'one') epoch = profile.socialEpoch;
  }
  const asset = crypto.randomUUID();
  const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#987' } }).withMetadata({ exif: { IFD0: { Artist: 'Private author' } } }).png().toBuffer();
  assert.equal((await h.req('/api/social/uploads/' + asset, { method: 'PUT', raw: png })).status, 200);
  const body = { sourceWorkoutId: 'private-source', profileEpoch: epoch, requestId: crypto.randomUUID(), caption: 'Done!', audience: 'followers', assetId: asset,
    snapshot: { version: 1, title: 'Squats', date: '2026-11-06', durationSec: 600, bw: 80, note: 'private', exercises: [{ name: 'Squat', unit: 'kg', sets: [{ mode: 'reps', type: 'straight', weight: 40, reps: 8, hr: 180 }] }] } };
  assert.equal((await h.req('/api/social/posts', { uid: null, method: 'POST', body })).status, 401);
  const first = await h.req('/api/social/posts', { method: 'POST', body }); assert.equal(first.status, 200);
  const { post } = await first.json();
  assert.equal(post.snapshot.bw, undefined); assert.equal(post.snapshot.note, undefined); assert.equal(post.snapshot.exercises[0].sets[0].hr, undefined);
  assert.equal((await (await h.req('/api/social/posts', { method: 'POST', body })).json()).post.id, post.id);
  assert.equal((await h.req('/api/social/posts/' + post.id, { uid: 'two' })).status, 404);
  assert.equal((await h.req('/api/social/posts/' + post.id + '/photo', { uid: 'two' })).status, 404);
  assert.equal((await h.req('/api/social/follows/one', { uid: 'two', method: 'PUT' })).status, 200);
  const allowed = await h.req('/api/social/posts/' + post.id + '/photo', { uid: 'two' }); assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
  const metadata = await sharp(Buffer.from(await allowed.arrayBuffer())).metadata();
  assert.equal(metadata.exif, undefined); assert.equal(metadata.width, 120); assert.equal(metadata.height, 80, 'post photo keeps aspect ratio');
  assert.equal((await h.req('/api/social/posts/' + post.id, { uid: 'two', method: 'DELETE' })).status, 404);
  assert.equal((await h.req('/api/social/blocks/two', { method: 'PUT' })).status, 200);
  assert.equal((await h.req('/api/social/posts/' + post.id + '/photo', { uid: 'two' })).status, 404);
  assert.equal((await h.req('/api/social/posts/' + post.id, { method: 'DELETE' })).status, 200);
  assert.equal((await h.req('/api/social/posts', { method: 'POST', body })).status, 410);
});
