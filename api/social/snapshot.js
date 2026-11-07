import { SocialError } from './errors.js';
const invalid = () => { throw new SocialError(400, 'post-invalid', 'Invalid workout post.'); };
const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x, max, empty = false) => {
  if (typeof x !== 'string' || x.length > max || (!empty && !x.trim()) || /[\x00-\x08\x0b-\x1f\x7f]/.test(x)) invalid();
  return x.trim();
};
const number = (x, max) => { if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > max) invalid(); return x; };
const enumOf = (x, values) => { if (!values.includes(x)) invalid(); return x; };
function setOf(s) {
  if (!object(s)) invalid();
  const out = { mode: enumOf(s.mode, ['reps', 'time', 'cardio']), type: enumOf(s.type, ['straight', 'dropset', 'restpause']) };
  if (s.side != null) out.side = enumOf(s.side, ['L', 'R']);
  for (const [key, max] of Object.entries({ weight: 100000, reps: 100000, seconds: 604800, minutes: 10080, speedKmh: 1000, incline: 100 })) {
    if (s[key] != null) out[key] = number(s[key], max);
  }
  if (s.drops != null) {
    if (!Array.isArray(s.drops) || s.drops.length > 20 || out.type !== 'dropset') invalid();
    out.drops = s.drops.map(d => ({ weight: number(d?.weight, 100000), reps: number(d?.reps, 100000) }));
  }
  if (s.clusters != null) {
    if (!Array.isArray(s.clusters) || s.clusters.length > 20 || out.type !== 'restpause') invalid();
    out.clusters = s.clusters.map(d => ({ reps: number(d?.reps, 100000) }));
  }
  return out;
}
// An allowlist at both ends: unknown fields never become stored or returned public data.
export function snapshotFields(s) {
  if (!object(s) || s.version !== 1 || !Array.isArray(s.exercises) || !s.exercises.length || s.exercises.length > 100) invalid();
  const date = text(s.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) invalid();
  let count = 0;
  const exercises = s.exercises.map(e => {
    if (!object(e) || !Array.isArray(e.sets) || !e.sets.length || e.sets.length > 100) invalid();
    count += e.sets.length; if (count > 1000) invalid();
    return { name: text(e.name, 160), unit: enumOf(e.unit, ['kg', 'lb']), sets: e.sets.map(setOf) };
  });
  return { version: 1, title: text(s.title, 120, true), date, durationSec: s.durationSec == null ? null : number(s.durationSec, 604800), exercises };
}
export function postFields(body) {
  if (!object(body)) invalid();
  const sourceWorkoutId = text(body.sourceWorkoutId, 160);
  const requestId = text(body.requestId, 36);
  if (!/^[a-f0-9-]{36}$/.test(requestId)) invalid();
  const assetId = body.assetId == null ? null : text(body.assetId, 36);
  if (assetId && !/^[a-f0-9-]{36}$/.test(assetId)) invalid();
  const profileEpoch = text(body.profileEpoch, 36);
  if (!/^[a-f0-9-]{36}$/.test(profileEpoch)) invalid();
  return { sourceWorkoutId, requestId, profileEpoch, caption: text(body.caption, 2000, true), audience: enumOf(body.audience, ['followers', 'members']),
    assetId, snapshot: snapshotFields(body.snapshot) };
}
