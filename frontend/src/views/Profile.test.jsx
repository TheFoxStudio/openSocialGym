// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Profile from './Profile.jsx'

vi.mock('./Posts.jsx',()=>({default:({profileId,embedded})=><section data-testid="profile-posts">{profileId}:{String(embedded)}</section>}))
vi.mock('../components/ProfilePhotos.jsx',()=>({default:({posts})=><div data-testid="profile-photos">{posts.length}</div>}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({
  state: {}, id: undefined, nav: vi.fn(), read: vi.fn(), save: vi.fn(), remove: vi.fn(), prepare: vi.fn(), upload: vi.fn(), avatar: vi.fn(), removeAvatar: vi.fn(), follow: vi.fn(), block: vi.fn()
}))
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(h.state)
  useStore.getState = () => h.state
  return { useStore }
})
vi.mock('react-router-dom', () => ({ useParams: () => ({ id: h.id }), useNavigate: () => h.nav }))
vi.mock('../lib/i18n.js', () => ({ t: key => key }))
vi.mock('../lib/social-api.js', () => ({
  socialScope: user => JSON.stringify([h.state.sync?.server, user?.id]),
  socialAvailable: (user, config) => !!user && config?.social?.enabled === true && config.social.version === 1,
  readProfile: (...args) => h.read(...args), saveProfile: (...args) => h.save(...args), removeProfile: (...args) => h.remove(...args),
  prepareAvatar: (...args) => h.prepare(...args), uploadAvatar: (...args) => h.upload(...args), avatarBlob: (...args) => h.avatar(...args), removeAvatar: (...args) => h.removeAvatar(...args),
  setFollow: (...args) => h.follow(...args), setBlock: (...args) => h.block(...args)
}))
vi.mock('../components/ui.jsx', () => ({ Button: ({ children, variant, ...props }) => <button {...props}>{children}</button> }))

