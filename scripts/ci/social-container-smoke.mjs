#!/usr/bin/env node
// Run against an already-built API image. Uses disposable data and a loopback-only port.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const image = process.argv[2]; if (!image) throw Error('Usage: node scripts/ci/social-container-smoke.mjs IMAGE');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-container-')), secret = crypto.randomBytes(32).toString('hex');
const name = 'gym-social-smoke-' + crypto.randomUUID(); let started = false;
fs.writeFileSync(path.join(dir, 'secret'), secret);
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'one', name: 'One', admin: true }, { id: 'two', name: 'Two' }], creds: [], subs: [], invites: [] }));
try {
  docker('run', '-d', '--name', name, '-p', '127.0.0.1::3000', '-v', dir + ':/data', '-e', 'DATA_DIR=/data', '-e', 'SOCIAL_ENABLED=1', '-e', 'ORIGIN=http://localhost:8080', image); started = true;
  const address = docker('port', name, '3000/tcp').split('\n')[0], base = 'http://' + address;
  const request = async (url, uid = 'one', method = 'GET', body) => {
    const payload = uid + ':' + (Date.now() + 3600000) + ':0', token = payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return fetch(base + url, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  };
  for (let i = 0; ; i++) {
    try { const res = await fetch(base + '/api/health'); if (res.ok) break; } catch {}
    if (i >= 60) throw Error('Container did not become healthy.');
    await new Promise(r => setTimeout(r, 500));
  }
  assert.equal((await (await request('/api/config')).json()).social.feed, true);
  let epoch;
  for (const uid of ['one', 'two']) {
    const response = await request('/api/social/me', uid, 'PUT', { handle: 'lifter_' + uid, displayName: uid, bio: '', accepted: true });
    assert.equal(response.status, 200); const { profile } = await response.json(); if (uid === 'one') epoch = profile.socialEpoch;
  }
  // A tiny PNG exercises Sharp's actual Linux native binary in both API targets.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWOoj/9fH/+fAUIBADI6B3WowBfkAAAAAElFTkSuQmCC', 'base64');
  const payload = 'one:' + (Date.now() + 3600000) + ':0', token = payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const avatar = await fetch(base + '/api/social/me/avatar', { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/png' }, body: png });
  assert.equal(avatar.status, 200, 'Sharp avatar processing');
  const response = await request('/api/social/posts', 'one', 'POST', { profileEpoch: epoch, sourceWorkoutId: 'workout', requestId: crypto.randomUUID(), caption: 'Container smoke', audience: 'followers', assetId: null,
    snapshot: { version: 1, title: 'Workout', date: '2026-11-06', durationSec: 60, exercises: [{ name: 'Squat', unit: 'kg', sets: [{ mode: 'reps', type: 'straight', weight: 20, reps: 5 }] }] } });
  assert.equal(response.status, 200); const { post } = await response.json();
  assert.equal((await request('/api/social/follows/one', 'two', 'PUT')).status, 200);
  assert.equal((await (await request('/api/social/feed', 'two')).json()).posts[0].id, post.id);
  assert.equal((await request('/api/admin/social/reports', 'two')).status, 403);
  assert.equal((await request('/api/social/export?section=posts')).status, 200);
  docker('restart', name);
  for (let i = 0; ; i++) {
    try { const res = await request('/api/social/feed', 'two'); if (res.ok && (await res.json()).posts[0]?.id === post.id) break; } catch {}
    if (i >= 60) throw Error('Persisted feed did not return after restart.');
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('Container smoke passed: config, Sharp, profiles, publishing, following, feed, export, admin gate and restart.');
} finally {
  if (started) docker('rm', '-f', '-v', name);
  // Linux containers write bind-mounted files as root; remove those through the same image.
  if (process.platform !== 'win32') docker('run', '--rm', '-v', dir + ':/cleanup', '--entrypoint', 'sh', image, '-c', 'find /cleanup -mindepth 1 -delete');
  fs.rmSync(dir, { recursive: true, force: true });
}
