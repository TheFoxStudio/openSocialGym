import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { socialAvailable, socialScope, readProfile, saveProfile, removeProfile, avatarBlob, prepareAvatar, uploadAvatar, removeAvatar, setFollow, setBlock } from '../lib/social-api.js'
import { Button } from '../components/ui.jsx'
import Posts from './Posts.jsx'
import ProfilePhotos from '../components/ProfilePhotos.jsx'
import { fmtVol,fmtNum } from '../lib/format.js'
import SocialGate from '../components/SocialGate.jsx'
import SocialReport from '../components/SocialReport.jsx'
import SocialExport from '../components/SocialExport.jsx'
import { clearDrafts } from '../lib/social-drafts.js'
import './Profile.css'

export default function Profile() {
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const server = useStore(s => s.sync?.server)
  const { id } = useParams()
  const scope = socialScope(user)
  if (!socialAvailable(user, config)) return <SocialGate />
  return <ProfileContent key={scope + ':' + server + ':' + (id || 'me')} id={id} own={!id || id === user.id} scope={scope} graph={config.social.graph === true} posts={config.social.posts === true} />
}

function ProfileContent({ id, own, scope, graph, posts }) {
  const nav = useNavigate()
  const [profile, setProfile] = useState(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const [overview,setOverview]=useState(null)
  const unit=useStore(s=>s.S?.unit||'kg')
  const [relationship, setRelationship] = useState(null)
  const [image, setImage] = useState(null)
  const [pending, setPending] = useState(null)
  const [fields, setFields] = useState({ handle: '', displayName: '', bio: '', accepted: false })
  const picker = useRef(null), camera = useRef(null), live = useRef(true)
  const valid = () => live.current && socialScope(useStore.getState().user) === scope
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const accept = p => {
    setProfile(p); setPending(null); setConfirmRemove(false)
    setFields({ handle: p?.handle || '', displayName: p?.displayName || '', bio: p?.bio || '', accepted: false })
  }
  const load = async () => {
    setError(''); setLoading(true)
    try { const out = await readProfile(id); if (valid()) { accept(out.profile); setRelationship(out.relationship || null); setOverview(out.overview || null) } }
    catch { if (valid()) { setProfile(undefined); setOverview(null); setRelationship(null); setImage(null); setError(t('Could not load this profile. Please try again.')) } }
    finally { if (valid()) setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && !editing && !busy) load() }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [editing, busy])
  useEffect(() => {
    let gone = false, url = null
    setImage(null)
    if (pending) { url = URL.createObjectURL(pending); setImage(url) }
    else if (profile?.avatarId) avatarBlob(profile).then(blob => {
      if (!gone && valid()) { url = URL.createObjectURL(blob); setImage(url) }
    }).catch(() => { /* initials remain available if offline */ })
    return () => { gone = true; if (url) URL.revokeObjectURL(url) }
  }, [profile?.avatarId, pending])
  const pick = async ev => {
    const file = ev.target.files?.[0]; ev.target.value = ''
    if (!file) return
    setBusy(true); setError('')
    try { const blob = await prepareAvatar(file); if (valid()) setPending(blob) }
    catch { if (valid()) setError(t('This photo could not be read. Choose another photo.')) }
    finally { if (valid()) setBusy(false) }
  }
  const run = async action => {
    if (!valid()) return
    setBusy(true); setError('')
    try { await action() }
    catch (e) {
      if (valid()) setError(e.data?.code === 'handle-taken' ? t('That handle is already taken.')
        : e.data?.code === 'profile-conflict' ? t('Your profile changed. Reload before saving.')
          : e.data?.code === 'profile-required' ? t('Save your profile to follow members.')
          : t('Could not save your profile. Please try again.'))
    } finally { if (valid()) setBusy(false) }
  }
  const save = ev => {
    ev.preventDefault()
    run(async () => {
      const out = await saveProfile({ ...fields, revision: profile?.revision })
      if (!valid()) return
      setProfile(out.profile)
      // Profile save and photo upload are separate: a failed upload retains the draft photo
      // and the accepted revision, so Retry can succeed without overwriting another device.
      let saved = out.profile
      if (pending) {
        const photo = pending
        if (!valid()) return
        saved = (await uploadAvatar(photo)).profile
      }
      if (valid()) { accept(saved); setEditing(false) }
    })
  }
  const change = ev => setFields(s => ({ ...s, [ev.target.name]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value }))
  const editor = own && (editing || profile === null)
  return <div className="narrow social-profile" aria-busy={busy}>
    <div className="hdr"><h1>{t('Social profile')}</h1><Button size="sm" variant="ghost" onClick={() => nav('/home')}>{t('Back')}</Button></div>

    {error && <div className="card" role="alert"><p>{error}</p><Button disabled={busy} onClick={load}>{t('Reload')}</Button></div>}
    {profile === undefined ? (loading && <div className="card" role="status">{t('Loading…')}</div>) : <div className="card profile-overview">
      {own&&profile&&!editor&&<details className="profile-menu"><summary aria-label={t('Profile actions')}>⋯</summary><div><Button onClick={() => setEditing(true)}>{t('Edit profile')}</Button><SocialExport /><Button variant="ghost" onClick={() => setConfirmRemove(true)}>{t('Remove social profile')}</Button></div></details>}
      <div className="social-avatar">{image ? <img src={image} alt={t('Profile photo')} /> : <span aria-label={t('Profile photo')}>{(profile?.displayName || fields.displayName || '?').slice(0, 1).toUpperCase()}</span>}</div>
      {editor ? <form onSubmit={save}>
        <fieldset disabled={busy}>
          <label>{t('Profile handle')}<input name="handle" value={fields.handle} onChange={change} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]{3,30}" autoCapitalize="none" autoCorrect="off" /></label>
          <p className="small dim">{t('Use 3–30 letters, numbers or underscores.')}</p>
          <label>{t('Display name')}<input name="displayName" value={fields.displayName} onChange={change} required maxLength={60} /></label>
          <label>{t('Bio')}<textarea aria-label={t('Bio')} name="bio" value={fields.bio} onChange={change} maxLength={300} rows={3} /></label>
          {profile ? <>
            <div className="social-actions">
              <Button type="button" variant="tinted" onClick={() => picker.current?.click()}>{t('Choose photo')}</Button>
              <Button type="button" variant="tinted" onClick={() => camera.current?.click()}>{t('Take photo')}</Button>
              {(pending || profile.avatarId) && <Button type="button" variant="ghost" onClick={() => pending ? setPending(null) : run(async () => { const out = await removeAvatar(); if (valid()) setProfile(out.profile) })}>{t('Remove photo')}</Button>}
            </div>
            <p className="small dim">{t('Your photo is cropped to a square. Preview it before saving.')}</p>
          </> : <p className="small dim">{t('Save your profile to add a photo.')}</p>}
          <input ref={picker} type="file" accept="image/*" hidden onChange={pick} />
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
          {!profile && <label className="social-consent"><input name="accepted" type="checkbox" checked={fields.accepted} onChange={change} required /><span>{t('I understand my profile and avatar will be visible to signed-in members of this server. My workouts stay private.')}</span></label>}
          <div className="social-actions"><Button type="submit" variant="primary" disabled={!profile && !fields.accepted}>{busy ? t('Saving…') : t('Save profile')}</Button>
            {profile && <Button type="button" variant="ghost" onClick={() => { accept(profile); setEditing(false) }}>{t('Cancel')}</Button>}
          </div>
        </fieldset>
      </form> : profile ? <>
        <h2>{profile.displayName}</h2><p className="muted">@{profile.handle}</p><p className="social-bio">{profile.bio}</p>
        <SocialReport type="profile" id={profile.id} ownerId={profile.id} />
        <dl className="profile-statistics" aria-label={t('Statistics from shared workouts')}>
          <div><dd>{overview?fmtNum(overview.totalWorkouts):'—'}</dd><dt>{t('Total workouts')}</dt></div>
          <div><dd>{overview?fmtVol(Math.round(overview.totalVolumeKg*(unit==='lb'?1/0.45359237:1)),unit):'—'}</dd><dt>{t('Total volume')}</dt></div>
          {graph&&<><div><dd>{fmtNum(relationship?.followerCount||0)}</dd><dt><button onClick={()=>nav('/social/profiles/'+profile.id+'/followers')}>{t('Followers')}</button></dt></div>
          <div><dd>{fmtNum(relationship?.followingCount||0)}</dd><dt><button onClick={()=>nav('/social/profiles/'+profile.id+'/following')}>{t('Following')}</button></dt></div></>}
        </dl>
        {!own && graph && <div className="social-actions">
          <Button disabled={busy} variant="primary" onClick={() => run(async () => { const out = await setFollow(profile.id, !relationship?.isFollowing); if (valid()) { setRelationship(out.relationship); if(posts)await load() } })}>{relationship?.isFollowing ? t('Unfollow member') : t('Follow member')}</Button>
          <Button disabled={busy} variant="ghost" onClick={() => setConfirmBlock(true)}>{t('Block member')}</Button>
        </div>}
        {confirmBlock && <div role="alert"><p>{t('Block this member? You will stop following each other and your profiles will be hidden from each other.')}</p>
          <Button disabled={busy} variant="danger" onClick={() => run(async () => { await setBlock(profile.id, true); if (valid()) { setImage(null); setProfile(undefined); setRelationship(null); nav('/social/people', { replace: true }) } })}>{t('Block member')}</Button>
          <Button disabled={busy} variant="ghost" onClick={() => setConfirmBlock(false)}>{t('Cancel')}</Button>
        </div>}
        {confirmRemove && <div role="alert"><p>{t('Remove your social profile and avatar? Your account and private workouts will be kept.')}</p>
          <Button disabled={busy} variant="danger" onClick={() => run(async () => { await removeProfile(); await clearDrafts(scope).catch(() => {}); if (valid()) accept(null) })}>{t('Remove social profile')}</Button>
          <Button disabled={busy} variant="ghost" onClick={() => setConfirmRemove(false)}>{t('Cancel')}</Button>
        </div>}
      </> : null}
    </div>}
    {profile&&!editor&&posts&&<><ProfilePhotos posts={overview?.photos||[]} scope={scope} /><Posts key={String(relationship?.isFollowing)} profileId={profile.id} embedded /></>}
  </div>
}
