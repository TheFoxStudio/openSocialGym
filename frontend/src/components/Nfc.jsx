// NFC stickers (v1.4.4): writing one (Settings → NFC stickers, an exercise's details) and doing
// what a tapped one asks. What a sticker says and the routing rules: lib/nfc-tags.js; the
// device side: lib/nfc.js. Existing machine tags can also be assigned without rewriting them.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO, exerciseNameText } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import { nav, navToWorkout } from '../lib/nav.js'
import { platformNow } from '../lib/platform-now.js'
import { tagUrl, parseTagUrl, routeTag, tagDebouncer } from '../lib/nfc-tags.js'
import {tagIdentity,assignedExercise,bindExerciseTag,removeExerciseTag} from '../lib/nfc-assignments.js'
import { nfcSupport, writeTag, cancelWrite, onTagLink, startTagScan } from '../lib/nfc.js'
import { autoGymHere } from '../lib/gym-auto.js'
import { freestyleConfig, pickedExerciseConfig, supersetUnits } from '../lib/history.js'
import { insertionIndexAfterCurrentUnit } from '../lib/supersetFlow.js'
import { buildSessionEntry, builtOutOfProgression } from '../lib/session-start.js'
import { joinSessionNoProg } from '../lib/session-noprog.js'
import { sessionHistory } from '../lib/backfill.js'
import { startFlow, confirmSheet, exerciseDetailSheet } from '../sheets.jsx'
import { Button, Section, Row } from './ui.jsx'
import Icon from './Icon.jsx'

const ui = () => useUI.getState()

/** Whether this device can write a sticker: false until known, so the rows never flash. */
export function useNfcSupported() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let gone = false
    nfcSupport().then(r => { if (!gone) setOk(!!r?.supported) }).catch(() => {})
    return () => { gone = true }
  }, [])
  return ok
}

const errorText = code => ({
  'read-only': t('This sticker is locked. Try a blank one.'),
  'too-small': t('This sticker is too small. NTAG213 or bigger works.'),
  disabled: t('NFC is off. Turn it on in your phone’s settings and try again.'),
  denied: t('openGym isn’t allowed to use NFC here.'),
  unsupported: t('This sticker can’t hold a link. Try an NTAG sticker.'),
}[code] || t('That didn’t work. Hold your phone still on the sticker and try again.'))

// The write step both sheets share: one button, then "hold it there", then done.
export function WriteSticker({ url, close }) {
  const [step, setStep] = useState('idle') // idle | waiting | done | error
  const [err, setErr] = useState('')
  const live = useRef(true)
  const ios = platformNow() === 'ios'
  useEffect(() => () => { live.current = false; cancelWrite() }, [])
  const go = () => {
    setStep('waiting'); setErr('')
    writeTag(url, { alert: t('Hold the top of your iPhone near the sticker.'), done: t('Sticker ready.') })
      .then(() => { quietAfterWrite(); if (live.current) setStep('done') })
      .catch(e => {
        if (!live.current) return
        if (e?.code === 'cancelled') { setStep('idle'); return }
        setErr(errorText(e?.code)); setStep('error')
      })
  }
  if (step === 'done') return <>
    <div className="row" style={{ gap: 8, margin: '14px 0 6px' }}><Icon name="checkCircle" style={{ color: 'var(--acc-ink)' }} /><b>{t('Sticker ready. Tap it with your phone to try it.')}</b></div>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
  return <>
    {step === 'waiting' && !ios && <div className="row" style={{ gap: 8, margin: '14px 0 6px' }}><Icon name="nfc" /><span>{t('Hold the back of your phone to the sticker.')}</span></div>}
    {step === 'error' && <div className="small" role="alert" style={{ color: 'var(--red)', margin: '12px 0 4px' }}>{err}</div>}
    {step === 'waiting' && !ios
      ? <Button onClick={() => { cancelWrite(); setStep('idle') }}>{t('Cancel')}</Button>
      : <Button variant="primary" icon="nfc" style={{ marginTop: 10 }} disabled={step === 'waiting'} onClick={go}>{step === 'error' ? t('Try again') : t('Write sticker')}</Button>}
    <div className="small dim" style={{ marginTop: 10 }}>{t('Any blank NTAG sticker works. Writing replaces what was on it.')}</div>
  </>
}

