// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Home from './Home.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ state: {}, nav: vi.fn() }))
vi.mock('../store/useStore.js', () => ({ useStore: fn => fn(h.state) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('../components/SyncBanner.jsx', () => ({ useConnectionTrouble: () => false }))
vi.mock('../components/Icon.jsx', () => ({ default: () => null }))
vi.mock('./Feed.jsx', () => ({ default: ({ embedded }) => <section data-feed={embedded ? 'embedded' : 'full'}>Following timeline</section> }))
vi.mock('../components/ui.jsx', () => ({ Button: ({ children, variant, size, trailingIcon, ...props }) => <button {...props}>{children}</button> }))
let root, host
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 6, 12))
  h.nav.mockClear(); h.state = { S: { workouts: [], weekStart: 1 }, user: { id: 'one' } }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })
const render = () => act(async () => root.render(<Home />))
const workout = (d, minutes) => ({ d, start: 1000, end: 1000 + minutes * 60000 })
it('shows a compact weekly summary before the embedded feed and opens detailed stats', async () => {
  h.state.S.workouts = [workout('2026-11-01', 60), workout('2026-11-02', 30), workout('2026-11-06', 45), workout('2026-11-07', 20)]
  await render()
  expect([...host.querySelectorAll('dd')].map(el => el.textContent)).toEqual(['2', '1h 15m'])
  expect(host.querySelector('.home-summary-total strong').textContent).toBe('4')
  expect(host.querySelector('[data-feed="embedded"]')).not.toBeNull()
  expect(host.querySelector('.home-summary').compareDocumentPosition(host.querySelector('[data-feed]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(host.querySelector('.today-row')).toBeNull(); expect(host.querySelector('.streak-card')).toBeNull()
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Stats').click())
  expect(h.nav).toHaveBeenCalledWith('/stats')
})
it('respects a Sunday week start and handles empty history', async () => {
  h.state.S = { workouts: [workout('2026-11-01', 60)], weekStart: 0 }; await render()
  expect(host.querySelector('dd').textContent).toBe('1')
  h.state.S = { workouts: [], weekStart: 0 }; await render()
  expect([...host.querySelectorAll('dd')].map(el => el.textContent)).toEqual(['0', '0 min'])
})
