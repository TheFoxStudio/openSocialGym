import { it, expect, vi } from 'vitest'
import { buildSocialExport } from './social-export.js'
import { readZip } from './zip.js'
const id = '12345678-1234-1234-1234-123456789abc'
function harness() {
  const h = { scope: 'one', readPage: vi.fn(async section => ({ ownerId: 'user', items: section === 'posts' ? [{ id, authorId: 'user', assetId: id }] : [], nextCursor: null })),
    photo: vi.fn(async () => new Blob(['image'])), avatar: vi.fn(), wait: vi.fn(async () => {}), drafts: vi.fn(async () => [{ scope: 'one', caption: 'draft', requestId: 'secret', confirmed: true, photo: new Blob(['draft image']) }]) }
  h.run = () => buildSocialExport({ ...h, scope: 'one', userId: 'user', currentScope: () => h.scope })
  return h
}
it('exports owner data and photos in a readable ZIP while excluding queued request credentials', async () => {
  const h = harness(), entries = await readZip(await h.run())
  expect(entries.map(e => e.name)).toEqual(['photos/' + id + '.webp', 'drafts/0.webp', 'social.json'])
  const manifest = JSON.parse(await entries.at(-1).blob.text())
  expect(manifest.ownerId).toBe('user'); expect(manifest.data.drafts[0].caption).toBe('draft')
  expect(JSON.stringify(manifest)).not.toContain('secret'); expect(manifest.data.drafts[0].confirmed).toBeUndefined()
  expect(h.photo).toHaveBeenCalledWith(id, id)
})
it('cancels exports after identity changes, retries rate limits, and records concurrently deleted images', async () => {
  const h = harness(); h.readPage.mockRejectedValueOnce(Object.assign(Error(), { status: 429, data: { retryAfter: 2 } }))
  h.photo.mockRejectedValue(Object.assign(Error(), { status: 404 }))
  const entries = await readZip(await h.run()), manifest = JSON.parse(await entries.at(-1).blob.text())
  expect(h.wait).toHaveBeenCalledWith(2000); expect(manifest.missingFiles).toEqual(['photos/' + id + '.webp'])
  h.readPage.mockImplementation(async () => { h.scope = 'two'; return { ownerId: 'user', items: [], nextCursor: null } })
  await expect(h.run()).rejects.toThrow('export-context-changed')
})
it('rejects a wrong owner and repeated pagination tokens', async () => {
  const h = harness(); h.readPage.mockResolvedValue({ ownerId: 'other', items: [], nextCursor: null })
  await expect(h.run()).rejects.toThrow('export-context-changed')
  h.readPage.mockResolvedValue({ ownerId: 'user', items: [], nextCursor: 'repeat' })
  await expect(h.run()).rejects.toThrow('export-pagination')
})
