#!/usr/bin/env node
// Disposable realistic community fixture; never connects to an existing DATA_DIR.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createSocialStore } from '../social/store.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-feed-probe-'));
let store;
try {
  const ids = Array.from({ length: 51 }, (_, i) => 'member_' + i), followed = new Set(ids.slice(1, 11));
  store = createSocialStore({ dataDir: dir, accountExists: id => ids.includes(id) });
  for (const id of ids) store.save(id, { handle: id, displayName: id, bio: '', accepted: true });
  for (const id of followed) store.follow(ids[0], id, true);
  const snapshot = { version: 1, title: 'Strength', date: '2026-11-06', durationSec: 3600, exercises: Array.from({ length: 8 }, (_, i) => ({ name: 'Exercise ' + i, unit: 'kg', sets: Array.from({ length: 4 }, () => ({ mode: 'reps', type: 'straight', weight: 80, reps: 8 })) })) };
  for (const id of ids.slice(1)) for (let i = 0; i < 20; i++) store.publishPost(id, { requestId: crypto.randomUUID(), sourceWorkoutId: 'workout-' + i, profileEpoch: store.get(id).socialEpoch, snapshot, caption: 'Training session', audience: i % 2 ? 'members' : 'followers', assetId: null });
  const samples = []; let cursor, read = 0;
  for (let i = 0; i < 200; i++) {
    const start = performance.now(), page = store.feed(ids[0], { limit: 10, cursor }); samples.push(performance.now() - start);
    assert.ok(page.posts.every(p => followed.has(p.authorId))); read += page.posts.length; cursor = page.nextCursor || undefined;
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * .95) - 1], max = Number(process.env.FEED_MAX_P95_MS || 100);
  console.log(JSON.stringify({ fixtureAuthors: 50, fixturePosts: 1000, followedAuthors: 10, requests: samples.length, postsRead: read, p95Ms: +p95.toFixed(2), maxP95Ms: max }, null, 2));
  if (!Number.isFinite(max) || max <= 0 || p95 > max) process.exitCode = 1;
} finally { store?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
