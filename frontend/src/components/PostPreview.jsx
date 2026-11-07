import {Fragment} from 'react'
import {t} from '../lib/i18n.js'
import {fmtNum,fmtDur,fmtVol,fmtDate} from '../lib/format.js'
import {socialVolume} from '../lib/social-metrics.js'
import {EXIDX} from '../lib/exercises.js'
import {Thumb} from './Media.jsx'
import Icon from './Icon.jsx'

const n=fmtNum
function ExerciseSets({exercise:e}) {
  const columns=[
    ...(e.sets.some(s=>s.weight!=null)?[{label:t('Weight')+' ('+e.unit+')',value:s=>s.weight==null?'—':n(s.weight)}]:[]),
    ...(e.sets.some(s=>s.reps!=null)?[{label:t('Reps'),value:s=>s.reps==null?'—':n(s.reps)}]:[]),
    ...(e.sets.some(s=>s.seconds!=null||s.minutes!=null)?[{label:t('Time'),value:s=>s.seconds!=null?n(s.seconds)+' s':s.minutes!=null?n(s.minutes)+' min':'—'}]:[]),
    ...(e.sets.some(s=>s.speedKmh!=null)?[{label:t('Speed')+' (km/h)',value:s=>s.speedKmh==null?'—':n(s.speedKmh)}]:[]),
    ...(e.sets.some(s=>s.incline!=null)?[{label:t('Incline')+' (%)',value:s=>s.incline==null?'—':n(s.incline)}]:[])
  ]
  return <div className="post-sets-scroll"><table className="post-sets" aria-label={e.name}>
    <thead><tr><th scope="col">{t('Set')}</th>{columns.map(c=><th scope="col" key={c.label}>{c.label}</th>)}</tr></thead>
    <tbody>{e.sets.map((s,i)=><Fragment key={i}>
      <tr><th scope="row"><span className="post-set-number">{i+1}</span>{s.side&&<span className="post-set-side">{s.side==='L'?t('Left'):t('Right')}</span>}</th>{columns.map(c=><td key={c.label}>{c.value(s)}</td>)}</tr>
      {(s.drops?.length>0||s.clusters?.length>0)&&<tr className="post-set-extras"><td colSpan={columns.length+1}>
        {s.drops?.length>0&&<div><span className="post-set-type">{t('Drop set')}</span>{s.drops.map((d,j)=><span className="post-set-detail" key={j}>{n(d.weight)} {e.unit} × {n(d.reps)}</span>)}</div>}
        {s.clusters?.length>0&&<div><span className="post-set-type">{t('Rest-pause')}</span>{s.clusters.map((c,j)=><span className="post-set-detail" key={j}>{n(c.reps)} {t('reps')}</span>)}</div>}
      </td></tr>}
    </Fragment>)}</tbody>
  </table></div>
}
export default function PostPreview({snapshot}) {
  if(!snapshot)return null
  const volume=socialVolume(snapshot),metrics=[
    ...(snapshot.durationSec!=null?[{label:t('Workout time'),value:fmtDur(snapshot.durationSec*1000)}]:[]),
    {label:t('Total volume'),value:fmtVol(Math.round(volume.value),volume.unit)},
    ...(snapshot.records>0?[{label:t('PRs'),value:n(snapshot.records)}]:[]),
    ...(snapshot.averageHeartRate?[{label:t('Avg. heart rate'),value:t('{0} bpm',n(snapshot.averageHeartRate))}]:[])
  ]
  return <section className="post-preview" aria-label={t('Workout preview')}>
    <h2>{snapshot.title||t('Workout')}</h2><p className="small dim">{fmtDate(snapshot.date,true,true)} · {t('{0} exercises',n(snapshot.exercises.length))}</p>
    <dl className="post-metrics post-detail-metrics" style={{gridTemplateColumns:`repeat(${Math.min(metrics.length,4)},minmax(0,1fr))`}}>{metrics.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>
    <div className="post-exercises">{snapshot.exercises.map((e,i)=><section className="post-exercise" key={i} aria-label={e.name}>
      <header className="post-exercise-heading"><span className="post-exercise-icon" aria-hidden="true">{e.catalogId&&EXIDX[e.catalogId]?<Thumb ex={EXIDX[e.catalogId]}/>:<Icon name="dumbbell"/>}</span><div><h3>{e.name}</h3><p className="small dim">{t('{0} sets',n(e.setCount??e.sets.length))}</p></div></header>
      <ExerciseSets exercise={e}/>
    </section>)}</div>
  </section>
}
