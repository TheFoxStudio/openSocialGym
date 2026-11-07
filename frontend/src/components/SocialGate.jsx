import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

export default function SocialGate() {
  const nav = useNavigate()
  return <div className="narrow">
    <div className="hdr"><h1>{t('Social profile')}</h1></div>
    <div className="card"><p>{t('Connect to a server with social profiles enabled to create your profile.')}</p>
      <Button onClick={() => nav('/settings')}>{t('Server & sync')}</Button>
      <Button size="sm" variant="ghost" onClick={() => nav('/home')}>{t('Back')}</Button>
    </div>
  </div>
}
