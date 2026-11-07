// This database contains only explicit post previews and selected processed photos.
// Credentials and the private workout document never enter it.
const DATABASE = 'opensocialgym-social-drafts'
export const draftKey = (scope, source) => JSON.stringify([scope, source])
export const postRequestId = () => {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128
  const s = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}
function open() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('draft-storage'))
    const req = indexedDB.open(DATABASE, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('drafts', { keyPath: 'key' }).createIndex('scope', 'scope')
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('draft-storage'))
    req.onsuccess = () => resolve(req.result)
  })
}
async function transaction(mode, action) {
  const db = await open()
  return new Promise((resolve, reject) => {
    let result
    const tx = db.transaction('drafts', mode)
    try { const request = action(tx.objectStore('drafts')); request.onsuccess = () => { result = request.result } }
    catch (e) { tx.abort(); db.close(); reject(e); return }
    tx.oncomplete = () => { db.close(); resolve(result) }
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('draft-storage')) }
  })
}
let writes = Promise.resolve()
const write = action => { const next = writes.catch(() => {}).then(action); writes = next; return next }
export const readDraft = async (scope, source) => { await writes.catch(() => {}); return transaction('readonly', store => store.get(draftKey(scope, source))) }
export const listDrafts = async scope => { await writes.catch(() => {}); return transaction('readonly', store => store.index('scope').getAll(scope)) }
export const saveDraft = draft => write(() => transaction('readwrite', store => store.put({ ...draft, key: draftKey(draft.scope, draft.sourceWorkoutId) })))
export const deleteDraft = (scope, source) => write(() => transaction('readwrite', store => store.delete(draftKey(scope, source))))
export async function clearDrafts(scope) { for (const draft of await listDrafts(scope)) await deleteDraft(scope, draft.sourceWorkoutId) }

// Network code is injected so crash/retry/identity cases can be tested without a UI.
export async function sendDraft(draft, { currentScope, sourceExists, transport, persist = saveDraft, remove = deleteDraft }) {
  const valid = () => currentScope() === draft.scope && (draft.postId || sourceExists(draft.sourceWorkoutId))
  if (!draft.confirmed || !['pending', 'failed'].includes(draft.status)) throw new Error('publish-not-confirmed')
  if (!valid()) throw new Error('draft-context-changed')
  try {
    if (draft.photo) {
      await transport.upload(draft.assetId, draft.photo)
      if (!valid()) throw new Error('draft-context-changed')
    }
    const { photo, key, scope, status, confirmed, ...payload } = draft
    if (!valid()) throw new Error('draft-context-changed')
    const { post } = await transport.publish(payload, draft.postId)
    // Do not touch another identity's UI or drafts after the request returns.
    if (!valid()) throw new Error('draft-context-changed')
    await remove(draft.scope, draft.sourceWorkoutId)
    return post
  } catch (e) {
    if (e.message !== 'draft-context-changed') await persist({ ...draft, status: 'failed', confirmed: !(e.status >= 400 && e.status < 500 && e.status !== 429) })
    throw e
  }
}
