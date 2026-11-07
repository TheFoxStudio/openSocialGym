import { describe, it, expect, vi } from 'vitest'
import { sendDraft, draftKey } from './social-drafts.js'
const intent = extra => ({ scope: 'server-a/account-one', sourceWorkoutId: 'workout', requestId: 'stable-request', confirmed: true, status: 'pending', photo: null, ...extra })
function harness() {
  const h = { scope: 'server-a/account-one', exists: true, persist: vi.fn(async () => {}), remove: vi.fn(async () => {}),
    transport: { upload: vi.fn(async () => {}), publish: vi.fn(async () => ({ post: { id: 'one-post' } })) } }
  h.opts = { currentScope: () => h.scope, sourceExists: () => h.exists, transport: h.transport, persist: h.persist, remove: h.remove }
  return h
}
describe('confirmed social publishing', () => {
  it('never publishes ordinary drafts or a different account/server/source', async () => {
    const h = harness()
    await expect(sendDraft(intent({ confirmed: false, status: 'draft' }), h.opts)).rejects.toThrow('publish-not-confirmed')
    h.scope = 'server-b/account-one'; await expect(sendDraft(intent(), h.opts)).rejects.toThrow('draft-context-changed')
    h.scope = 'server-a/account-one'; h.exists = false; await expect(sendDraft(intent(), h.opts)).rejects.toThrow('draft-context-changed')
    expect(h.transport.publish).not.toHaveBeenCalled()
    expect(draftKey('server-a/account-one', 'workout')).not.toBe(draftKey('server-a/account-two', 'workout'))
  })
  it('keeps a confirmed failed request stable across lost responses and does not send Blob/local state in JSON', async () => {
    const h = harness(), d = intent({ photo: new Blob(['photo']), assetId: 'photo-id' })
    h.transport.publish.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ post: { id: 'same-post' } })
    await expect(sendDraft(d, h.opts)).rejects.toThrow('response lost')
    const failed = h.persist.mock.calls[0][0]; expect(failed.confirmed).toBe(true); expect(failed.requestId).toBe(d.requestId)
    expect(await sendDraft(failed, h.opts)).toEqual({ id: 'same-post' })
    const body = h.transport.publish.mock.lastCall[0]
    expect(body.photo).toBeUndefined(); expect(body.scope).toBeUndefined(); expect(body.requestId).toBe('stable-request')
    expect(h.remove).toHaveBeenCalledWith(d.scope, d.sourceWorkoutId)
  })
  it('stops after image upload if the workout was removed or the identity changed', async () => {
    const h = harness(); h.transport.upload.mockImplementation(async () => { h.exists = false })
    await expect(sendDraft(intent({ photo: new Blob(['photo']), assetId: 'photo-id' }), h.opts)).rejects.toThrow('draft-context-changed')
    expect(h.transport.publish).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled()
  })
  it('does not clear or update another identity after a publish resolves', async () => {
    const h = harness(); h.transport.publish.mockImplementation(async () => { h.scope = 'other'; return { post: { id: 'saved' } } })
    await expect(sendDraft(intent(), h.opts)).rejects.toThrow('draft-context-changed')
    expect(h.remove).not.toHaveBeenCalled(); expect(h.persist).not.toHaveBeenCalled()
  })
  it('requires review again after revoked authentication/profile conflicts, but allows edits after private workout deletion', async () => {
    const h = harness(); h.transport.publish.mockRejectedValueOnce(Object.assign(new Error('profile changed'), { status: 409 }))
    await expect(sendDraft(intent(), h.opts)).rejects.toThrow(); expect(h.persist.mock.calls[0][0].confirmed).toBe(false)
    h.exists = false; expect(await sendDraft(intent({ postId: 'existing-post' }), h.opts)).toEqual({ id: 'one-post' })
  })
})
