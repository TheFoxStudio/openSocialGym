// Private, per-account tag bindings. Never rewrite the gym's tag or open its URL.
export async function tagIdentity(raw) {
 const uid=String(raw?.serialNumber||'').replace(/[:-]/g,'').toLowerCase()
 const urls=[...new Set((raw?.urls||[]).filter(u=>typeof u==='string'&&u.length<=2048))].slice(0,8)
 if((!uid||!/^[a-f0-9]{4,64}$/.test(uid))&&!urls.length)throw Object.assign(Error('No readable tag identity'),{code:'unsupported'})
 const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('')
 const uidHash=/^[a-f0-9]{4,64}$/.test(uid)?await digest('uid:'+uid):null,payloadHash=urls.length?await digest('urls:'+JSON.stringify(urls)):null
 return {key:uidHash||payloadHash,uidHash,payloadHash}
}
export function assignedExercise(S,tag) {
 const entries=Object.values(S.nfcAssignments||{}).filter(v=>v?.exerciseId)
 if(tag.uidHash){const exact=entries.find(v=>v.uidHash===tag.uidHash);if(exact)return exact.exerciseId}
 if(!tag.payloadHash)return null
 // Never guess between machines whose tags contain the same generic app link.
 const matches=entries.filter(v=>v.payloadHash===tag.payloadHash&&(!tag.uidHash||!v.uidHash))
 const ids=[...new Set(matches.map(v=>v.exerciseId))]
 return ids.length===1?ids[0]:null
}
export function bindExerciseTag(S,tag,exerciseId){
 const map=S.nfcAssignments||{},existing=map[tag.key]
 const time=Date.now(),next={...map}
 const same=Object.entries(map).filter(([,v])=>v?.exerciseId&&tag.payloadHash&&v.payloadHash===tag.payloadHash)
 if(!tag.uidHash){
  const physical=same.filter(([,v])=>v.uidHash)
  if(physical.length>1)throw Object.assign(Error('Tags share the same link'),{code:'ambiguous'})
  for(const [key,value]of physical)next[key]={...value,exerciseId,_ts:time}
  if(physical.length){
   if(next[tag.key]&&!next[tag.key].uidHash)next[tag.key]={...next[tag.key],exerciseId:null,_ts:time}
   S.nfcAssignments=next;return
  }
 }else{
  for(const [key,value]of same)if(!value.uidHash)next[key]={...value,exerciseId:null,_ts:time}
 }
 if(!existing?.exerciseId&&Object.values(map).filter(v=>v?.exerciseId).length>=256)throw Error('tag-limit')
 next[tag.key]={uidHash:tag.uidHash,payloadHash:tag.payloadHash,exerciseId,_ts:time}
 S.nfcAssignments=next
}
export function removeExerciseTag(S,key){
 const entry=S.nfcAssignments?.[key];if(entry)S.nfcAssignments={...S.nfcAssignments,[key]:{...entry,exerciseId:null,_ts:Date.now()}}
}
