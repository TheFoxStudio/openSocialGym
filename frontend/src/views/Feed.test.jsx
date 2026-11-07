// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Feed from './Feed.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ state: {}, feed: vi.fn(), check: vi.fn(), change: null }))
vi.mock('../store/useStore.js', () => { const useStore = f => f(h.state); useStore.getState = () => h.state; return { useStore } })
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../lib/i18n.js', () => ({ t: k => k }))
vi.mock('../lib/social-api.js', () => ({ socialScope: u => u?.id, socialFeedAvailable: (u, c) => !!u && c?.social?.feed, readFeed: (...a) => h.feed(...a), checkFeed: (...a) => h.check(...a) }))
vi.mock('../lib/social-events.js', () => ({ onSocialChange: fn => { h.change = fn; return () => {} } }))
vi.mock('../components/SocialPostCard.jsx', () => ({ default: ({ post }) => <article>{post.caption}</article> }))
vi.mock('../components/ui.jsx', () => ({ Button: ({ variant, size, ...p }) => <button {...p} /> }))
let root, host
beforeEach(() => {
  vi.clearAllMocks(); h.state = { user: { id: 'one' }, config: { social: { feed: true } } }
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  h.feed.mockResolvedValue({ viewerId: 'one', posts: [{ id: 'a', caption: 'First' }], nextCursor: 'next' })
  h.check.mockResolvedValue({ viewerId: 'one', posts: [] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const render = () => act(async () => root.render(<Feed />))
const click = text => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === text).click())
it('uses a section heading on Home and loads another page when scrolling near the end', async () => {
  let intersect
  vi.stubGlobal('IntersectionObserver', class { constructor(fn) { intersect = fn } observe() {} disconnect() {} })
  try {
    await act(async () => root.render(<Feed embedded />))
    expect(host.querySelector('h1')).toBeNull(); expect(host.querySelector('h2').textContent).toBe('Following timeline')
    h.feed.mockResolvedValue({ viewerId: 'one', posts: [{ id: 'b', caption: 'Next page' }], nextCursor: null })
    await act(async () => intersect([{ isIntersecting: true }]))
    expect(h.feed).toHaveBeenLastCalledWith('next'); expect(host.textContent).toContain('Next page')
  } finally { vi.unstubAllGlobals() }
})
it('reauthorizes displayed posts before adding another page and deduplicates pages', async () => {
  await render(); expect(host.textContent).toContain('First')
  h.check.mockResolvedValue({ viewerId: 'one', posts: [{ id: 'a', caption: 'Updated' }] })
  h.feed.mockResolvedValue({ viewerId: 'one', posts: [{ id: 'a', caption: 'Updated' }, { id: 'b', caption: 'Second' }], nextCursor: null })
  await click('Load more'); expect(h.check).toHaveBeenCalledWith(['a']); expect(host.querySelectorAll('article')).toHaveLength(2)
  expect(host.textContent).not.toContain('First'); expect(host.textContent).toContain('Updated')
})
it('purges cached cards on offline events and failed refreshes, then reloads on reconnect', async () => {
  await render(); await act(async () => window.dispatchEvent(new Event('offline')))
  expect(host.querySelector('article')).toBeNull(); expect(host.textContent).toContain('Reconnect')
  await act(async () => window.dispatchEvent(new Event('online'))); expect(host.textContent).toContain('First')
  h.feed.mockRejectedValue(Error('unavailable')); await act(async () => h.change())
  expect(host.querySelector('article')).toBeNull(); expect(host.textContent).toContain('Could not load')
})
it('rejects responses for a different session and ignores responses after an account switch', async () => {
  h.feed.mockResolvedValue({ viewerId: 'two', posts: [{ id: 'private', caption: 'Other account' }] }); await render()
  expect(host.textContent).not.toContain('Other account'); expect(host.textContent).toContain('Your account changed')
  let finish; h.feed.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await act(async () => h.change()); h.state.user = { id: 'two' }
  await act(async () => finish({ viewerId: 'one', posts: [{ id: 'late', caption: 'Late private post' }] }))
  expect(host.textContent).not.toContain('Late private post')
})
