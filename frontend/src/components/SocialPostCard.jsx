import { useEffect,useRef,useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { socialScope,avatarBlob,postPhotoBlob } from '../lib/social-api.js'
import { socialVolume } from '../lib/social-metrics.js'
import { fmtDur,fmtNum,fmtVol } from '../lib/format.js'
import { t,dateLocale } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import Icon from './Icon.jsx'
import { Thumb } from './Media.jsx'
import PostEngagement from './PostEngagement.jsx'

function useImage(fetcher,key,visible,scope) {
  const [url,setUrl]=useState(null)
  useEffect(()=>{let gone=false,objectUrl;setUrl(null)
    if(visible&&key)fetcher().then(blob=>{if(!gone&&socialScope(useStore.getState().user)===scope){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)}}).catch(()=>{})
    return()=>{gone=true;if(objectUrl)URL.revokeObjectURL(objectUrl)}
  },[key,visible,scope])
  return url
}
function ExerciseList({post,onOpen}) {
  const exercises=post.snapshot.exercises,more=exercises.length-5
  return <div className="post-exercise-preview"><ul>{exercises.slice(0,5).map((e,i)=><li key={i}>
    <span className="post-exercise-icon" aria-hidden="true">{e.catalogId&&EXIDX[e.catalogId]?<Thumb ex={EXIDX[e.catalogId]} />:<Icon name="dumbbell" />}</span>
    <span>{t('{0} sets of {1}',e.setCount??e.sets.length,e.name)}</span>
  </li>)}</ul>{more>0&&<button className="post-more" onClick={onOpen}>{t('See {0} more exercises',more)}</button>}</div>
}
export default function SocialPostCard({post,scope}) {
  const nav=useNavigate(),ref=useRef(null),carousel=useRef(null),[visible,setVisible]=useState(false),[slide,setSlide]=useState(0),[gone,setGone]=useState(false)
  const unit=useStore(s=>s.S?.unit||'kg')
  useEffect(()=>{if(!globalThis.IntersectionObserver){setVisible(true);return}const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'200px'});observer.observe(ref.current);return()=>observer.disconnect()},[])
  useEffect(()=>{setSlide(0);if(carousel.current)carousel.current.scrollLeft=0},[post.assetId])
  const avatar=useImage(()=>avatarBlob(post.author),post.author?.avatarId,visible&&!gone,scope)
  const photo=useImage(()=>postPhotoBlob(post.id,post.assetId),post.assetId?post.id+':'+post.assetId+':'+post.revision:null,visible&&!gone,scope)
  const snapshot=post.snapshot,volume=socialVolume(snapshot,unit),open=()=>nav('/social/posts/'+post.id)
  const date=new Date(snapshot.date+'T12:00:00'),validDate=Number.isFinite(date.getTime())
  const metrics=[{label:t('Workout time'),value:snapshot.durationSec==null?'—':fmtDur(snapshot.durationSec*1000)},{label:t('Total volume'),value:fmtVol(Math.round(volume.value),volume.unit)},
    ...(snapshot.records>0?[{label:t('Records'),value:fmtNum(snapshot.records)}]:[]),...(snapshot.averageHeartRate?[{label:t('Avg. heart rate'),value:t('{0} bpm',fmtNum(snapshot.averageHeartRate))}]:[])]
  return <article className="card social-post-card" ref={ref}>{gone?<p>{t('This post is no longer available.')}</p>:<>
    <button type="button" className="post-author" onClick={()=>nav('/social/profiles/'+post.authorId)}>
      <span className="post-avatar">{avatar?<img src={avatar} alt="" />:(post.author?.displayName||'?').slice(0,1).toUpperCase()}</span>
      <span><strong>{post.author?.displayName}</strong><time className="small dim" dateTime={snapshot.date}>{validDate?date.toLocaleDateString(dateLocale(),{dateStyle:'medium'}):snapshot.date}</time></span>
    </button>
    <button className="post-title" onClick={open}><h2>{snapshot.title||t('Workout')}</h2></button>
    {post.caption&&<p className="social-bio post-caption">{post.caption}</p>}
    <dl className="post-metrics" style={{gridTemplateColumns:`repeat(${metrics.length},minmax(0,1fr))`}}>{metrics.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>
    {post.assetId?<><div className="post-carousel" ref={carousel} onScroll={e=>setSlide(Math.round(e.currentTarget.scrollLeft/e.currentTarget.clientWidth))} aria-label={t('Workout photo and exercises')}>
      <div className="post-slide photo-slide">{photo?<img src={photo} alt={t('Workout photo')} loading="lazy" />:<span className="small dim">{t('Workout photo')}</span>}</div>
      <div className="post-slide workout-slide"><ExerciseList post={post} onOpen={open} /></div>
    </div><div className="post-slide-controls">{[t('Workout photo'),t('Workout preview')].map((label,i)=><button key={label} aria-label={label} aria-pressed={slide===i} onClick={()=>carousel.current?.scrollTo({left:carousel.current.clientWidth*i,behavior:'smooth'})}><span /></button>)}</div></>:<ExerciseList post={post} onOpen={open} />}
    <PostEngagement post={post} scope={scope} visible={visible} onUnavailable={()=>setGone(true)} />
  </>}</article>
}
