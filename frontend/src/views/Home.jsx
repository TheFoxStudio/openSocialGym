import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { workoutDay, workoutDuration } from '../lib/history.js'
import { fmtDur, fmtNum, isoOf, weekStartOf } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { useConnectionTrouble } from '../components/SyncBanner.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import Feed from './Feed.jsx'
import './Home.css'

export default function Home() {
  const nav = useNavigate(), S = useStore(s => s.S), user = useStore(s => s.user)
  const trouble = useConnectionTrouble(), today = isoOf(new Date())
  const summary = useMemo(() => {
    const start = new Date(today + 'T12:00:00'), first = weekStartOf(S)
    start.setDate(start.getDate() - (start.getDay() - first + 7) % 7)
    const from = isoOf(start), workouts = S.workouts || []
    const week = workouts.filter(w => { const day = workoutDay(w); return day && day >= from && day <= today })
    return { week: week.length, duration: week.reduce((sum, w) => sum + workoutDuration(w), 0), total: workouts.length }
  }, [S.workouts, S.weekStart, today])
  return <div className="narrow home-social">
    <header className="hdr">
      <h1>{t('Home')}</h1>
      <div className="home-header-actions">
        {user && <button className="iconbtn" aria-label={t('Social profile')} onClick={() => nav('/social')}><Icon name="person" /></button>}
        <button className="iconbtn" data-tour="settings-gear" onClick={() => nav('/settings')} aria-label={trouble ? t('Settings') + ', ' + t('Connection problem') : t('Settings')}><Icon name="gear" />{trouble && <span className="tab-dot" aria-hidden="true" />}</button>
      </div>
    </header>
    <section className="card home-summary" data-tour="today" aria-labelledby="home-summary-title">
      <div className="home-summary-header"><h2 id="home-summary-title">{t('This week')}</h2><Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/stats')}>{t('Stats')}</Button></div>
      <dl className="home-summary-metrics">
        <div><dt>{t('Workouts')}</dt><dd>{fmtNum(summary.week)}</dd></div>
        <div><dt>{t('Training time')}</dt><dd>{fmtDur(summary.duration)}</dd></div>
      </dl>
      <div className="home-summary-total"><span>{t('All workouts')}</span><strong>{fmtNum(summary.total)}</strong></div>
    </section>
    <Feed embedded />
  </div>
}
