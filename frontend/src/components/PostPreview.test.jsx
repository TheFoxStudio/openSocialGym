// @vitest-environment happy-dom
import React,{act} from 'react'
import{createRoot}from'react-dom/client'
import{expect,it,vi}from'vitest'
import PostPreview from './PostPreview.jsx'
vi.mock('./Media.jsx',()=>({Thumb:()=> <span data-exercise-thumbnail/>}))
globalThis.IS_REACT_ACT_ENVIRONMENT=true
it('preserves zero values, timed/cardio units and intensifiers in structured set tables',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{await act(async()=>root.render(<PostPreview snapshot={{title:'Session',date:'2025-02-03',durationSec:3600,exercises:[
  {name:'Press',catalogId:'0025',unit:'kg',sets:[{mode:'reps',weight:0,reps:0,drops:[{weight:20,reps:6}],clusters:[{reps:3}]}]},
  {name:'Hold',unit:'kg',sets:[{mode:'time',seconds:45}]},
  {name:'Run',unit:'kg',sets:[{mode:'cardio',minutes:20,speedKmh:10,incline:2}]}
 ]}}/>));
 expect(host.querySelectorAll('[data-exercise-thumbnail]')).toHaveLength(1)
 expect(host.querySelectorAll('.post-exercise-icon [data-icon=dumbbell]')).toHaveLength(2)
 const rows=host.querySelectorAll('.post-sets');expect(rows[0].textContent).toContain('Weight (kg)');expect([...rows[0].querySelectorAll('tbody tr:first-child td')].map(c=>c.textContent)).toEqual(['0','0'])
 expect(rows[0].textContent).toContain('20 kg × 6');expect(rows[0].textContent).toContain('3 reps')
 expect(rows[1].textContent).toContain('45 s');expect(rows[2].textContent).toContain('20 min');expect(rows[2].textContent).toContain('Speed (km/h)');expect(rows[2].textContent).toContain('Incline (%)')
 }finally{await act(async()=>root.unmount());host.remove()}
})
