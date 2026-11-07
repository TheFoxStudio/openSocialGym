import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { socialScope, socialPostsAvailable, readPosts, discardPostPhoto } from '../lib/social-api.js'
import { listDrafts, deleteDraft } from '../lib/social-drafts.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import SocialGate from '../components/SocialGate.jsx'
import SocialPostCard from '../components/SocialPostCard.jsx'
import { onSocialChange } from '../lib/social-events.js'
import './Profile.css'

export default function Posts({ profileId, embedded=false }) {
  const user = useStore(s => s.user), config = useStore(s => s.config), server = useStore(s => s.sync?.server)
  const params = useParams(), id=profileId||params.id, scope = socialScope(user)
  if (!user || (config && !socialPostsAvailable(user, config))) return <SocialGate />
  return <List key={scope + ':' + server + ':' + id} id={id} own={id === user.id} scope={scope} embedded={embedded} />
}
function List({ id, own, scope, embedded }) {
  const nav = useNavigate(), [posts, setPosts] = useState([]), [drafts, setDrafts] = useState([]), [cursor, setCursor] = useState(null)
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), live = useRef(true), serial = useRef(0),sentinel=useRef(null),locked=useRef(false)
  const valid = n => live.current && serial.current === n && socialScope(useStore.getState().user) === scope
  useEffect(() => { live.current = true; return () => { live.current = false; serial.current++ } }, [])
  const load = async next => {
    if(next&&locked.current)return
    locked.current=true; const n = ++serial.current; setBusy(true); setError('')
    if (!next) { setPosts([]); setCursor(null) }
    try {
      if (own) { const local = await listDrafts(scope).catch(() => []); if (valid(n)) setDrafts(local) }
      if (navigator.onLine === false) throw Error('offline')
      const out = await readPosts(id, next)
      if (out.viewerId !== useStore.getState().user?.id) throw Error('identity-changed')
      if (valid(n)) { setPosts(old => (next ? [...new Map([...old, ...out.posts].map(p => [p.id, p])).values()] : out.posts).slice(0, 50)); setCursor(out.nextCursor) }
    } catch { if (valid(n)) { setPosts([]); setCursor(null); setError(t('Could not load this profile. Please try again.')) } }
    finally { if (valid(n)) {setBusy(false);locked.current=false} }
  }
  useEffect(() => {
    load()
    const refresh = () => { if (document.visibilityState === 'visible') load() }
    const offline = () => { serial.current++; setPosts([]); setCursor(null); setBusy(false) }
    const stop = onSocialChange(refresh)
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh); window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', refresh)
    return () => { stop(); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  useEffect(()=>{
    if(!embedded||!cursor||busy||posts.length>=50||!globalThis.IntersectionObserver)return
    const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting&&!locked.current)load(cursor)},{rootMargin:'200px'})
    if(sentinel.current)observer.observe(sentinel.current)
    return()=>observer.disconnect()
  },[embedded,cursor,busy,posts.length])
  return <div className={embedded?"social-profile profile-timeline":"narrow social-profile"} aria-busy={busy}>
    {!embedded&&<div className="hdr"><h1>{t('Workout posts')}</h1><Button size="sm" variant="ghost" onClick={() => nav('/social/profiles/' + id)}>{t('Back')}</Button></div>}
    {!embedded&&<Button disabled={busy} onClick={() => load()}>{t('Reload')}</Button>}
    {error && <div className="card" role="alert"><p>{error}</p><Button disabled={busy} onClick={() => load()}>{t('Reload')}</Button></div>}
    {own && drafts.length > 0 && <div className="card"><h2>{t('Saved drafts')}</h2>{drafts.map(d => <div className="social-person" key={d.sourceWorkoutId}>
      <Button variant="tinted" onClick={() => nav('/social/share/' + encodeURIComponent(d.sourceWorkoutId))}>{d.snapshot.title || t('Workout')}</Button>
      <Button size="sm" variant="ghost" onClick={async () => { try { await deleteDraft(scope, d.sourceWorkoutId); if (valid(serial.current)) { setDrafts(old => old.filter(x => x.sourceWorkoutId !== d.sourceWorkoutId)); if (d.assetId) discardPostPhoto(d.assetId).catch(() => {}) } } catch { if (valid(serial.current)) setError(t('Could not save your draft on this device.')) } }}>{t('Discard draft')}</Button>
    </div>)}</div>}
    {posts.map(p => <SocialPostCard key={p.id} post={p} scope={scope} />)}
    <div ref={sentinel} aria-hidden="true" />
    {(busy||(!error&&!posts.length)||(cursor&&posts.length<50))&&<div className="card">
      {busy && <p role="status">{t('Loading…')}</p>}
      {!busy && !error && !posts.length && <p>{t('No shared workouts yet.')}</p>}
      {cursor && posts.length < 50 && <Button disabled={busy} onClick={() => load(cursor)}>{t('Load more')}</Button>}
    </div>}
  </div>
}
