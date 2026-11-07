import {useEffect,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {useStore} from '../store/useStore.js'
import {postPhotoBlob,socialScope} from '../lib/social-api.js'
import {t} from '../lib/i18n.js'
function Photo({post,scope}) {
  const nav=useNavigate(),[url,setUrl]=useState(null)
  useEffect(()=>{let gone=false,objectUrl
    if(navigator.onLine!==false)postPhotoBlob(post.id,post.assetId).then(blob=>{if(!gone&&socialScope(useStore.getState().user)===scope){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)}}).catch(()=>{})
    const offline=()=>{gone=true;setUrl(null);if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null}}
    window.addEventListener('offline',offline)
    return()=>{gone=true;window.removeEventListener('offline',offline);if(objectUrl)URL.revokeObjectURL(objectUrl)}
  },[post.id,post.assetId,post.revision,scope])
  return <button onClick={()=>nav('/social/posts/'+post.id)} aria-label={post.snapshot.title||t('Workout photo')}>{url?<img src={url} alt=""/>:<span aria-hidden="true">◇</span>}</button>
}
export default function ProfilePhotos({posts,scope}) {
  if(!posts.length)return null
  return <div className="profile-photo-strip" aria-label={t('Recent workout photos')}>{posts.slice(0,4).map(post=><Photo key={post.id+':'+post.assetId+':'+post.revision} post={post} scope={scope}/>)}</div>
}
