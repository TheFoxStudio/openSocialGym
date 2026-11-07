import { snapshotFields } from '../../../api/social/snapshot.js'
import { hasCompletedWork, isSideSet, isWarmupRow, modeForSet, setType, dropsOf, clustersOf } from './workout-model.js'
import { viewEntry, exUnitOf } from './ex-unit.js'
import { workoutDay, workoutDuration } from './history.js'
import { legacySyncKey } from './workout-date.js'

export const socialWorkoutId = w => String(w?.id ?? legacySyncKey(w))
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
export function buildSocialSnapshot(workout, state, nameOf = e => e.n || e.name || String(e.id)) {
  const exercises = (workout?.entries || []).map(stored => {
    const entry = viewEntry(state, stored)
    const sets = []
    for (const s of entry.sets || []) {
      if (isWarmupRow(s) || !hasCompletedWork(s)) continue
      const rows = isSideSet(s) ? ['L', 'R'].filter(side => s.sides[side].done === true).map(side => ({ s: s.sides[side], side })) : [{ s }]
      for (const item of rows) {
        const r = item.s, out = { mode: modeForSet(s, entry.target), type: setType(r), ...(item.side ? { side: item.side } : {}) }
        for (const [key, publicKey] of Object.entries({ w: 'weight', r: 'reps', sec: 'seconds', min: 'minutes', speed: 'speedKmh', incline: 'incline' })) {
          if (finite(r[key])) out[publicKey] = r[key]
        }
        if (out.type === 'dropset') out.drops = dropsOf(r).map(d => ({ weight: Number(d.w) || 0, reps: Number(d.r) || 0 }))
        if (out.type === 'restpause') out.clusters = clustersOf(r).map(c => ({ reps: Number(c.r) || 0 }))
        sets.push(out)
      }
    }
    return { name: nameOf(entry), unit: exUnitOf(state, entry.id), sets }
  }).filter(e => e.sets.length)
  const duration = workoutDuration(workout)
  return snapshotFields({ version: 1, title: String(workout.name || ''), date: workoutDay(workout),
    durationSec: duration > 0 ? Math.round(duration / 1000) : null, exercises })
}
