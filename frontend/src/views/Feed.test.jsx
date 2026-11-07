// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import Feed from './Feed.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const h=vi.hoisted(()=>({state:{},feed:vi.fn(),check:vi.fn(),change:null}))
vi.mock('../store/useStore.js',()=>{const useStore=f=>f(h.state);useStore.getState=()=>h.state;return{useStore}})
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}))
vi.mock('../lib/i18n.js',()=>({t:k=>k}))
vi.mock('../lib/social-api.js',()=>({socialScope:u=>u?.id,socialFeedAvailable:(u,c)=>!!u&&c?.social?.feed,readFeed:(...a)=>h.feed(...a),checkFeed:(...a)=>h.check(...a)}))
vi.mock('../lib/social-events.js',()=>({onSocialChange:fn=>{h.change=fn;return()=>{}}}))
vi.mock('../components/SocialPostCard.jsx',()=>({default:({post})=><article>{post.caption}</article>}))
vi.mock('../components/ui.jsx',()=>({Button:({variant,size,...p})=><button {...p}/>}))
let host,root
beforeEach(()=>{vi.clearAllMocks();h.state={user:{id:'one'},config:{social:{feed:true}}};Object.defineProperty(navigator,'onLine',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});h.feed.mockResolvedValue({viewerId:'one',posts:[{id:'a',caption:'First'}],nextCursor:'next'});h.check.mockResolvedValue({viewerId:'one',posts:[]});host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers()})
const render=()=>act(async()=>root.render(<Feed embedded/>))
const touch=(name,x,y)=>{const event=new Event(name,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:name==='touchend'?[]:[{clientX:x,clientY:y}]});host.querySelector('section').dispatchEvent(event)}
it('does not reload on a timer/focus; refreshes only after a downward pull from the top',async()=>{
 vi.useFakeTimers();await render();expect(host.querySelector('h1,h2')).toBeNull();expect(host.textContent).not.toContain('Find friends')
 await act(async()=>{vi.advanceTimersByTime(90000);window.dispatchEvent(new Event('focus'))});expect(h.feed).toHaveBeenCalledTimes(1)
 await act(async()=>{touch('touchstart',100,100);touch('touchmove',250,110);touch('touchend',250,110)});expect(h.feed).toHaveBeenCalledTimes(1)
 await act(async()=>{touch('touchstart',100,100);touch('touchmove',100,260);touch('touchend',100,260)});expect(h.feed).toHaveBeenCalledTimes(2)
})
it('checks access before adding pages and drops content offline or on identity mismatch',async()=>{
 await render();h.check.mockResolvedValue({viewerId:'one',posts:[{id:'a',caption:'Updated'}]});h.feed.mockResolvedValue({viewerId:'one',posts:[{id:'a',caption:'Updated'},{id:'b',caption:'Next'}],nextCursor:null})
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Load more').click());expect(host.querySelectorAll('article')).toHaveLength(2);expect(h.check).toHaveBeenCalledWith(['a'])
 await act(async()=>window.dispatchEvent(new Event('offline')));expect(host.querySelector('article')).toBeNull()
 h.feed.mockResolvedValue({viewerId:'two',posts:[{id:'x',caption:'Other account'}],nextCursor:null});await act(async()=>{touch('touchstart',100,100);touch('touchmove',100,260);touch('touchend',100,260)});expect(host.textContent).not.toContain('Other account')
})
