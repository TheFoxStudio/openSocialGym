import { buildSocialSnapshot,socialWorkoutId } from './social-snapshot.js'
import { readDraft,saveDraft,postRequestId } from './social-drafts.js'
import { exOr } from './exercises.js'
import { exerciseNameText } from './format.js'

// Hevy exports have no social visibility or media; prepare unconfirmed drafts only.
export async function prepareHevySocialDrafts(workouts,state,{scope,profileEpoch=null,currentScope,read=readDraft,save=saveDraft}) {
  let created=0,skipped=0,failed=0
  const valid=()=>currentScope()===scope
  for(const candidate of workouts){
    if(!valid())throw Error('draft-context-changed')
    const workout=state.workouts?.find(w=>w.id===candidate.id||(w.d===candidate.d&&w.start===candidate.start&&w.name===candidate.name))
    if(!workout){skipped++;continue}
    const sourceWorkoutId=socialWorkoutId(workout)
    try{
      if(await read(scope,sourceWorkoutId)){skipped++;continue}
      const snapshot=buildSocialSnapshot(workout,state,e=>e.n||e.name||exerciseNameText(exOr(e.id)))
      if(!valid())throw Error('draft-context-changed')
      await save({scope,sourceWorkoutId,profileEpoch,snapshot,caption:candidate.hevyDescription||'',audience:'followers',photo:null,assetId:null,postId:null,requestId:postRequestId(),confirmed:false,status:'draft'})
      created++
    }catch(e){if(!valid()||e.message==='draft-context-changed')throw e;failed++}
  }
  return {created,skipped,failed}
}
