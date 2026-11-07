import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { socialScope, avatarBlob, postPhotoBlob } from '../lib/social-api.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import PostPreview from './PostPreview.jsx'

function useImage(fetcher, key, visible, scope) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let gone = false, objectUrl
    setUrl(null)
    if (visible && key) fetcher().then(blob => {
      if (!gone && socialScope(useStore.getState().user) === scope) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) }
    }).catch(() => {})
    return () => { gone = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [key, visible, scope])
  return url
}
export default function SocialPostCard({ post, scope }) {
  const nav = useNavigate(), ref = useRef(null), [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!globalThis.IntersectionObserver) { setVisible(true); return }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '200px' })
    observer.observe(ref.current); return () => observer.disconnect()
  }, [])
  const avatar = useImage(() => avatarBlob(post.author), post.author?.avatarId, visible, scope)
  const photo = useImage(() => postPhotoBlob(post.id, post.assetId), post.assetId ? post.id + ':' + post.assetId + ':' + post.revision : null, visible, scope)
  return <article className="card social-post-card" ref={ref}>
    <button type="button" className="post-author" onClick={() => nav('/social/profiles/' + post.authorId)}>
      <span className="post-avatar">{avatar ? <img src={avatar} alt="" /> : (post.author?.displayName || '?').slice(0, 1).toUpperCase()}</span>
      <span><strong>{post.author?.displayName}</strong><span className="small dim">@{post.author?.handle}</span></span>
    </button>
    <p className="small dim">{post.audience === 'followers' ? t('Followers') : t('Server members')}</p>
    {post.caption && <p className="social-bio">{post.caption}</p>}
    {post.assetId && <div className="feed-photo">{photo ? <img className="post-photo" src={photo} alt={t('Workout photo')} /> : <span className="small dim">{t('Workout photo')}</span>}</div>}
    <PostPreview snapshot={{ ...post.snapshot, exercises: post.snapshot.exercises.slice(0, 3).map(e => ({ ...e, sets: e.sets.slice(0, 3) })) }} />
    <Button size="sm" variant="tinted" onClick={() => nav('/social/posts/' + post.id)}>{t('Open workout post')}</Button>
  </article>
}
