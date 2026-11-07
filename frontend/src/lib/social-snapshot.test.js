import { describe, it, expect } from 'vitest'
import { buildSocialSnapshot, socialWorkoutId } from './social-snapshot.js'
const workout = patch => ({ id: 'session', d: '2026-11-06', start: 1000, end: 3601000, name: 'Training', bw: 80, note: 'Private session note', gym: { name: 'Private gym' },
  media: [{ hash: 'private-photo' }], entries: [{ id: 'custom', note: 'Private injury', target: { mode: 'reps' }, sets: [{ done: true, w: 50, r: 6, hr: 160, note: 'Private set', media: { hash: 'form-video' } }] }], ...patch })
describe('social workout snapshot', () => {
  it('shares only completed work with no private notes, health, bodyweight, location or attachments', () => {
    const w = workout({}), before = JSON.stringify(w), result = buildSocialSnapshot(w, { unit: 'kg' }, () => 'Custom squat')
    expect(result.exercises[0].name).toBe('Custom squat')
    expect(result.exercises[0].sets[0]).toEqual({ mode: 'reps', type: 'straight', weight: 50, reps: 6 })
    for (const word of ['Private', 'private-photo', 'form-video', '"bw"', '"hr"']) expect(JSON.stringify(result)).not.toContain(word)
    expect(JSON.stringify(w)).toBe(before)
  })
  it('preserves unit pins, completed sides, holds, cardio, drop sets and rest-pause totals without warmups', () => {
    const w = workout({ entries: [
      { id: 'lift', sets: [{ warmup: true, done: true, w: 5, r: 10 }, { done: false, w: 10, r: 3 }, { sides: { L: { done: true, w: 10, r: 5 }, R: { done: false, w: 20, r: 6 } } }] },
      { id: 'hold', target: { mode: 'time' }, sets: [{ done: true, sec: 30 }] },
      { id: 'run', target: { mode: 'cardio' }, sets: [{ done: true, min: 20, speed: 10, incline: 2 }] },
      { id: 'drop', sets: [{ done: true, w: 50, r: 5, type: 'dropset', drops: [{ w: 40, r: 6, note: 'secret' }] }] },
      { id: 'rest', sets: [{ done: true, w: 30, r: 12, type: 'restpause', clusters: [{ r: 6, restSec: 20 }, { r: 3 }, { r: 3 }] }] }
    ] })
    const s = buildSocialSnapshot(w, { unit: 'kg', exUnit: { lift: { unit: 'lb' } } }, e => e.id)
    expect(s.exercises[0].unit).toBe('lb'); expect(s.exercises[0].sets).toHaveLength(1)
    expect(s.exercises[0].sets[0].side).toBe('L'); expect(s.exercises[0].sets[0].weight).toBeCloseTo(22.046, 2)
    expect(s.exercises[1].sets[0].seconds).toBe(30); expect(s.exercises[2].sets[0].speedKmh).toBe(10)
    expect(s.exercises[3].sets[0].drops).toEqual([{ weight: 40, reps: 6 }])
    expect(s.exercises[4].sets[0].reps).toBe(12); expect(s.exercises[4].sets[0].clusters).toEqual([{ reps: 6 }, { reps: 3 }, { reps: 3 }])
  })
  it('uses the existing legacy workout identity and refuses empty/inconsistent snapshots', () => {
    const w = workout({ id: undefined }); expect(socialWorkoutId(w)).toBe('2026-11-06|1000')
    expect(socialWorkoutId({ ...w, id: socialWorkoutId(w) })).toBe(socialWorkoutId(w))
    expect(() => buildSocialSnapshot(workout({ entries: [] }), {})).toThrow()
  })
})
