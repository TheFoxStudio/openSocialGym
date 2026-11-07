import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { socialScope, socialGraphAvailable, readPeople, setBlock } from '../lib/social-api.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import SocialGate from '../components/SocialGate.jsx'
import './Profile.css'

export default function People({ kind = 'people' }) {
  const user = useStore(s => s.user), config = useStore(s => s.config), server = useStore(s => s.sync?.server)
  const { id } = useParams()
  const scope = socialScope(user)
  if (!socialGraphAvailable(user, config)) return <SocialGate />
  return <Directory key={scope + ':' + server + ':' + kind + ':' + id} kind={kind} id={id} scope={scope} />
}

function Directory({ kind, id, scope }) {
  const nav = useNavigate()
  const [draft, setDraft] = useState(''), [query, setQuery] = useState('')
  const [people, setPeople] = useState([]), [cursor, setCursor] = useState(null)
  const [busy, setBusy] = useState(true), [error, setError] = useState('')
  const live = useRef(true), request = useRef(0), lock = useRef(false)
  const valid = n => live.current && request.current === n && socialScope(useStore.getState().user) === scope
  useEffect(() => { live.current = true; return () => { live.current = false; request.current++ } }, [])
  const load = async (next = null) => {
    const n = ++request.current
    setBusy(true); setError('')
    if (!next) { setPeople([]); setCursor(null) }
    try {
      const out = await readPeople({ kind, id, query, cursor: next })
      if (valid(n)) { setPeople(old => next ? [...new Map([...old, ...out.people].map(p => [p.id, p])).values()] : out.people); setCursor(out.nextCursor) }
    } catch { if (valid(n)) { setPeople([]); setCursor(null); setError(t('Could not load this profile. Please try again.')) } }
    finally { if (valid(n)) setBusy(false) }
  }
  useEffect(() => { load() }, [query])
  // Refresh on return from a profile, so blocks/unfollows made in another screen/tab are
  // reflected. There is no persistent member/avatar cache to expose a blocked profile.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && !lock.current) load() }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [query])
  const unblock = async target => {
    if (lock.current) return
    lock.current = true; const n = ++request.current; setBusy(true); setError('')
    try { await setBlock(target, false); if (valid(n)) await load() }
    catch { if (valid(n)) { setError(t('Could not save your profile. Please try again.')); setBusy(false) } }
    finally { lock.current = false }
  }
  const title = kind === 'people' ? t('Find friends') : kind === 'blocks' ? t('Blocked members') : kind === 'followers' ? t('Followers') : t('Following')
  return <div className="narrow social-profile" aria-busy={busy}>
    <div className="hdr"><h1>{title}</h1><Button size="sm" variant="ghost" onClick={() => nav(id ? '/social/profiles/' + id : '/social')}>{t('Back')}</Button></div>
    {kind==='following'&&<div className="social-actions"><Button variant="tinted" onClick={()=>nav('/social/people')}>{t('Find friends')}</Button>{id===useStore.getState().user?.id&&<Button variant="ghost" onClick={()=>nav('/social/blocks')}>{t('Blocked members')}</Button>}</div>}
    {kind === 'people' && <form className="card" onSubmit={ev => { ev.preventDefault(); if (query === draft.trim()) load(); else setQuery(draft.trim()) }}>
      <label>{t('Find friends')}<input value={draft} onChange={ev => setDraft(ev.target.value)} maxLength={60} type="search" /></label>
      <Button type="submit" variant="primary" disabled={busy}>{t('Search')}</Button>
    </form>}
    {error && <div className="card" role="alert"><p>{error}</p><Button disabled={busy} onClick={() => load()}>{t('Reload')}</Button></div>}
    <div className="card">
      {people.map(p => <div key={p.id} className="social-person">
        {kind === 'blocks' ? <><div><strong>{p.displayName || t('Social profile')}</strong>{p.handle && <div className="small dim">@{p.handle}</div>}</div><Button size="sm" disabled={busy} onClick={() => unblock(p.id)}>{t('Unblock member')}</Button></>
          : <button type="button" className="social-person-link" onClick={() => nav('/social/profiles/' + p.id)}><strong>{p.displayName}</strong><span className="small dim">@{p.handle}</span></button>}
      </div>)}
      {busy && <p role="status">{t('Loading…')}</p>}
      {!busy && !error && !people.length && <p>{t('No members found.')}</p>}
      {cursor && <Button disabled={busy} onClick={() => load(cursor)}>{t('Load more')}</Button>}
      {kind === 'people' && <Button variant="ghost" onClick={() => nav('/social/blocks')}>{t('Blocked members')}</Button>}
    </div>
  </div>
}
