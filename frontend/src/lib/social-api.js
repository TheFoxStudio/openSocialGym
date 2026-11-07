import { api, apiBlob, apiUpload, remoteAuth, appBase } from './api.js'
import { ingestMediaFile } from './media-ingest.js'
import { socialChanged } from './social-events.js'
const changed = promise => promise.then(value => { socialChanged(); return value })

export const socialScope = user => JSON.stringify([remoteAuth()?.base || appBase(), user?.id || null])
export const socialAvailable = (user, config) => !!user && config?.social?.enabled === true && config.social.version === 1
export const socialGraphAvailable = (user, config) => socialAvailable(user, config) && config.social.graph === true
export const socialPostsAvailable = (user, config) => socialAvailable(user, config) && config.social.posts === true
export const socialFeedAvailable = (user, config) => socialPostsAvailable(user, config) && config.social.feed === true
export const readProfile = id => api(id ? '/api/social/profiles/' + encodeURIComponent(id) : '/api/social/me')
export const saveProfile = fields => changed(api('/api/social/me', { method: 'PUT', body: JSON.stringify(fields) }))
export const removeProfile = () => changed(api('/api/social/me', { method: 'DELETE' }))
export const removeAvatar = () => changed(api('/api/social/me/avatar', { method: 'DELETE' }))
export const avatarBlob = profile => apiBlob('/api/social/profiles/' + encodeURIComponent(profile.id) + '/avatar/' + encodeURIComponent(profile.avatarId), { expectSize: 256 * 1024 })

// Same client-side decoding, pixel guard and metadata removal as private workout photos,
// but never write the avatar into the private media store or training sync document.
export async function prepareAvatar(file) {
  const { media, blobs } = await ingestMediaFile(file)
  if (media.kind !== 'image') throw new Error('avatar-type')
  return blobs.find(b => b.hash === media.hash).blob
}
export const uploadAvatar = blob => changed(apiUpload('/api/social/me/avatar', blob, blob.type))
const memberPath = id => '/api/social/profiles/' + encodeURIComponent(id)
export function readPeople({ kind = 'people', id, query = '', cursor } = {}) {
  const path = kind === 'people' ? '/api/social/people' : kind === 'blocks' ? '/api/social/blocks' : memberPath(id) + '/' + kind
  const params = new URLSearchParams()
  if (kind === 'people') params.set('q', query)
  if (cursor) params.set('cursor', cursor)
  return api(path + '?' + params)
}
export const setFollow = (id, enabled) => changed(api('/api/social/follows/' + encodeURIComponent(id), { method: enabled ? 'PUT' : 'DELETE' }))
export const setBlock = (id, enabled) => changed(api('/api/social/blocks/' + encodeURIComponent(id), { method: enabled ? 'PUT' : 'DELETE' }))
export const readOwnPost = source => api('/api/social/posts?workoutId=' + encodeURIComponent(source))
export const readPost = id => api('/api/social/posts/' + encodeURIComponent(id))
export const publishPost = (payload, id = null) => changed(api('/api/social/posts' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }))
export const deletePost = async id => { try { return await changed(api('/api/social/posts/' + encodeURIComponent(id), { method: 'DELETE' })) } catch (e) { if (e.status !== 404) throw e; socialChanged() } }
export const uploadPostPhoto = (id, blob) => apiUpload('/api/social/uploads/' + encodeURIComponent(id), blob, blob.type)
export const discardPostPhoto = id => api('/api/social/uploads/' + encodeURIComponent(id), { method: 'DELETE' })
export const postPhotoBlob = (id, asset) => apiBlob('/api/social/posts/' + encodeURIComponent(id) + '/photo' + (asset ? '?asset=' + encodeURIComponent(asset) : ''), { expectSize: 1024 * 1024 })
export const readPosts = (id, cursor) => api(memberPath(id) + '/posts' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''))
export const readFeed = cursor => api('/api/social/feed?limit=10' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
const discussionPath=id=>'/api/social/posts/'+encodeURIComponent(id)
export const likePost=(id,liked)=>api(discussionPath(id)+'/like',{method:liked?'PUT':'DELETE'})
export const readComments=(id,cursor)=>api(discussionPath(id)+'/comments'+(cursor?'?cursor='+encodeURIComponent(cursor):''))
export const putComment=(id,comment,text)=>api(discussionPath(id)+'/comments/'+encodeURIComponent(comment),{method:'PUT',body:JSON.stringify({text})})
export const deleteComment=(id,comment)=>api(discussionPath(id)+'/comments/'+encodeURIComponent(comment),{method:'DELETE'})
export const checkFeed = ids => api('/api/social/feed/check', { method: 'POST', body: JSON.stringify({ ids }) })
export const reportTarget = body => api('/api/social/reports', { method: 'POST', body: JSON.stringify(body) })
export const readReports = cursor => api('/api/admin/social/reports' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''))
export const readReport = id => api('/api/admin/social/reports/' + encodeURIComponent(id))
export const resolveReport = (id, action) => changed(api('/api/admin/social/reports/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ action }) }))
export const reportPhotoBlob = id => apiBlob('/api/admin/social/reports/' + encodeURIComponent(id) + '/photo', { expectSize: 1024 * 1024 })
export const readSocialExport = (section, cursor) => api('/api/social/export?limit=50&section=' + encodeURIComponent(section) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
