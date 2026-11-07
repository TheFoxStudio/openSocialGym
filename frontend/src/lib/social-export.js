import { zipStore } from './zip.js'
const SECTIONS = ['profile', 'posts', 'following', 'followers', 'blocks', 'reports']
const UUID = /^[a-f0-9-]{36}$/
export async function buildSocialExport({ scope, userId, currentScope, readPage, photo, avatar, drafts = async () => [], progress = () => {}, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  const check = () => { if (currentScope() !== scope) throw Error('export-context-changed') }
  const retry = async fn => {
    for (let tries = 0; ; tries++) {
      check()
      try { const value = await fn(); check(); return value }
      catch (e) { if (e.status !== 429 || tries >= 3) throw e; await wait(Math.min(60000, Math.max(1000, (e.data?.retryAfter || 60) * 1000))); check() }
    }
  }
  const manifest = { version: 1, ownerId: userId, exportedAt: new Date().toISOString(), data: {}, missingFiles: [] }, entries = []
  let metadataBytes = 0, fileBytes = 0
  const add = (name, blob) => { fileBytes += blob.size; if (fileBytes > 150 * 1024 * 1024 || entries.length >= 1998) throw Error('export-too-large'); entries.push({ name, blob }) }
  for (const section of SECTIONS) {
    const items = [], seen = new Set(); let cursor
    do {
      progress(section); const page = await retry(() => readPage(section, cursor))
      if (page.ownerId !== userId) throw Error('export-context-changed')
      metadataBytes += new Blob([JSON.stringify(page.items)]).size
      if (metadataBytes > 25 * 1024 * 1024 || items.length + page.items.length > 20000) throw Error('export-too-large')
      items.push(...page.items); cursor = page.nextCursor
      if (cursor && (seen.has(cursor) || seen.size >= 1000)) throw Error('export-pagination')
      if (cursor) seen.add(cursor)
    } while (cursor)
    manifest.data[section] = items
  }
  const image = async (name, fn) => {
    try { progress(name); add(name, await retry(fn)) }
    catch (e) { if (e.status === 404) manifest.missingFiles.push(name); else throw e }
  }
  const p = manifest.data.profile[0]
  if (p?.avatarId) await image('avatar.webp', () => avatar(p))
  for (const post of manifest.data.posts) if (post.assetId) {
    if (!UUID.test(post.id) || post.authorId !== userId) throw Error('export-context-changed')
    await image('photos/' + post.id + '.webp', () => photo(post.id, post.assetId))
  }
  check(); const local = await drafts(); check()
  manifest.data.drafts = []
  for (const d of local) {
    if (d.scope !== scope) throw Error('export-context-changed')
    const photoPath = d.photo ? 'drafts/' + manifest.data.drafts.length + '.webp' : null
    if (photoPath) add(photoPath, d.photo)
    const item = { sourceWorkoutId: d.sourceWorkoutId, snapshot: d.snapshot, caption: d.caption, audience: d.audience, status: d.status, photoPath }
    metadataBytes += new Blob([JSON.stringify(item)]).size
    if (metadataBytes > 25 * 1024 * 1024) throw Error('export-too-large')
    manifest.data.drafts.push(item)
  }
  add('social.json', new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }))
  check(); const archive = await zipStore(entries); check(); return archive
}
