import { useEffect, useRef, useState } from 'react'
import SocialReport from '../components/SocialReport.jsx'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { socialScope, socialPostsAvailable, readProfile, readOwnPost, readPost, publishPost, deletePost, uploadPostPhoto, prepareAvatar, postPhotoBlob } from '../lib/social-api.js'
import { buildSocialSnapshot, socialWorkoutId,averageHeartRateOf } from '../lib/social-snapshot.js'
import { readDraft, saveDraft, deleteDraft, postRequestId, sendDraft } from '../lib/social-drafts.js'
import { exOr } from '../lib/exercises.js'
import { socialVolume } from '../lib/social-metrics.js'
import { exerciseNameText,fmtNum,fmtVol } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import SocialGate from '../components/SocialGate.jsx'
import PostPreview from '../components/PostPreview.jsx'
import './Profile.css'

export default function PostComposer() {
  const user = useStore(s => s.user), config = useStore(s => s.config), server = useStore(s => s.sync?.server)
  const { source, post: postId } = useParams(), scope = socialScope(user)
  if (!user || (config && !socialPostsAvailable(user, config))) return <SocialGate />
  return <Composer key={scope + ':' + server + ':' + source + ':' + postId} source={source} postId={postId} scope={scope} user={user} />
}
const findWorkout = source => useStore.getState().S.workouts?.find(w => socialWorkoutId(w) === source)
const snapshotOf = (w,shareHeartRate=false) => buildSocialSnapshot(w, useStore.getState().S, e => e.n || e.name || exerciseNameText(exOr(e.id)),{shareHeartRate})