function StickerSetup({ close }) {
  const S = useStore(s => s.S)
  const cards = S.checkIn !== false && Array.isArray(S.gymCards) ? S.gymCards : []
  const [mode, setMode] = useState('start')
  const [card, setCard] = useState(() => (cards.some(c => c.id === S.lastGymCardId) ? S.lastGymCardId : cards[0]?.id) || null)
  const checkin = mode === 'checkin' && cards.length > 0
  const url = tagUrl({ kind: 'checkin', start: !checkin, card: checkin && cards.length > 1 ? card : null })
  return <>
    <h3>{t('Set up an NFC sticker')}</h3>
    <div className="small muted" style={{ marginBottom: 10 }}>{t('Put it on your locker, your bag or the gym door. One tap with your phone and you’re in.')}</div>
    <Section title={t('When you tap it')}>
      <Row icon="play" iconTint="var(--green)" title={t('Start today’s workout')}
        subtitle={t('Starts what’s planned for today, or opens the one already running.')}
        accessory={mode === 'start' || !cards.length ? 'check' : 'none'} onClick={() => setMode('start')} />
      {cards.length > 0 && <Row icon="qr" iconTint="var(--blue)" title={t('Just check in')}
        subtitle={t('Shows your gym membership code, ready for the scanner.')}
        accessory={checkin ? 'check' : 'none'} onClick={() => setMode('checkin')} />}
    </Section>
    {checkin && cards.length > 1 && <Section title={t('Which code')}>
      {cards.map(c => <Row key={c.id} title={c.label || t('Gym card')} accessory={card === c.id ? 'check' : 'none'} onClick={() => setCard(c.id)} />)}
    </Section>}
    <WriteSticker key={url} url={url} close={close} />
  </>
}
export const nfcStickerSheet = () => ui().openSheet(close => <StickerSetup close={close} />)

function ExerciseSticker({ ex, close }) {
  return <>
    <h3>{t('NFC sticker for this exercise')}</h3>
    <div className="small muted" style={{ marginBottom: 6 }}>{t('Stick it on the machine. Tap it during a workout to jump to {0}, or to add it.', exerciseNameText(ex))}</div>
    <WriteSticker url={tagUrl({ kind: 'exercise', id: ex.id })} close={close} />
  </>
}
export const nfcExerciseSheet = ex => ui().openSheet(close => <ExerciseSticker ex={ex} close={close} />)

/* ---------------- a tapped sticker ---------------- */

// Adds the machine's exercise after the current one, as the workout's own Add does with its
// quick "+": the routine block it lands in decides its prescription, freestyle repeats last time.
export function addExerciseToSession(id) {
  let added = -1
  useStore.getState().update(s => {
    const A = s.active
    if (!A || !Array.isArray(A.entries)) return
    const curEntry = A.entries[A.cur]
    const curRid = curEntry?.rid
    const routine = curRid ? (s.routines || []).find(r => r.id === curRid) : null
    const noProg = !!routine && builtOutOfProgression(curEntry, routine)
    const cfg = routine ? pickedExerciseConfig(id) : freestyleConfig(sessionHistory(s), { id, ...pickedExerciseConfig(id) })
    const built = buildSessionEntry(s, id, cfg, routine, curEntry)
    const at = insertionIndexAfterCurrentUnit(supersetUnits(A.entries), A.cur, A.entries.length)
    A.entries.splice(at, 0, joinSessionNoProg(A, { id, ...built, ...(curRid ? { rid: curRid, addedInSession: true } : {}), ...(noProg ? { noProg: true } : {}) }))
    A.cur = at
    added = at
  })
  if (added >= 0) ui().shiftRestOwner?.(added, 1)
  return added
}

const toWorkout = () => { if (!String(globalThis.location?.hash || '').startsWith('#/workout')) navToWorkout() }
const nameOf = id => exerciseNameText(EXIDX[id] || (useStore.getState().S.customEx||[]).find(e=>e.id===id) || { id, n: id })
let fresh = tagDebouncer()
// The phone is still on the sticker it just wrote: Android hands that sticker to the app again the
// moment the write lets go of it, and a fresh sticker should not start a workout there and then.
const QUIET_MS = 4000
let quietUntil = 0
const quietAfterWrite = (now = Date.now()) => { quietUntil = now + QUIET_MS }

