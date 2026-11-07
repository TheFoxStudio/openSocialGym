import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { socialScope, readSocialExport, postPhotoBlob, avatarBlob } from '../lib/social-api.js'
import { listDrafts } from '../lib/social-drafts.js'
import { buildSocialExport } from '../lib/social-export.js'
import { MOBILE, shareExportBlob } from '../lib/mobile.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

export default function SocialExport() {
  const user = useStore(s => s.user), config = useStore(s => s.config)
  if (!user || !config?.social?.export) return null
  const scope = socialScope(user)
  return <Export key={scope} user={user} scope={scope} />
}
function Export({ user, scope }) {
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const currentScope = () => live.current ? socialScope(useStore.getState().user) : null
  const run = async () => {
    if (busy) return
    setBusy(true); setStatus(t('Preparing social export…'))
    try {
      const blob = await buildSocialExport({ scope, userId: user.id, currentScope, readPage: readSocialExport, photo: postPhotoBlob, avatar: avatarBlob, drafts: () => listDrafts(scope) })
      if (currentScope() !== scope) return
      const name = 'opengym-social-' + new Date().toISOString().slice(0, 10) + '.zip'
      if (MOBILE) await shareExportBlob(blob, name)
      else {
        const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
      if (currentScope() === scope) setStatus(t('Social export ready.'))
    } catch (e) { if (currentScope() === scope) setStatus(e.message === 'export-too-large' ? t('This export is too large. Use a server backup.') : t('Could not export social data. Please try again.')) }
    finally { if (currentScope() === scope) setBusy(false) }
  }
  return <div><Button disabled={busy} variant="ghost" onClick={run}>{t('Export social data')}</Button><p className="small dim">{t('Includes your profile, posts, photos, relationships, submitted reports and saved drafts.')}</p>{status && <p role="status">{status}</p>}</div>
}
