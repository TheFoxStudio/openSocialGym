import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { socialScope, readReports, readReport, resolveReport, reportPhotoBlob } from '../lib/social-api.js'
import { Button } from '../components/ui.jsx'
import PostPreview from '../components/PostPreview.jsx'
import './Profile.css'

// Operator screens follow Admin.jsx's English-only convention.
export default function AdminSocial() {
  const user = useStore(s => s.user), config = useStore(s => s.config)
  if (!user?.admin || !config?.social?.moderation) return null
  return <Queue key={socialScope(user)} user={user} />
}
function Queue({ user }) {
  const nav = useNavigate(), scope = socialScope(user), live = useRef(true), sequence = useRef(0)
  const [rows, setRows] = useState([]), [cursor, setCursor] = useState(null), [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false), [image, setImage] = useState(null)
  const valid = n => live.current && sequence.current === n && useStore.getState().user?.admin && socialScope(useStore.getState().user) === scope
  const load = async next => {
    const n = ++sequence.current; setBusy(true); setError(''); setDetail(null); setConfirm(false)
    try {
      const out = await readReports(next)
      if (!valid(n)) return
      if (out.viewerId !== user.id) throw Error('Account changed. Reload the app.')
      setRows(old => next ? [...new Map([...old, ...out.reports].map(r => [r.id, r])).values()] : out.reports); setCursor(out.nextCursor)
    } catch { if (valid(n)) { setRows([]); setCursor(null); setError('Could not load reports. Please reload.') } }
    finally { if (valid(n)) setBusy(false) }
  }
  useEffect(() => { live.current = true; load(); return () => { live.current = false; sequence.current++ } }, [])
  const review = async id => {
    const n = ++sequence.current; setBusy(true); setError(''); setDetail(null); setConfirm(false)
    try {
      const out = await readReport(id)
      if (valid(n) && out.viewerId === user.id) setDetail(out)
    } catch { if (valid(n)) setError('Could not load this report. Please reload.') }
    finally { if (valid(n)) setBusy(false) }
  }
  useEffect(() => {
    let gone = false, url; setImage(null)
    if (detail?.target?.assetId || detail?.target?.avatarId) reportPhotoBlob(detail.report.id).then(blob => {
      if (!gone && live.current && socialScope(useStore.getState().user) === scope) { url = URL.createObjectURL(blob); setImage(url) }
    }).catch(() => {})
    return () => { gone = true; if (url) URL.revokeObjectURL(url) }
  }, [detail])
  const resolve = async action => {
    const n = ++sequence.current; setBusy(true); setError('')
    try {
      const out = await resolveReport(detail.report.id, action)
      if (valid(n) && out.viewerId === user.id) { setDetail(out); setConfirm(false); setRows(old => old.map(r => r.id === out.report.id ? out.report : r)) }
    } catch { if (valid(n)) { setDetail(null); setConfirm(false); setError('Could not resolve this report. Reload and review the current content.') } }
    finally { if (valid(n)) setBusy(false) }
  }
  return <div className="narrow social-profile" aria-busy={busy}>
    <div className="hdr"><h1>Social reports</h1><Button onClick={() => nav('/admin')}>Back</Button></div>
    <p>Review reported social content. Removing a profile also removes its shared posts. Private workouts and account access are kept; account restrictions are available in Admin.</p>
    <Button disabled={busy} onClick={() => load()}>Reload</Button>
    {error && <p role="alert">{error}</p>}
    {detail && <section className="card"><h2>Reported {detail.report.targetType}</h2>
      <p>Status: {detail.report.status}</p><p>Reporter: {detail.report.reporterId}</p><p>{detail.report.reason}: {detail.report.details}</p>
      {detail.target ? <>{detail.target.snapshot ? <PostPreview snapshot={detail.target.snapshot} /> : <><h3>{detail.target.displayName}</h3><p>@{detail.target.handle}</p><p>{detail.target.bio}</p></>}
        {detail.target.text && <p>{detail.target.text}</p>}{detail.target.caption && <p>{detail.target.caption}</p>}{image && <img className="post-photo" src={image} alt="Reported content" />}</> : <p>This content is no longer available.</p>}
      {detail.report.status === 'open' && <div className="social-actions"><Button disabled={busy} onClick={() => resolve('dismiss')}>Dismiss report</Button><Button disabled={busy} variant="danger" onClick={() => setConfirm(true)}>Remove content</Button></div>}
      {confirm && <div role="alert"><p>Remove this {detail.report.targetType} from the server? This cannot be undone.</p><Button disabled={busy} variant="danger" onClick={() => resolve('remove')}>Confirm removal</Button><Button disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button></div>}
    </section>}
    {rows.map(r => <div className="card" key={r.id}><p>{r.targetType} · {r.reason} · {r.status}</p><p>{new Date(r.createdAt).toLocaleString()}</p><Button disabled={busy} onClick={() => review(r.id)}>Review report</Button></div>)}
    {!rows.length && !busy && !error && <p>No reports.</p>}
    {cursor && <Button disabled={busy} onClick={() => load(cursor)}>Load more</Button>}
  </div>
}
