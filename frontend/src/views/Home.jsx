import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { useConnectionTrouble } from '../components/SyncBanner.jsx'
import Icon from '../components/Icon.jsx'
import HomeInfo from '../components/HomeInfo.jsx'
import Feed from './Feed.jsx'
import './Home.css'

export default function Home() {
  const nav = useNavigate(), user = useStore(s => s.user)
  const trouble = useConnectionTrouble()
  return <div className="narrow home-social">
    <header className="hdr">
      <h1>{t('Home')}</h1>
      <div className="home-header-actions">
        {user && <button className="iconbtn" aria-label={t('Find friends')} onClick={() => nav('/social/people')}><Icon name="magnifier" /></button>}
        {user && <button className="iconbtn" aria-label={t('Social profile')} onClick={() => nav('/social')}><Icon name="person" /></button>}
        <button className="iconbtn" data-tour="settings-gear" onClick={() => nav('/settings')} aria-label={trouble ? t('Settings') + ', ' + t('Connection problem') : t('Settings')}><Icon name="gear" />{trouble && <span className="tab-dot" aria-hidden="true" />}</button>
      </div>
    </header>
    <HomeInfo />
    <Feed embedded />
  </div>
}
