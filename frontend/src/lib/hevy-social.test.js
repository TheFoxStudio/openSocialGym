import {it,expect,vi} from 'vitest'
import {prepareHevySocialDrafts} from './hevy-social.js'
const workout={id:'imported',d:'2026-11-06',name:'Workout',start:1000,end:61000,hevyDescription:'Original Hevy description',entries:[{id:'custom',n:'Squat',sets:[{done:true,w:20,r:5}]}]}
it('prepares unconfirmed, private local drafts with captions, skips existing drafts and refuses account changes',async()=>{
 const save=vi.fn(async()=>{}),read=vi.fn(async()=>null),options={scope:'one',currentScope:()=> 'one',save,read}
 const state={workouts:[workout],unit:'kg'}
 expect((await prepareHevySocialDrafts([workout],state,options)).created).toBe(1)
 const draft=save.mock.calls[0][0];expect(draft).toMatchObject({caption:'Original Hevy description',confirmed:false,status:'draft',audience:'followers',photo:null})
 expect(draft.snapshot.exercises[0].name).toBe('Squat');expect(draft.snapshot).not.toHaveProperty('hevyDescription')
 read.mockResolvedValue(draft);expect((await prepareHevySocialDrafts([workout],state,options)).skipped).toBe(1);expect(save).toHaveBeenCalledTimes(1)
 await expect(prepareHevySocialDrafts([workout],state,{...options,currentScope:()=> 'two'})).rejects.toThrow('draft-context-changed')
})
