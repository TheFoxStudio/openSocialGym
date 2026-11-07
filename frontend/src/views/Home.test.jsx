// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,expect,it,vi} from 'vitest'
import Home from './Home.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const h=vi.hoisted(()=>({nav:vi.fn(),S:{workouts:[]}})),nav=h.nav
vi.mock('../store/useStore.js',()=>({useStore:f=>f({user:{id:'one'},S:h.S})}))
vi.mock('react-router-dom',()=>({useNavigate:()=>nav}))
vi.mock('../components/SyncBanner.jsx',()=>({useConnectionTrouble:()=>false}))
vi.mock('../components/Icon.jsx',()=>({default:()=>null}))
vi.mock('./Feed.jsx',()=>({default:({embedded})=><section data-feed={embedded?'embedded':'full'} />}))
vi.mock('../components/BodyWeightHomeCard.jsx',()=>({default:()=> <div data-home-info="weight"/>}))
vi.mock('../components/RecoveryHint.jsx',()=>({default:()=> <div data-home-info="recovery"/>}))
vi.mock('../components/Recap.jsx',()=>({RecapHomeCard:()=> <div data-home-info="recap"/>}))
vi.mock('../components/WeeklySets.jsx',()=>({WeeklySetsHomeLine:()=> <div data-home-info="sets"/>}))
vi.mock('../components/Challenges.jsx',()=>({ChallengesCard:()=> <div data-home-info="challenges"/>}))
let root,host
afterEach(()=>{act(()=>root?.unmount());host?.remove()})
it('keeps Home feed-only and puts friend discovery beside profile and settings',async()=>{
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 await act(async()=>root.render(<Home />))
 expect(host.querySelector('.home-summary')).toBeNull();expect(host.querySelector('[data-feed="embedded"]')).not.toBeNull()
 expect([...host.querySelectorAll('header button')].map(b=>b.getAttribute('aria-label'))).toEqual(['Find friends','Social profile','Settings'])
 await act(async()=>host.querySelector('[aria-label="Find friends"]').click());expect(nav).toHaveBeenCalledWith('/social/people')
})

it('shows only enabled Home information before the feed, respecting module switches',async()=>{
 host=document.createElement('div');document.body.append(host);root=createRoot(host);h.S={};
 await act(async()=>root.render(<Home/>));expect(host.querySelectorAll('[data-home-info]')).toHaveLength(0);
 const choices={showWeightCard:'weight',recoveryHint:'recovery',recap:'recap',homeMuscleSets:'sets',monthlyChallenges:'challenges'};
 for(const [key,name]of Object.entries(choices)){
  h.S={[key]:true};await act(async()=>root.render(<Home/>));expect([...host.querySelectorAll('[data-home-info]')].map(e=>e.dataset.homeInfo)).toEqual([name]);
  expect(host.querySelector('[data-home-info]').compareDocumentPosition(host.querySelector('[data-feed]'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 }
 h.S={showWeightCard:true,recoveryHint:true,recap:true,monthlyChallenges:true,modules:{body:false,health:false,motivation:false}};
 await act(async()=>root.render(<Home/>));expect(host.querySelectorAll('[data-home-info]')).toHaveLength(0);
});
