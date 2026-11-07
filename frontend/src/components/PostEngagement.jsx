import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { socialScope,likePost,readComments,putComment,deleteComment } from '../lib/social-api.js'
import { postRequestId } from '../lib/social-drafts.js'
import { t,dateLocale } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import SocialReport from './SocialReport.jsx'

export default function PostEngagement({post,scope,visible,onUnavailable}) {
  const nav=useNavigate(),user=useStore(s=>s.user),enabled=useStore(s=>s.config?.social?.interactions===true)
  const [counts,setCounts]=useState(post.engagement||{likes:0,liked:false,comments:0}),[comments,setComments]=useState([]),[cursor,setCursor]=useState(null)
  const [open,setOpen]=useState(false),[text,setText]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[burst,setBurst]=useState(0),[confirm,setConfirm]=useState(null)
  const live=useRef(true),sequence=useRef(0),loaded=useRef(false),request=useRef(null),input=useRef(null),pending=useRef(false)
  const valid=()=>live.current&&socialScope(useStore.getState().user)===scope
  useEffect(()=>{live.current=true;return()=>{live.current=false;sequence.current++}},[])
  useEffect(()=>{setCounts(post.engagement||{likes:0,liked:false,comments:0});loaded.current=false},[post.engagement])
  const accept=out=>{if(out.viewerId!==useStore.getState().user?.id){onUnavailable();return false}return valid()}
  const failed=e=>{
    if(!valid())return
    if(e.status===404||e.status===401){onUnavailable();return}
    setError(e.data?.code==='profile-required'?t('Create a social profile to like or comment.'):t('Could not save. Please try again.'))
  }
  const load=async next=>{
    if(pending.current)return
    const n=++sequence.current;setLoading(true);setError('');pending.current=true
    try{const out=await readComments(post.id,next);if(!valid()||n!==sequence.current||!accept(out))return
      setComments(old=>next?[...new Map([...old,...out.comments].map(c=>[c.id,c])).values()].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)):out.comments)
      setCounts(out.engagement);setCursor(out.nextCursor);loaded.current=true
    }catch(e){failed(e)}finally{pending.current=false;if(valid()&&n===sequence.current)setLoading(false)}
  }
  useEffect(()=>{if(enabled&&visible&&!loaded.current&&post.engagement?.comments>0)load()},[enabled,visible,post.engagement?.comments])
  const like=async()=>{
    if(pending.current||!valid())return
    pending.current=true;setBusy(true);setError('');const before=counts,liked=!counts.liked
    setCounts({...counts,liked,likes:Math.max(0,counts.likes+(liked?1:-1))});if(liked)setBurst(n=>n+1)
    try{const out=await likePost(post.id,liked);if(valid()&&accept(out))setCounts(out.engagement)}catch(e){if(valid())setCounts(before);failed(e)}finally{pending.current=false;if(valid())setBusy(false)}
  }
  const submit=async ev=>{
    ev.preventDefault();if(pending.current||!valid()||!text.trim())return
    pending.current=true;setBusy(true);setError('')
    request.current ||= {id:postRequestId(),text:text.trim()}
    try{const out=await putComment(post.id,request.current.id,request.current.text);if(!valid()||!accept(out))return
      setComments(old=>[...new Map([...old,out.comment].map(c=>[c.id,c])).values()].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)))
      setCounts(out.engagement);setText('');request.current=null;loaded.current=true
    }catch(e){failed(e)}finally{pending.current=false;if(valid())setBusy(false)}
  }
  const remove=async id=>{
    if(pending.current||!valid())return;pending.current=true;setBusy(true);setError('')
    try{const out=await deleteComment(post.id,id);if(valid()&&accept(out)){setComments(old=>old.filter(c=>c.id!==id));setCounts(out.engagement);setConfirm(null)}}catch(e){failed(e)}finally{pending.current=false;if(valid())setBusy(false)}
  }
  if(!enabled)return null
  return <div className="post-discussion">
    <div className="post-reactions">
      <button type="button" className={'post-reaction'+(counts.liked?' liked':'')} aria-label={counts.liked?t('Unlike'):t('Like')} aria-pressed={counts.liked} disabled={busy||loading} onClick={like}><span key={burst} className={counts.liked&&burst?'like-burst':''}><Icon name="heart" /></span><span>{counts.likes||0}</span></button>
      <button type="button" className="post-reaction" aria-label={t('Comment')} disabled={busy} onClick={()=>{setOpen(true);if(!loaded.current)load();setTimeout(()=>input.current?.focus(),0)}}><Icon name="message" /><span>{counts.comments||0}</span></button>
    </div>
    {error&&<p className="small" role="alert">{error}</p>}
    <div className="post-comments">{comments.map(c=><div className="post-comment" key={c.id}>
      <div><button className="comment-author" onClick={()=>nav('/social/profiles/'+c.author.id)}>{c.author.displayName}</button><time className="small dim" dateTime={new Date(c.createdAt).toISOString()}>{new Date(c.createdAt).toLocaleDateString(dateLocale(),{month:'short',day:'numeric'})}</time><p>{c.text}</p></div>
      <details className="comment-menu"><summary aria-label={t('More')}>⋯</summary><SocialReport type="comment" id={c.id} ownerId={c.author.id} />{(c.author.id===user?.id||post.authorId===user?.id)&&<button disabled={busy} onClick={()=>setConfirm(c.id)}>{t('Delete comment')}</button>}</details>
      {confirm===c.id&&<div className="comment-confirm" role="alert"><span>{t('Delete comment?')}</span><button disabled={busy} onClick={()=>remove(c.id)}>{t('Delete')}</button><button onClick={()=>setConfirm(null)}>{t('Cancel')}</button></div>}
    </div>)}</div>
    {loading&&<span className="small dim" role="status">{t('Loading…')}</span>}
    {cursor&&comments.length<100&&<button className="post-more" disabled={busy||loading} onClick={()=>load(cursor)}>{t('Load more comments')}</button>}
    {open&&<form className="comment-compose" onSubmit={submit}><label className="sr-only" htmlFor={'comment-'+post.id}>{t('Comment')}</label><textarea id={'comment-'+post.id} ref={input} maxLength={1000} rows={1} value={text} placeholder={t('Write a comment…')} disabled={busy} onChange={e=>{setText(e.target.value);request.current=null}} /><button type="submit" aria-label={t('Send comment')} disabled={busy||loading||!text.trim()}><Icon name="send" /></button></form>}
  </div>
}