/** Does what the sticker behind `url` asks. Answers false for a link that is not one of ours. */
export function handleTagLink(url, now = Date.now()) {
  const tag = parseTagUrl(url)
  if (!tag) return false
  if (now < quietUntil || !fresh(url, now)) return true
  const S = useStore.getState().S
  const r = routeTag(S, tag, { today: todayISO(), hasExercise: id => !!EXIDX[id] })
  // A check-in sticker at a place linked to an equipment profile switches to that gym (#808). A
  // start sticker gets there through beginWorkout, which does the same.
  if (tag.kind === 'checkin' && r.do !== 'start') autoGymHere()
  switch (r.do) {
    case 'start': startFlow(r.ids); break
    case 'open-workout':
    case 'open-start': toWorkout(); break
    case 'checkin':
      if (r.card && r.card !== S.lastGymCardId) useStore.getState().update(s => { s.lastGymCardId = r.card })
      nav('/checkin')
      break
    case 'jump':
      useStore.getState().update(s => { if (s.active?.entries?.[r.idx]) s.active.cur = r.idx })
      toWorkout()
      ui().toast(nameOf(S.active.entries[r.idx]?.id))
      break
    case 'offer-add': {
      toWorkout()
      const name = nameOf(r.id)
      confirmSheet({
        title: t('Add {0}?', name), message: t('It isn’t in this workout yet.'), confirmText: t('Add to this workout'),
        onConfirm: () => { if (useStore.getState().S.active && addExerciseToSession(r.id) >= 0) ui().toast(t('“{0}” added', name)) },
      })
      break
    }
    case 'details': exerciseDetailSheet(EXIDX[r.id]); break
    case 'unknown-exercise': ui().toast(t('This sticker is for an exercise you don’t have.')); break
    default: return false
  }
  return true
}

/**
 * Listens for sticker links for the whole app. One that arrives before the app is set up (a cold
 * start, the sign-in screen) waits until it is.
 */
export function useNfcTagLinks(ready) {
  const readyRef = useRef(ready)
  const pending = useRef(null)
  readyRef.current = ready
  useEffect(() => {
    const receive = url => {
      if (!parseTagUrl(url)) return
      if (readyRef.current) handleTagLink(url)
      else pending.current = url
    }
    // The self-hosted web shell also serves /nfc links, including a cold browser start.
    receive(globalThis.location?.href)
    return onTagLink(receive)
  }, [])
  useEffect(() => {
    if (!ready || !pending.current) return
    const url = pending.current
    pending.current = null
    setTimeout(() => handleTagLink(url), 0)
  }, [ready])
}

export function _resetNfcRunForTests() { fresh = tagDebouncer(); assignedFresh=tagDebouncer(); quietUntil = 0 }

// Read-only binding for the gym's existing NDEF machine tags.
function AssignExerciseTag({ex,close}){
 const bindings=useStore(s=>s.S.nfcAssignments||{}),account=useStore(s=>s.user?.id),server=useStore(s=>s.sync?.server)
 const supported=useNfcSupported(),context=useRef(JSON.stringify([account,server]))
 const [waiting,setWaiting]=useState(false),[tag,setTag]=useState(null),[error,setError]=useState(''),stop=useRef(null),live=useRef(true),generation=useRef(0)
 const current=()=>live.current&&context.current===JSON.stringify([useStore.getState().user?.id,useStore.getState().sync?.server])&&useStore.getState().user?.id===account&&useStore.getState().sync?.server===server
 useEffect(()=>()=>{live.current=false;generation.current++;stop.current?.()},[])
 const scan=async()=>{
  const n=++generation.current;setWaiting(true);setTag(null);setError('')
  try{stop.current=await startTagScan(async raw=>{
   try{const value=await tagIdentity(raw);if(current()&&n===generation.current)setTag(value)}catch(e){if(current())setError(errorText(e.code))}
  },{once:true,onEnd:()=>{if(current())setWaiting(false)},onError:e=>{if(current())setError(errorText(e.code))}})}catch(e){if(current()&&n===generation.current){setWaiting(false);setError(errorText(e.code))}}
 }
 const save=()=>{if(!tag||!current())return;try{useStore.getState().update(s=>bindExerciseTag(s,tag,ex.id));ui().toast(t('NFC tag assigned.'));close()}catch(e){setError(e.code==='ambiguous'?t('These tags share the same link. Use a phone that can read their unique tag IDs.'):t('Could not assign this tag. Remove an old assignment and try again.'))}}
 const existing=tag?assignedExercise(useStore.getState().S,tag):null
 return <><h3>{t('Assign existing NFC tag')}</h3><p className="small dim">{t('Scan the machine tag to link it to {0}. The tag will not be changed.',exerciseNameText(ex))}</p>
  {error&&<p role="alert">{error}</p>}
  {!supported&&<p className="small dim">{t('Reading existing tags requires Chrome on Android or the updated native app. NFC reading is unavailable in iPhone browsers.')}</p>}
  {waiting?<><p role="status">{t('Hold your phone near the machine tag.')}</p><Button onClick={()=>{generation.current++;stop.current?.();setWaiting(false)}}>{t('Cancel')}</Button></>:<Button icon="nfc" disabled={!supported} onClick={scan}>{t('Scan tag')}</Button>}
  {tag&&<div className="card"><p>{t('Tag read successfully.')}</p>{existing&&existing!==ex.id&&<p>{t('This tag is assigned to {0}. Saving will reassign it.',nameOf(existing))}</p>}<Button variant="primary" onClick={save}>{t('Save assignment')}</Button></div>}
  {Object.entries(bindings).filter(([,v])=>v?.exerciseId===ex.id).map(([key])=><div key={key} className="row between" style={{marginTop:12}}><span className="small">{t('NFC tag')} · {key.slice(-8)}</span><Button size="sm" variant="ghost" onClick={()=>{if(current())useStore.getState().update(s=>removeExerciseTag(s,key))}}>{t('Remove')}</Button></div>)}
 </>
}
export const assignExerciseTagSheet=ex=>ui().openSheet(close=><AssignExerciseTag ex={ex} close={close}/>)