function Composer({ source, postId, scope, user }) {
  const nav = useNavigate(), [draft, setDraft] = useState(null), [post, setPost] = useState(null), [epoch, setEpoch] = useState(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [photoOptions,setPhotoOptions]=useState(false),photoDialog=useRef(null)
  useEffect(()=>{if(photoOptions)photoDialog.current?.showModal();else photoDialog.current?.close()},[photoOptions])
  const [image, setImage] = useState(null), [confirmDelete, setConfirmDelete] = useState(false)
  const live = useRef(true), lock = useRef(false), latest = useRef(null), latestPost = useRef(null), picker = useRef(null), camera = useRef(null)
  latest.current = draft
  latestPost.current = post
  const valid = () => live.current && socialScope(useStore.getState().user) === scope
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const newDraft = (w, profileEpoch, p = null) => ({ scope, sourceWorkoutId: p?.sourceWorkoutId || socialWorkoutId(w), profileEpoch,
    snapshot: p?.snapshot || snapshotOf(w), caption: p?p.caption:(w?.hevyDescription||''), audience: p?.audience || 'followers',
    photo: null, assetId: p?.assetId || null, postId: p?.id || null, revision: p?.revision, requestId: postRequestId(), confirmed: false, status: 'draft' })
  const load = async () => {
    setLoading(true); setError('')
    try {
      if (latest.current) await saveDraft(latest.current)
      if (!valid()) return
      setPost(null); setDraft(null); setImage(null)
      const remote = await Promise.allSettled([postId ? readPost(postId) : readOwnPost(source), readProfile()])
      if (!valid()) return
      const p = remote[0].status === 'fulfilled' ? remote[0].value.post : null
      const currentEpoch = remote[1].status === 'fulfilled' ? remote[1].value.profile?.socialEpoch : null
      if (p && p.authorId !== user.id) { setPost(p); setDraft(null); return }
      const key = p?.sourceWorkoutId || source
      if (!key) throw Error('post-missing')
      let cached = await readDraft(scope, key).catch(() => null)
      if (!valid()) return
      if (cached && currentEpoch && cached.profileEpoch !== currentEpoch) {
        cached = { ...cached, profileEpoch: currentEpoch, requestId: postRequestId(), confirmed: false, status: 'draft',
          postId: p?.id || null, revision: p?.revision, assetId: cached.photo ? postRequestId() : null }
        await saveDraft(cached)
      }
      if (cached && p && (cached.postId !== p.id || cached.revision !== p.revision)) {
        cached = { ...cached, postId: p.id, revision: p.revision, requestId: postRequestId(), confirmed: false, status: 'draft' }
        await saveDraft(cached)
      }
      if (!valid()) return
      setEpoch(currentEpoch); setPost(p)
      const w = findWorkout(key)
      setDraft(cached || (!p && w ? newDraft(w, currentEpoch) : null))
      if (!p && !cached && !w) setError(t('Workout not found. Your saved posts are separate.'))
      else if (!currentEpoch && (!p || p.authorId === user.id) && !cached?.profileEpoch) setNotice(t('Create your social profile before publishing.'))
    } catch (e) { if (valid()) setError(e.code === 'post-invalid' ? t('Nothing to share in this one.') : t('Could not load this profile. Please try again.')) }
    finally { if (valid()) setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible' || latest.current || lock.current || !latestPost.current) return
      readPost(latestPost.current.id).then(out => { if (valid() && !latest.current) setPost(out.post) }).catch(() => {
        if (valid() && !latest.current) { setPost(null); setImage(null); setError(t('Could not load this profile. Please try again.')) }
      })
    }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  // Draft writes are ordered in social-drafts.js. Publishing awaits a durable intent first.
  useEffect(() => {
    if (!draft || loading) return
    const timer = setTimeout(() => saveDraft(draft).catch(() => { if (valid()) setError(t('Could not save your draft on this device.')) }), 250)
    return () => clearTimeout(timer)
  }, [draft, loading])
  useEffect(() => {
    let gone = false, url
    setImage(null)
    const selected = draft ? draft.photo : null
    if (selected) { url = URL.createObjectURL(selected); setImage(url) }
    else if (post?.assetId && (!draft || draft.assetId === post.assetId)) postPhotoBlob(post.id, post.assetId).then(blob => {
      if (!gone && valid()) { url = URL.createObjectURL(blob); setImage(url) }
    }).catch(() => {})
    return () => { gone = true; if (url) URL.revokeObjectURL(url) }
  }, [draft?.photo, draft?.assetId, post?.id, post?.assetId])
  const attempt = async d => {
    if (lock.current || !valid()) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const saved = await sendDraft(d, { currentScope: () => valid() ? socialScope(useStore.getState().user) : null,
        sourceExists: id => !!findWorkout(id), transport: { upload: uploadPostPhoto, publish: publishPost } })
      if (valid()) { setPost(saved); setDraft(null); setNotice(t('Post published.')) }
    } catch (e) {
      if (valid()) {
        setDraft(await readDraft(scope, d.sourceWorkoutId).catch(() => d))
        setError(t('Could not publish. Your draft is kept.'))
      }
    } finally { lock.current = false; if (valid()) setBusy(false) }
  }
  useEffect(() => {
    const resume = () => { const d = latest.current; if (d?.confirmed && ['pending', 'failed'].includes(d.status) && navigator.onLine !== false) attempt(d) }
    window.addEventListener('online', resume)
    if (!loading) resume()
    return () => window.removeEventListener('online', resume)
  }, [loading])
  const change = patch => { setError(''); setNotice(''); setDraft(d => ({ ...d, ...patch, confirmed: false, status: 'draft', requestId: postRequestId() })) }
  const pick = async ev => {
    const file = ev.target.files?.[0]; ev.target.value = ''; if (!file) return
    if (lock.current) return
    lock.current = true
    change({})
    setBusy(true); setError('')
    try { const photo = await prepareAvatar(file); if (valid()) change({ photo, assetId: postRequestId() }) }
    catch { if (valid()) setError(t('This photo could not be read. Choose another photo.')) }
    finally { lock.current = false; if (valid()) setBusy(false) }
  }
  const confirmPublish = async ev => {
    ev.preventDefault()
    if (busy || lock.current || !draft || (!draft.postId && !findWorkout(draft.sourceWorkoutId))) return
    lock.current = true
    const pending = { ...draft, confirmed: true, status: 'pending' }
    setBusy(true); setError('')
    try {
      await saveDraft(pending)
      if (!valid()) { lock.current = false; return }
      setDraft(pending); setBusy(false)
      lock.current = false
      if (navigator.onLine === false) setNotice(t('Publishing queued. It will retry when this screen reconnects.'))
      else await attempt(pending)
    } catch { lock.current = false; if (valid()) { setError(t('Could not save your draft on this device.')); setBusy(false) } }
  }
  const keep = async () => {
    if(lock.current||!draft||!valid())return
    lock.current=true;setBusy(true)
    const d = { ...draft, confirmed: false, status: 'draft' }; latest.current=d;setDraft(d)
    try { await saveDraft(d); if (valid()) nav('/home') }
    catch { if (valid()) setError(t('Could not save your draft on this device.')) }
    finally {lock.current=false;if(valid())setBusy(false)}
  }
  const remove = async () => {
    setBusy(true); setError('')
    try {
      await deletePost(post.id); await deleteDraft(scope, post.sourceWorkoutId)
      if (valid()) { setDraft(null); setPost(null); setConfirmDelete(false); nav('/social/profiles/' + user.id + '/posts', { replace: true }) }
    } catch { if (valid()) setError(t('Could not publish. Your draft is kept.')) }
    finally { if (valid()) setBusy(false) }
  }
  return <div className="narrow social-profile" aria-busy={busy}>
    <div className="hdr"><h1>{t('Share to feed')}</h1><Button size="sm" variant="ghost" onClick={() => nav('/home')}>{t('Back')}</Button></div>
    {loading && <div role="status" className="card">{t('Loading…')}</div>}
    {error && <div className="card" role="alert"><p>{error}</p><Button disabled={busy} onClick={load}>{t('Reload')}</Button></div>}
    {notice && <div className="card" role="status">{notice}</div>}
    {draft && !notice && !error && ['pending', 'failed'].includes(draft.status) && <div className="card" role="status">{draft.status === 'failed' ? t('Could not publish. Your draft is kept.') : busy ? t('Saving…') : t('Publishing queued. It will retry when this screen reconnects.')}</div>}
    {!loading && (draft || post) && <div className="card">
      {draft?<><h2>{draft.snapshot.title||t('Workout')}</h2><dl className="post-metrics composer-metrics">
        <div><dt>{t('Exercises')}</dt><dd>{fmtNum(draft.snapshot.exercises.length)}</dd></div>
        <div><dt>{t('Volume')}</dt><dd>{fmtVol(Math.round(socialVolume(draft.snapshot).value),socialVolume(draft.snapshot).unit)}</dd></div>
        <div><dt>{t('PRs')}</dt><dd>{fmtNum(draft.snapshot.records||0)}</dd></div>
      </dl></>:<PostPreview snapshot={post.snapshot} />}
      <p className="small dim">{t('Your workout, caption and selected photo will be shared. Notes, body weight, location and raw health data stay private.')}</p>
      {image && <img className="post-photo" src={image} alt={t('Workout photo')} />}
      {draft ? <form onSubmit={confirmPublish}><fieldset disabled={busy}>
        {(averageHeartRateOf(findWorkout(draft.sourceWorkoutId))||post?.snapshot.averageHeartRate)&&<label className="social-consent"><input type="checkbox" checked={!!draft.snapshot.averageHeartRate} onChange={ev=>{const {averageHeartRate,...snapshot}=draft.snapshot;change({snapshot:ev.target.checked?{...snapshot,averageHeartRate:averageHeartRateOf(findWorkout(draft.sourceWorkoutId))||post.snapshot.averageHeartRate}:snapshot})}} /><span>{t('Share average heart rate')}</span></label>}
        <label>{t('Post caption')}<textarea aria-label={t('Post caption')} maxLength={2000} rows={3} value={draft.caption} onChange={ev => change({ caption: ev.target.value })} /></label>
        <div className="composer-audience" role="group" aria-label={t('Post audience')}>
          {[['followers',t('Followers')],['members',t('Public')]].map(([value,label])=><Button key={value} type="button" variant={draft.audience===value?'primary':'tinted'} aria-pressed={draft.audience===value} onClick={()=>change({audience:value})}>{label}</Button>)}
        </div>
        <p className="small dim">{draft.audience==='members'?t('Public posts are visible to signed-in members of this server.'):t('Only your followers can see this post.')}</p>
        <div className="social-actions"><Button type="button" variant="tinted" aria-haspopup="dialog" onClick={() => setPhotoOptions(true)}>{t('Add photo')}</Button>
          {draft.assetId && <Button type="button" variant="ghost" onClick={() => change({ photo: null, assetId: null })}>{t('Remove photo')}</Button>}</div>
        <input ref={picker} type="file" accept="image/*" hidden onChange={pick} /><input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
        {draft.postId && findWorkout(draft.sourceWorkoutId) && <Button type="button" variant="ghost" onClick={() => change({ snapshot: snapshotOf(findWorkout(draft.sourceWorkoutId),!!draft.snapshot.averageHeartRate) })}>{t('Refresh workout preview')}</Button>}
        {!draft.postId && !findWorkout(draft.sourceWorkoutId) && <p role="alert">{t('Workout not found. Your saved posts are separate.')}</p>}
        <div className="social-actions"><Button type="submit" variant="primary" disabled={!draft.profileEpoch || (!draft.postId && !findWorkout(draft.sourceWorkoutId))}>{t('Publish post')}</Button></div>
        <Button type="button" variant="ghost" onClick={keep}>{draft.postId?t('Cancel'):t('Cancel and save private')}</Button>
        {!draft.profileEpoch && <Button type="button" onClick={() => nav('/social')}>{t('Social profile')}</Button>}
      </fieldset></form> : <>
        <p className="social-bio">{post.caption}</p><p className="small dim">{post.audience === 'followers' ? t('Followers') : t('Server members')}</p>
        <SocialReport type="post" id={post.id} ownerId={post.authorId} />
        {post.authorId === user.id && <div className="social-actions"><Button disabled={busy} onClick={() => setDraft(newDraft(null, epoch, post))}>{t('Edit post')}</Button><Button disabled={busy} variant="ghost" onClick={() => setConfirmDelete(true)}>{t('Delete post')}</Button></div>}
        {confirmDelete && <div role="alert"><p>{t('Delete this post? Your private workout will be kept.')}</p><Button disabled={busy} variant="danger" onClick={remove}>{t('Delete post')}</Button><Button disabled={busy} onClick={() => setConfirmDelete(false)}>{t('Cancel')}</Button></div>}
      </>}
    </div>}
    <dialog ref={photoDialog} className="composer-photo-dialog" aria-label={t('Add photo')} onCancel={()=>setPhotoOptions(false)} onClick={ev=>{if(ev.target===ev.currentTarget)setPhotoOptions(false)}}>
      <h2>{t('Add photo')}</h2><div className="social-actions">
        <Button type="button" disabled={busy} onClick={()=>{setPhotoOptions(false);picker.current?.click()}}>{t('Choose photo')}</Button>
        <Button type="button" disabled={busy} onClick={()=>{setPhotoOptions(false);camera.current?.click()}}>{t('Take photo')}</Button>
        <Button type="button" variant="ghost" onClick={()=>setPhotoOptions(false)}>{t('Cancel')}</Button>
      </div>
    </dialog>
  </div>
}
