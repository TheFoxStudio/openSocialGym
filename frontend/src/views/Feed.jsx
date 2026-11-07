import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { socialScope, socialFeedAvailable, readFeed, checkFeed } from '../lib/social-api.js'
import { onSocialChange } from '../lib/social-events.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import SocialGate from '../components/SocialGate.jsx'
import SocialPostCard from '../components/SocialPostCard.jsx'
import './Profile.css'

export default function Feed({ embedded = false }) {
  const nav = useNavigate()
  const user = useStore(s => s.user), config = useStore(s => s.config), server = useStore(s => s.sync?.server)
  const scope = socialScope(user)
  if (!socialFeedAvailable(user, config)) return embedded ? <section className="home-feed"><h2>{t('Following timeline')}</h2><div className="card"><p>{t('Connect to a server with social profiles enabled to create your profile.')}</p><Button onClick={() => nav('/settings')}>{t('Server & sync')}</Button></div></section> : <SocialGate />
  return <Timeline key={scope + ':' + server} scope={scope} user={user} embedded={embedded} />
}
function Timeline({ scope, user, embedded }) {
  const nav = useNavigate(), [posts, setPosts] = useState([]), [cursor, setCursor] = useState(null), [busy, setBusy] = useState(true), [error, setError] = useState('')
  const live = useRef(true), serial = useRef(0), latest = useRef([]), lock = useRef(false), sentinel = useRef(null)
  latest.current = posts
  const valid = n => live.current && serial.current === n && socialScope(useStore.getState().user) === scope
  const clear = () => { serial.current++; setPosts([]); latest.current = []; setCursor(null); setBusy(false) }
  const load = async (next = null) => {
    if (next && lock.current) return
    const n = ++serial.current; lock.current = true; setBusy(true); setError('')
    const old = latest.current
    // Drop images and text before fresh authorization; restricted content is not cached offline.
    if (!next) { setPosts([]); latest.current = []; setCursor(null) }
    if (navigator.onLine === false) { if (valid(n)) { clear(); setError(t('You are offline. Reconnect to refresh the timeline.')) } lock.current = false; return }
    try {
      let retained = []
      if (next && old.length) {
        const checked = await checkFeed(old.map(p => p.id))
        if (!valid(n)) return
        if (checked.viewerId !== user.id) throw Error('identity-changed')
        retained = checked.posts; setPosts(retained)
      }
      const out = await readFeed(next)
      if (!valid(n)) return
      if (out.viewerId !== user.id) throw Error('identity-changed')
      const combined = [...new Map([...retained, ...out.posts].map(p => [p.id, p])).values()]
      setPosts(combined.slice(0, 50)); setCursor(combined.length < 50 ? out.nextCursor : null)
    } catch (e) {
      if (valid(n)) { setPosts([]); setCursor(null); setError(e.message === 'identity-changed' ? t('Your account changed. Reload the app.') : t('Could not load the timeline. Please try again.')) }
    } finally { if (valid(n)) { lock.current = false; setBusy(false) } }
  }
  const revalidate = async () => {
    if (lock.current || !latest.current.length) return
    const n = ++serial.current; lock.current = true
    try {
      const out = await checkFeed(latest.current.map(p => p.id))
      if (!valid(n)) return
      if (out.viewerId !== user.id) throw Error('identity-changed')
      setPosts(out.posts)
    } catch { if (valid(n)) { setPosts([]); setCursor(null); setError(t('Could not load the timeline. Please try again.')) } }
    finally { if (valid(n)) lock.current = false }
  }
  useEffect(() => {
    live.current = true; load()
    const refresh = () => { if (document.visibilityState === 'visible') load() }
    const offline = () => { clear(); lock.current = false; setError(t('You are offline. Reconnect to refresh the timeline.')) }
    const stop = onSocialChange(refresh)
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh); window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', refresh)
    const timer = setInterval(() => { if (!lock.current && document.visibilityState === 'visible' && navigator.onLine !== false) { if (latest.current.length > 10) revalidate(); else load() } }, 30000)
    return () => { live.current = false; serial.current++; clearInterval(timer); stop(); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  useEffect(() => {
    if (!embedded || !cursor || busy || !globalThis.IntersectionObserver) return
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !lock.current) load(cursor) }, { rootMargin: '300px' })
    if (sentinel.current) observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [embedded, cursor, busy])
  return <section className={embedded ? 'social-profile home-feed' : 'narrow social-profile'} aria-busy={busy}>
    <div className="hdr">{embedded ? <h2>{t('Following timeline')}</h2> : <h1>{t('Following timeline')}</h1>}<Button size="sm" variant="ghost" disabled={busy} onClick={() => load()}>{t('Reload')}</Button></div>
    <div className="social-actions"><Button size="sm" variant="tinted" onClick={() => nav('/social/people')}>{t('Find friends')}</Button>{!embedded && <Button size="sm" variant="ghost" onClick={() => nav('/social')}>{t('Social profile')}</Button>}</div>
    {error && <div className="card" role="alert">{error}</div>}
    {busy && <p role="status">{t('Loading…')}</p>}
    {!busy && !error && !posts.length && <div className="card"><p>{t('Follow friends to see their workouts here. Your own shared workouts appear here too.')}</p></div>}
    {posts.map(p => <SocialPostCard key={p.id} post={p} scope={scope} />)}
    <div className="feed-sentinel" ref={sentinel} aria-hidden="true" />
    {cursor && <Button disabled={busy} onClick={() => load(cursor)}>{t('Load more')}</Button>}
    {!cursor && posts.length >= 50 && <p className="small dim">{t('Refresh to see newer posts.')}</p>}
  </section>
}