let assignedFresh=tagDebouncer()
export function handleAssignedTag(tag,now=Date.now()){
 const S=useStore.getState().S,A=S.active
 if(!A||A.editingWorkoutId||A.backfill)return false
 const id=assignedExercise(S,tag)
 if(!id)return false
 const known=EXIDX[id]||(S.customEx||[]).find(e=>e.id===id)
 if(!known)return false
 if(!assignedFresh(JSON.stringify([useStore.getState().user?.id,useStore.getState().sync?.server,A.id,id,tag.key]),now))return true
 const index=A.entries.findIndex(e=>e.id===id)
 if(index>=0)useStore.getState().update(s=>{if(s.active===A||s.active?.id===A.id)s.active.cur=index})
 else addExerciseToSession(id)
 ui().toast(nameOf(id));return true
}

export function WorkoutNfc(){
 const supported=useNfcSupported(),account=useStore(s=>s.user?.id),server=useStore(s=>s.sync?.server),activeId=useStore(s=>s.S.active?.id)
 const sheets=useUI(s=>s.sheets?.length||0)
 const [scanning,setScanning]=useState(false),[error,setError]=useState(''),stop=useRef(null),live=useRef(true),starting=useRef(false),scanGeneration=useRef(0)
 const valid=()=>live.current&&useStore.getState().user?.id===account&&useStore.getState().sync?.server===server&&useStore.getState().S.active?.id===activeId
 const begin=async()=>{
  if(starting.current)return;const generation=++scanGeneration.current;const scanValid=()=>valid()&&generation===scanGeneration.current;starting.current=true;setError('');setScanning(true)
  try{const end=await startTagScan(async raw=>{
   try{const tag=await tagIdentity(raw);if(scanValid()){
    const ownLink=(raw.urls||[]).find(url=>parseTagUrl(url))
    const handled=handleAssignedTag(tag)||(ownLink&&handleTagLink(ownLink))
    setError(handled?'':t('This tag has no exercise assignment. Assign it from the exercise details.'))
   }}catch(e){if(scanValid())setError(errorText(e.code))}
  },{onError:e=>{if(scanValid())setError(errorText(e.code))},onEnd:()=>{if(scanValid())setScanning(false)}})
  if(scanValid())stop.current=end;else end()
  }catch(e){if(scanValid()){setError(errorText(e.code));setScanning(false)}}finally{if(generation===scanGeneration.current)starting.current=false}
 }
 useEffect(()=>{
  live.current=true
  // Native Android reader mode intercepts the gym's app link while this view is open.
  const resume=()=>{
   if(!supported||sheets||document.visibilityState==='hidden'||!valid())return
   if(platformNow()==='android')begin()
   else if(!platformNow())Promise.resolve(navigator.permissions?.query?.({name:'nfc'})).then(p=>{if(p?.state==='granted'&&valid()&&!sheets)begin()}).catch(()=>{})
  }
  resume();document.addEventListener('visibilitychange',resume)
  return()=>{live.current=false;scanGeneration.current++;starting.current=false;setScanning(false);document.removeEventListener('visibilitychange',resume);stop.current?.()}
 },[supported,account,server,activeId,sheets])
 if(!supported)return null
 return <div className="workout-nfc"><Button size="sm" variant="ghost" icon="nfc" onClick={()=>scanning?stop.current?.():begin()}>{scanning?t('NFC scanning · Stop'):t('Scan NFC machine')}</Button>{error&&<p className="small dim" role="status">{error}</p>}</div>
}
