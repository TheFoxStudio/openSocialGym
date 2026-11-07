// @vitest-environment happy-dom
// The completion summary saves privately or opens the social composer.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkoutNow } from './sheets.jsx'
import { setNav } from './lib/nav.js'

const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
let host
function renderTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
}
const settle = () => act(async () => {})

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], timer: null, work: null })
  const st = clone(DEF)
  st.routines = [{ id: 'r1', name: 'Push A', ex: [{ id: '0025', sets: 1, reps: 5, weight: 60 }] }]
  st.active = { id: 'fin', d: '2026-09-28', start: Date.now() - 20 * 60000, routineIds: ['r1'], routineId: 'r1', name: 'Push A', bw: null, cur: 0,
    entries: [{ id: '0025', rid: 'r1', target: { sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }] }
  useStore.setState({ S: st, user: null })
})
afterEach(() => {
  setNav(() => {})
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
})

describe('finish summary: Share', () => {
  it('opens social sharing only after saving the workout, including local mode', async () => {
    const destinations = []; setNav(to => destinations.push(to))
    act(() => finishWorkoutNow()); renderTopSheet(); await settle()
    expect(useStore.getState().S.workouts.some(w => w.id === 'fin')).toBe(true)
    const social = [...host.querySelectorAll('.fin-actions button')].find(b => b.textContent === 'Share to feed')
    act(() => social.click())
    expect(destinations).toEqual(['/social/share/fin'])
    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts.some(w => w.id === 'fin')).toBe(true)
  })
  it('sits beside the way out, which still comes right after the numbers', async () => {
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    const row = host.querySelector('.fin-actions')
    expect(row).toBeTruthy()
    const [social, done] = row.querySelectorAll('button')
    expect(done.textContent).toBe('Save')
    expect(social.textContent).toBe('Share to feed')
    expect(row.querySelectorAll('button')).toHaveLength(2)
    expect(social.className).toContain('primary')
    expect(host.querySelector('[data-fin-share]')).toBeNull()
    // Nothing but the numbers and the records list between the title and the way out.
    const tiles = host.querySelector('.tiles.fin')
    expect(tiles.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(host.querySelector('.finish-overview .bodymap')?.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Save leaves the finished workout private and returns home',async()=>{
    const destinations=[];setNav(to=>destinations.push(to));act(()=>finishWorkoutNow());renderTopSheet();await settle();
    act(()=>[...host.querySelectorAll('.fin-actions button')].find(b=>b.textContent==='Save').click());
    expect(destinations).toEqual(['/home']);expect(useStore.getState().S.workouts.some(w=>w.id==='fin')).toBe(true);
    expect(host.querySelector('.finish-overview .finish-muscles .bodymap')).toBeTruthy();
  })
})
