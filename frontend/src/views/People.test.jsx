// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import People from './People.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ state: {}, nav: vi.fn(), read: vi.fn(), block: vi.fn() }))
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(h.state); useStore.getState = () => h.state; return { useStore }
})
vi.mock('react-router-dom', () => ({ useParams: () => ({ id: 'one' }), useNavigate: () => h.nav }))
vi.mock('../lib/i18n.js', () => ({ t: key => key }))
vi.mock('../components/ui.jsx', () => ({ Button: ({ children, variant, size, ...props }) => <button {...props}>{children}</button> }))
vi.mock('../lib/social-api.js', () => ({
  socialScope: user => JSON.stringify([h.state.sync?.server, user?.id]),
  socialGraphAvailable: (u, c) => !!u && c?.social?.graph === true,
  readPeople: (...a) => h.read(...a), setBlock: (...a) => h.block(...a)
}))
let host, root
const person = (id, name) => ({ id, displayName: name, handle: name.toLowerCase() })
const render = (kind = 'people') => act(async () => root.render(<People kind={kind} />))
const click = text => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === text).click())
beforeEach(() => {
  vi.resetAllMocks()
  h.state = { user: { id: 'one' }, config: { social: { graph: true } }, sync: { server: 'https://gym.example' } }
  h.read.mockResolvedValue({ people: [], nextCursor: null })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
it('loads pages, deduplicates members and opens the selected profile', async () => {
  h.read.mockResolvedValueOnce({ people: [person('two', 'Alice')], nextCursor: 'next' })
    .mockResolvedValueOnce({ people: [person('two', 'Alice'), person('three', 'Bea')], nextCursor: null })
  await render(); await click('Load more')
  expect(h.read).toHaveBeenLastCalledWith({ kind: 'people', id: 'one', query: '', cursor: 'next' })
  expect(host.querySelectorAll('.social-person')).toHaveLength(2)
  await act(async () => host.querySelector('.social-person-link').click())
  expect(h.nav).toHaveBeenCalledWith('/social/profiles/two')
})
it('clears stale results on an access failure instead of keeping blocked members visible', async () => {
  h.read.mockResolvedValueOnce({ people: [person('two', 'Alice')], nextCursor: 'next' }).mockRejectedValueOnce(new Error('not found'))
  await render(); await click('Load more')
  expect(host.textContent).not.toContain('Alice'); expect(host.querySelector('[role=alert]')).not.toBeNull()
})
it('only sends explicit unblock actions for the own management list and refreshes afterwards', async () => {
  h.read.mockResolvedValueOnce({ people: [person('two', 'Alice')], nextCursor: null }).mockResolvedValueOnce({ people: [], nextCursor: null })
  h.block.mockResolvedValue({ ok: true })
  await render('blocks'); expect(host.querySelector('.social-person-link')).toBeNull()
  await click('Unblock member'); expect(h.block).toHaveBeenCalledWith('two', false)
  expect(host.textContent).toContain('No members found.')
})
it('ignores old-account results and gates servers without graph support', async () => {
  let resolve
  h.read.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  await render(); h.state = { ...h.state, user: null }; await render()
  await act(async () => resolve({ people: [person('two', 'Private stale name')], nextCursor: null }))
  expect(host.textContent).not.toContain('Private stale name')
  expect(host.textContent).toContain('Connect to a server')
})

it('offers friend discovery and blocked members in your Following list',async()=>{
 await render('following');await click('Find friends');expect(h.nav).toHaveBeenCalledWith('/social/people');
 await click('Blocked members');expect(h.nav).toHaveBeenCalledWith('/social/blocks');
});
