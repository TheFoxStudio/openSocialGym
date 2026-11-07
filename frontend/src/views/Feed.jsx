import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { socialScope, socialFeedAvailable, readFeed, checkFeed } from '../lib/social-api.js'
import { onSocialChange } from '../lib/social-events.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import SocialGate from '../components/SocialGate.jsx'
import SocialPostCard from '../components/SocialPostCard.jsx'
import Icon from '../components/Icon.jsx'
import './Profile.css'

export default function Feed({ embedded = false }) {
  const nav = useNavigate()
  const user = useStore(s => s.user), config = useStore(s => s.config), server = useStore(s => s.sync?.server)
  const scope = socialScope(user)
  if (!socialFeedAvailable(user, config)) return embedded ? <section className="home-feed"><div className="card"><p>{t('Connect to a server with social profiles enabled to create your profile.')}</p><Button onClick={() => nav('/settings')}>{t('Server & sync')}</Button></div></section> : <SocialGate />
  return <Timeline key={scope + ':' + server} scope={scope} user={user} embedded={embedded} />
}
function Timeline({ scope, user, embedded }) {
  const nav = useNavigate(), [posts, setPosts] = useState([]), [cursor, setCursor] = useState(null), [busy, setBusy] = useState(true), [error, setError] = useState('')
  const live = useRef(true), serial = useRef(0), latest = useRef([]), lock = useRef(false), sentinel = useRef(null)
  const surface=useRef(null),reload=useRef(null),[pull,setPull]=useState(0),[refreshing,setRefreshing]=useState(false)
  latest.current = posts
  const valid = n => live.current && serial.current === n && socialScope(useStore.getState().user) === scope
  const clear = () => { serial.current++; setPosts([]); latest.current = []; setCursor(null); setBusy(false) }
  const load = async (next = null) => {
    if (next && lock.current) return
    const n = ++serial.current; lock.current = true; setBusy(true); setError('')
    const old = latest.current
    // Drop images and text before fresh authorization; restricted content is not cached offline.
    if (!next) { setPosts([]); latest.current = []; setCursor(null) }
    if (navigator.onLine === false) { if (valid(n)) { clear(); setError(t('You are offline. Reconnect, then pull down to refresh.')) } lock.current = false; return }
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
  reload.current=async()=>{if(lock.current)return;setRefreshing(true);try{await load()}finally{if(live.current){setRefreshing(false);setPull(0)}}}
  useEffect(() => {
    live.current = true; load()
    const refresh = () => { if (document.visibilityState === 'visible') revalidate() }
    const offline = () => { clear(); lock.current = false; setError(t('You are offline. Reconnect, then pull down to refresh.')) }
    const stop = onSocialChange(refresh)
    window.addEventListener('focus', refresh); window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', refresh)
    return () => { live.current = false; serial.current++; stop(); window.removeEventListener('focus', refresh); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  useEffect(()=>{
    const node=surface.current.closest('.home-social')||surface.current;let start=null,distance=0
    const begin=ev=>{const p=ev.touches[0];start=ev.touches.length===1&&window.scrollY<=0&&!lock.current&&!ev.target.closest('button,a,input,textarea,summary')?{x:p.clientX,y:p.clientY}:null;distance=0}
    const move=ev=>{if(!start||ev.touches.length!==1)return;const p=ev.touches[0],dy=p.clientY-start.y,dx=p.clientX-start.x;if(Math.abs(dx)>Math.abs(dy)+8||window.scrollY>0){start=null;distance=0;setPull(0);return}if(dy>8){if(ev.cancelable)ev.preventDefault();distance=Math.min(96,dy*.48);setPull(distance)}}
    const end=()=>{if(start&&distance>=64)reload.current();else setPull(0);start=null;distance=0}
    const cancel=()=>{start=null;distance=0;setPull(0)}
    node.addEventListener('touchstart',begin,{passive:true});node.addEventListener('touchmove',move,{passive:false});node.addEventListener('touchend',end);node.addEventListener('touchcancel',cancel)
    return()=>{node.removeEventListener('touchstart',begin);node.removeEventListener('touchmove',move);node.removeEventListener('touchend',end);node.removeEventListener('touchcancel',cancel)}
  },[])
  useEffect(() => {
    if (!cursor || busy || !globalThis.IntersectionObserver) return
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !lock.current) load(cursor) }, { rootMargin: '300px' })
    if (sentinel.current) observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [embedded, cursor, busy])
  return <section ref={surface} data-tour="today" className={embedded ? 'social-profile home-feed' : 'narrow social-profile'} aria-label={t('Following timeline')} aria-busy={busy}>
    {!embedded&&<div className="hdr"><h1>{t('Home')}</h1><Button size="sm" variant="ghost" onClick={()=>nav('/home')}>{t('Back')}</Button></div>}
    <button className="feed-refresh-accessible" onClick={()=>reload.current()} disabled={busy}>{t('Refresh feed')}</button>
    <div className={'feed-pull-indicator'+(refreshing?' refreshing':'')} style={{height:refreshing?56:pull,opacity:refreshing?1:Math.min(1,pull/64)}} aria-hidden={!refreshing}><span className={refreshing?'feed-spinner':'feed-pull-arrow'} style={!refreshing?{transform:`rotate(${Math.min(180,pull/64*180)}deg)`}:undefined}><Icon name="arrowDown" /></span>{refreshing&&<span className="sr-only" role="status">{t('Loading…')}</span>}</div>
    {error && <div className="card" role="alert">{error}</div>}
    {busy && !refreshing && <p role="status" className="feed-loading"><span className="feed-spinner" aria-hidden="true" /> <span className="sr-only">{t('Loading…')}</span></p>}
    {!busy && !error && !posts.length && <div className="card"><p>{t('Follow friends to see their workouts here. Your own shared workouts appear here too.')}</p></div>}
    {posts.map(p => <SocialPostCard key={p.id} post={p} scope={scope} />)}
    <div className="feed-sentinel" ref={sentinel} aria-hidden="true" />
    {cursor && <Button disabled={busy} onClick={() => load(cursor)}>{t('Load more')}</Button>}
    {!cursor && posts.length >= 50 && <p className="small dim">{t('Refresh to see newer posts.')}</p>}
  </section>
}
