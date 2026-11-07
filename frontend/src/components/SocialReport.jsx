import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { socialScope, reportTarget } from '../lib/social-api.js'
import { postRequestId } from '../lib/social-drafts.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

export default function SocialReport({ type, id, ownerId }) {
  const user = useStore(s => s.user), config = useStore(s => s.config)
  if (!user || ownerId === user.id || !config?.social?.moderation) return null
  const scope = socialScope(user)
  return <Report key={scope + ':' + type + ':' + id} scope={scope} type={type} id={id} />
}
function Report({ scope, type, id }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState('spam'), [details, setDetails] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('')
  const request = useRef(postRequestId()), live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  // Results are checked against current identity; this form sends only on explicit submit.
  const valid = () => socialScope(useStore.getState().user) === scope && live.current
  const changed = setter => ev => { request.current = postRequestId(); setter(ev.target.value); setStatus('') }
  const submit = async ev => {
    ev.preventDefault(); if (busy || !valid()) return
    setBusy(true); setStatus('')
    try {
      await reportTarget({ targetType: type, targetId: id, requestId: request.current, reason, details })
      if (valid()) { setStatus(t('Report sent.')); setOpen(false) }
    } catch { if (valid()) setStatus(t('Could not send the report. Please try again.')) }
    finally { if (valid()) setBusy(false) }
  }
  return <div className="social-report">
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setOpen(v => !v); setStatus('') }}>{t('Report content')}</Button>
    {status && <p role="status">{status}</p>}
    {open && <form onSubmit={submit}><fieldset disabled={busy}>
      <label>{t('Report reason')}<select aria-label={t('Report reason')} value={reason} onChange={changed(setReason)}><option value="spam">{t('Spam')}</option><option value="harassment">{t('Harassment')}</option><option value="privacy">{t('Privacy concern')}</option><option value="other">{t('Other')}</option></select></label>
      <label>{t('Report details')}<textarea aria-label={t('Report details')} maxLength={1000} rows={3} value={details} onChange={changed(setDetails)} /></label>
      <Button type="submit" variant="primary">{t('Send report')}</Button>
    </fieldset></form>}
  </div>
}
