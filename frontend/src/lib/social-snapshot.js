import { snapshotFields } from '../../../api/social/snapshot.js'
import { hasCompletedWork, isSideSet, isWarmupRow, modeForSet, setType, dropsOf, clustersOf } from './workout-model.js'
import { viewEntry, exUnitOf } from './ex-unit.js'
import { workoutDay, workoutDuration, workoutVolume } from './history.js'
import { EXIDX } from './exercises.js'
import { legacySyncKey } from './workout-date.js'

export const socialWorkoutId = w => String(w?.id ?? legacySyncKey(w))
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
export function averageHeartRateOf(workout) {
  const valid=x=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<=300
  if(valid(workout?.hr?.avg))return Math.round(workout.hr.avg)
  const rows=(workout?.entries||[]).flatMap(e=>e.sets||[]).filter(s=>!isWarmupRow(s)&&hasCompletedWork(s))
  const samples=rows.flatMap(s=>isSideSet(s)?['L','R'].filter(k=>s.sides[k].done).map(k=>s.sides[k].hr):[s.hr]).filter(h=>valid(h?.avg))
  const weight=h=>Number.isFinite(h.n)&&h.n>0&&h.n<=1e6?h.n:1
  const n=samples.reduce((a,h)=>a+weight(h),0)
  return n?Math.round(samples.reduce((a,h)=>a+h.avg*weight(h),0)/n):null
}
export function buildSocialSnapshot(workout, state, nameOf = e => e.n || e.name || String(e.id), { shareHeartRate=false } = {}) {
  const unit=state.unit==='lb'?'lb':'kg'
  let volume=0
  const exercises = (workout?.entries || []).map(stored => {
    const entry = viewEntry(state, stored)
    const entryUnit=exUnitOf(state,entry.id)
    volume+=workoutVolume({entries:[entry]})*(entryUnit===unit?1:entryUnit==='lb'?0.45359237:1/0.45359237)
    const sets = [];let setCount=0
    for (const s of entry.sets || []) {
      if (isWarmupRow(s) || !hasCompletedWork(s)) continue
      setCount++
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
    return { name: nameOf(entry), unit: entryUnit, sets, setCount, ...(EXIDX[entry.id]?{catalogId:String(entry.id)}:{}) }
  }).filter(e => e.sets.length)
  const duration = workoutDuration(workout)
  return snapshotFields({ version: 1, title: String(workout.name || ''), date: workoutDay(workout),
    durationSec: duration > 0 ? Math.round(duration / 1000) : null, exercises,
    totalVolume:Math.round(volume*100)/100,volumeUnit:unit,records:Array.isArray(workout.prs)?new Set(workout.prs).size:0,
    ...(shareHeartRate&&averageHeartRateOf(workout)?{averageHeartRate:averageHeartRateOf(workout)}:{}) })
}