let host, root
const profile = (fields = {}) => ({ id: 'one', handle: 'lifter', displayName: 'One Lifter', bio: 'Hello', revision: 1, avatarId: null, ...fields })
const render = () => act(async () => { root.render(<Profile />) })
const click = text => act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === text).click() })
const fill = (name, value) => act(async () => {
  const el = host.querySelector(`[name="${name}"]`)
  const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set
  setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true }))
})
beforeEach(() => {
  vi.clearAllMocks()
  h.id = undefined
  h.state = { user: { id: 'one' }, config: { social: { enabled: true, version: 1, graph: true } }, sync: { server: 'https://gym.example' } }
  h.read.mockResolvedValue({ profile: null }); h.avatar.mockResolvedValue(new Blob(['avatar']))
  h.prepare.mockResolvedValue(new Blob(['photo'], { type: 'image/webp' }))
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:avatar'), revokeObjectURL: vi.fn() }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('social profile', () => {
  it('follows, unfollows and confirms a block before clearing the displayed profile', async () => {
    h.id = 'two'
    h.read.mockResolvedValue({ profile: profile({ id: 'two' }), relationship: { isFollowing: false, followerCount: 0, followingCount: 0 } })
    h.follow.mockResolvedValueOnce({ relationship: { isFollowing: true, followerCount: 1, followingCount: 0 } })
      .mockResolvedValueOnce({ relationship: { isFollowing: false, followerCount: 0, followingCount: 0 } })
    h.block.mockResolvedValue({ ok: true })
    await render(); await click('Follow member'); expect(h.follow).toHaveBeenCalledWith('two', true)
    expect(host.querySelector('.profile-statistics').textContent).toContain('1Followers')
    await click('Unfollow member'); expect(h.follow).toHaveBeenLastCalledWith('two', false)
    await click('Block member'); expect(h.block).not.toHaveBeenCalled()
    await act(async () => [...host.querySelectorAll('button')].filter(b => b.textContent === 'Block member').at(-1).click())
    expect(h.block).toHaveBeenCalledWith('two', true); expect(host.textContent).not.toContain('@lifter')
    expect(h.nav).toHaveBeenCalledWith('/social/people', { replace: true })
  })
  it('gates local accounts, legacy servers and disabled servers without sending social requests', async () => {
    h.state.user = null; await render(); expect(h.read).not.toHaveBeenCalled()
    h.state.user = { id: 'one' }; h.state.config = {}; await render(); expect(h.read).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Connect to a server')
    await click('Server & sync'); expect(h.nav).toHaveBeenCalledWith('/settings')
  })
  it('requires explicit opt-in and submits only the profile fields', async () => {
    h.save.mockResolvedValue({ profile: profile() })
    await render(); expect(host.querySelector('button[type=submit]').disabled).toBe(true)
    await fill('handle', 'lifter'); await fill('displayName', 'One Lifter')
    await act(async () => host.querySelector('[name=accepted]').click())
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(h.save).toHaveBeenCalledWith({ handle: 'lifter', displayName: 'One Lifter', bio: '', accepted: true, revision: undefined })
    expect(host.textContent).toContain('@lifter'); expect(h.upload).not.toHaveBeenCalled()
  })
  it('keeps an unsuccessful photo upload retryable with the latest saved revision', async () => {
    h.read.mockResolvedValue({ profile: profile() }); h.save.mockResolvedValue({ profile: profile({ revision: 2 }) })
    h.upload.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ profile: profile({ revision: 4, avatarId: 'new' }) })
    await render(); await click('Edit profile')
    const input = host.querySelector('input[type=file]')
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['photo'], 'pic.jpg')] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    const submit = () => act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await submit(); expect(host.textContent).toContain('Could not save your profile')
    expect(host.querySelector('img').src).toBe('blob:avatar')
    h.save.mockResolvedValue({ profile: profile({ revision: 3 }) }); await submit()
    expect(h.save.mock.lastCall[0].revision).toBe(2); expect(h.upload).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('@lifter')
  })
  it('does not show late data from an account or server that was disconnected', async () => {
    let answer
    h.read.mockImplementationOnce(() => new Promise(resolve => { answer = resolve }))
    await render()
    h.state = { ...h.state, user: { id: 'two' } }
    h.read.mockResolvedValue({ profile: profile({ id: 'two', displayName: 'Second member' }) })
    await render()
    await act(async () => answer({ profile: profile({ displayName: 'Private stale name' }) }))
    expect(host.textContent).toContain('Second member'); expect(host.textContent).not.toContain('Private stale name')
  })
  it('renders another member as read-only and supports own profile removal', async () => {
    h.id = 'two'; h.read.mockResolvedValue({ profile: profile({ id: 'two' }) })
    await render(); expect(host.textContent).not.toContain('Edit profile'); expect(host.querySelector('form')).toBeNull()
    h.id = undefined; h.read.mockResolvedValue({ profile: profile() }); h.remove.mockResolvedValue({ ok: true })
    await render(); await click('Remove social profile')
    expect(h.remove).not.toHaveBeenCalled()
    await act(async () => [...host.querySelectorAll('button')].filter(b => b.textContent === 'Remove social profile').at(-1).click())
    expect(h.remove).toHaveBeenCalledOnce(); expect(host.querySelector('[name=accepted]')).not.toBeNull()
  })
})

it('keeps account actions in a closed menu and places photos before the embedded timeline',async()=>{
 h.state.config.social.posts=true;
 h.read.mockResolvedValue({profile:profile(),relationship:{followingCount:3,followerCount:8},overview:{totalWorkouts:12,totalVolumeKg:1500,photos:[{}]}});
 await render();expect(host.querySelector('.profile-menu').open).toBe(false);
 expect(host.querySelector('.profile-statistics').textContent).toContain('12Total workouts');
 expect(host.textContent).not.toContain('Following timeline');
 expect(host.textContent).not.toContain('Find friends');
 await click('Following');expect(h.nav).toHaveBeenCalledWith('/social/profiles/one/following');
 expect(host.querySelector('[data-testid=profile-photos]').compareDocumentPosition(host.querySelector('[data-testid=profile-posts]'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
