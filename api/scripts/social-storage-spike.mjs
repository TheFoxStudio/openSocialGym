// Reproducible local storage/decoder check. Uses only an isolated temporary directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';
import { createSocialStore } from '../social/store.js';
import { processAvatar } from '../social/avatar.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-social-spike-'));
const accounts = new Set(Array.from({ length: 1000 }, (_, i) => 'member_' + i));
let store;
try {
  store = createSocialStore({ dataDir: dir, accountExists: id => accounts.has(id) });
  const start = performance.now();
  for (const id of accounts) store.save(id, { handle: id, displayName: id, bio: '', accepted: true });
  const writesMs = Math.round(performance.now() - start);
  const input = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: '#845876' } }).jpeg().toBuffer();
  const imageStart = performance.now();
  const bytes = await processAvatar(input);
  const avatarMs = Math.round(performance.now() - imageStart);
  store.setAvatar('member_0', bytes);
  const backup = path.join(dir, 'snapshot.sqlite');
  const backupStart = performance.now(); store.backup(backup);
  const backupMs = Math.round(performance.now() - backupStart);
  const restored = new DatabaseSync(backup, { readOnly: true });
  const count = restored.prepare('SELECT count(*) n FROM profiles').get().n;
  const version = restored.prepare('select sqlite_version() version').get().version;
  restored.close();
  if (count !== 1000) throw new Error('Incomplete backup');
  console.log(JSON.stringify({ node: process.version, sqlite: version, profiles: count, writesMs, avatarMs,
    avatarBytes: bytes.length, backupMs, databaseBytes: fs.statSync(backup).size,
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }, null, 2));
} finally {
  store?.close(); fs.rmSync(dir, { recursive: true, force: true });
}
