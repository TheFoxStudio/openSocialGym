#!/usr/bin/env node
// Offline, complete DATA_DIR backups. Never merge a restore into an existing instance.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const MANIFEST = 'opensocialgym-backup.json';
const digest = file => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256'), input = fs.createReadStream(file);
  input.on('data', chunk => hash.update(chunk)); input.on('error', reject); input.on('end', () => resolve(hash.digest('hex')));
});
function contained(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function files(root, excludeBackups = false, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    if (!prefix && excludeBackups && entry.name === '.backups') continue;
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw Error('Unsupported link or special file: ' + relative);
    if (entry.isDirectory()) out.push(...files(root, excludeBackups, relative));
    else out.push(relative);
  }
  return out.sort();
}
function directory(input) {
  const root = path.resolve(input);
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw Error('Expected a real directory.');
  return fs.realpathSync(root);
}
function unusedTarget(input) {
  const target = path.resolve(input), parent = directory(path.dirname(target));
  const resolved = path.join(parent, path.basename(target));
  if (fs.existsSync(resolved)) throw Error('Destination already exists; choose a new directory.');
  return resolved;
}
export async function verifyBackup(input) {
  const root = directory(input), manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
  if (manifest.format !== 'opensocialgym-instance' || manifest.version !== 1 || !Array.isArray(manifest.files)) throw Error('Unsupported backup manifest.');
  const actual = files(root).filter(name => name !== MANIFEST), expected = manifest.files.map(f => f.path);
  if (new Set(expected).size !== expected.length || JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw Error('Backup file list mismatch.');
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || entry.path.includes('\\') || entry.path.split('/').some(p => !p || p === '.' || p === '..') || !contained(root, path.resolve(root, entry.path))) throw Error('Unsafe backup path.');
    const file = path.join(root, entry.path);
    if (fs.statSync(file).size !== entry.bytes || await digest(file) !== entry.sha256) throw Error('Backup checksum mismatch: ' + entry.path);
  }
  return manifest;
}
export async function backupInstance(sourceInput, targetInput, { offline = false } = {}) {
  if (!offline) throw Error('Stop the API first, then pass --offline to confirm it is stopped.');
  const source = directory(sourceInput), target = unusedTarget(targetInput);
  if (contained(source, target) || contained(target, source)) throw Error('Backup and data directories must be separate.');
  if (fs.existsSync(path.join(source, MANIFEST))) throw Error('Source is already a backup.');
  const names = files(source, true), records = [];
  if (!names.includes('secret')) throw Error('DATA_DIR has no session secret; check the source path.');
  // Publish only a fully verified directory. Failed copies remain under a unique .partial name.
  const staging = target + '.partial-' + crypto.randomUUID(); fs.mkdirSync(staging, { mode: 0o700 });
  for (const name of names) {
    const input = path.join(source, name), before = fs.statSync(input), output = path.join(staging, name);
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.copyFileSync(input, output, fs.constants.COPYFILE_EXCL); fs.chmodSync(output, 0o600);
    const sha256 = await digest(output), after = fs.statSync(input);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || sha256 !== await digest(input)) throw Error('Source changed during backup; stop all writers and retry.');
    records.push({ path: name, bytes: before.size, sha256 });
  }
  if (JSON.stringify(names) !== JSON.stringify(files(source, true))) throw Error('Source file list changed during backup.');
  const manifest = { format: 'opensocialgym-instance', version: 1, createdAt: new Date().toISOString(), files: records };
  fs.writeFileSync(path.join(staging, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await verifyBackup(staging); fs.renameSync(staging, target);
  return { directory: target, files: records.length, bytes: records.reduce((n, f) => n + f.bytes, 0) };
}
export async function restoreInstance(sourceInput, targetInput) {
  const source = directory(sourceInput), target = unusedTarget(targetInput);
  if (contained(source, target) || contained(target, source)) throw Error('Restore destination must be separate from the backup.');
  const manifest = await verifyBackup(source), staging = target + '.partial-' + crypto.randomUUID();
  fs.mkdirSync(staging, { mode: 0o700 });
  for (const entry of manifest.files) {
    const output = path.join(staging, entry.path);
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(source, entry.path), output, fs.constants.COPYFILE_EXCL); fs.chmodSync(output, 0o600);
    if (await digest(output) !== entry.sha256) throw Error('Backup changed during restore.');
  }
  fs.renameSync(staging, target);
  return { directory: target, files: manifest.files.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, source, target, ...flags] = process.argv.slice(2);
  try {
    if (action === 'verify' && source && !target) { const result = await verifyBackup(source); console.log(JSON.stringify({ ok: true, files: result.files.length })); }
    else if (action === 'backup' && source && target && flags.every(f => f === '--offline')) console.log(JSON.stringify(await backupInstance(source, target, { offline: flags.includes('--offline') })));
    else if (action === 'restore' && source && target && !flags.length) console.log(JSON.stringify(await restoreInstance(source, target)));
    else throw Error('Usage: node scripts/instance-backup.mjs backup DATA_DIR NEW_BACKUP_DIR --offline | verify BACKUP_DIR | restore BACKUP_DIR NEW_DATA_DIR');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
