#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
// Operator-only aggregate diagnostics; no account names, captions, credentials or images.
const root = path.resolve(process.env.DATA_DIR || process.argv[2] || './data');
const minimum = Number(process.env.MIN_FREE_MB || 1024) * 1024 * 1024;
try {
  if (!Number.isFinite(minimum) || minimum < 0) throw Error('Invalid MIN_FREE_MB.');
  const disk = fs.statfsSync(root), freeBytes = disk.bavail * disk.bsize;
  const result = { freeBytes, minimumFreeBytes: minimum, lowDisk: freeBytes < minimum, social: null };
  const file = path.join(root, 'social', 'social.sqlite');
  if (fs.existsSync(file)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const schema = db.prepare('PRAGMA user_version').get().user_version;
      if (schema !== 4) throw Error('Expected social schema 4; run the compatible server migration first.');
      const checks = db.prepare('PRAGMA quick_check').all();
      const count = table => db.prepare('SELECT count(*) n FROM ' + table).get().n;
      const assets = db.prepare('SELECT id FROM post_assets').all();
      const photoDir = path.join(root, 'social', 'post-photos');
      const missingPhotos = assets.filter(a => !fs.existsSync(path.join(photoDir, a.id + '.webp'))).length;
      result.social = { schema, databaseBytes: fs.statSync(file).size, integrityOk: checks.every(c => c.quick_check === 'ok'),
        profiles: count('profiles'), posts: count('posts'), reports: count('reports'), assets: assets.length,
        assetBytes: db.prepare('SELECT coalesce(sum(size),0) bytes FROM post_assets').get().bytes, missingPhotos };
    } finally { db.close(); }
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.lowDisk || result.social && (!result.social.integrityOk || result.social.missingPhotos)) process.exitCode = 2;
} catch (e) { console.error(e.message); process.exitCode = 1; }
