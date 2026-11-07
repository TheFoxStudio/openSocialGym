import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
const n = v => fmtNum(v)
export function postSetText(s, unit) {
  const parts = [s.side, ...(s.weight != null ? [n(s.weight) + ' ' + unit] : []), ...(s.reps != null ? ['× ' + n(s.reps)] : []),
    ...(s.seconds != null ? [n(s.seconds) + ' s'] : []), ...(s.minutes != null ? [n(s.minutes) + ' min'] : []),
    ...(s.speedKmh != null ? [n(s.speedKmh) + ' km/h'] : []), ...(s.incline != null ? [n(s.incline) + '%'] : [])].filter(Boolean)
  if (s.drops?.length) parts.push('[' + s.drops.map(d => n(d.weight) + ' ' + unit + ' × ' + n(d.reps)).join(' → ') + ']')
  if (s.clusters?.length) parts.push('(' + s.clusters.map(c => n(c.reps)).join(' + ') + ')')
  return parts.join(' ')
}
export default function PostPreview({ snapshot }) {
  if (!snapshot) return null
  return <section className="post-preview" aria-label={t('Workout preview')}>
    <h2>{snapshot.title || t('Workout')}</h2>
    <p className="small dim">{snapshot.date}{snapshot.durationSec != null ? ' · ' + n(Math.round(snapshot.durationSec / 60)) + ' min' : ''}</p>
    {snapshot.totalVolume!=null&&<p className="small dim">{t('Total volume')}: {n(snapshot.totalVolume)} {snapshot.volumeUnit}</p>}
    {snapshot.records>0&&<p className="small dim">{t('Records')}: {n(snapshot.records)}</p>}
    {snapshot.averageHeartRate&&<p className="small dim">{t('Avg. heart rate')}: {t('{0} bpm',n(snapshot.averageHeartRate))}</p>}
    {snapshot.exercises.map((e, i) => <div key={i}><h3>{e.name}</h3><ol>{e.sets.map((s, j) => <li key={j}>{postSetText(s, e.unit)}</li>)}</ol></div>)}
  </section>
}
