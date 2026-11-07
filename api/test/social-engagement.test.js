import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createSocialStore} from '../social/store.js';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gym-comments-'));
 let store=createSocialStore({dataDir:dir,accountExists:()=>true});
 for(const id of ['one','two','three'])store.save(id,{handle:'lifter_'+id,displayName:id,bio:'',accepted:true});
 const snapshot={version:1,title:'Workout',date:'2026-11-06',durationSec:60,exercises:[{name:'Squat',unit:'kg',sets:[{mode:'reps',type:'straight',weight:20,reps:5}]}]};
 const post=store.publishPost('one',{requestId:crypto.randomUUID(),profileEpoch:store.get('one').socialEpoch,sourceWorkoutId:'workout',caption:'',audience:'followers',assetId:null,snapshot});
 t.after(()=>{store?.close();fs.rmSync(dir,{recursive:true,force:true})});
 return {get s(){return store},post,dir,reopenAsFour(){store.close();store=null;const db=new DatabaseSync(path.join(dir,'social/social.sqlite'));db.exec('DROP TABLE post_likes; DROP TABLE post_comments; PRAGMA user_version=4;');db.close();store=createSocialStore({dataDir:dir,accountExists:()=>true})}};
}
test('likes/comments recheck audience and blocks, retry idempotently, and cannot resurrect removed comments',t=>{
 const h=fixture(t),s=h.s,id=h.post.id,cid=crypto.randomUUID();
 assert.throws(()=>s.likePost('two',id,true),{status:404});s.follow('two','one',true);
 assert.equal(s.likePost('two',id,true).engagement.likes,1);assert.equal(s.likePost('two',id,true).engagement.likes,1);
 const first=s.putComment('two',id,cid,{text:'Nice workout'});assert.deepEqual(s.putComment('two',id,cid,{text:'Nice workout'}),first);
 assert.throws(()=>s.putComment('two',id,cid,{text:'Changed'}),{status:409});assert.throws(()=>s.putComment('two',id,crypto.randomUUID(),{text:' '}),{status:400});
 s.follow('three','one',true);assert.throws(()=>s.deleteComment('three',id,cid),{status:404});
 s.block('two','three',true);assert.equal(s.comments('three',id).comments.length,0);assert.equal(s.comments('one',id).comments.length,1);
 assert.equal(s.exportSocial('two','comments').items[0].text,'Nice workout');assert.equal(s.exportSocial('one','comments').items.length,0);
 assert.equal(s.exportSocial('two','likes').items[0].id,id);
 s.deleteComment('one',id,cid);assert.equal(s.comments('one',id).comments.length,0);assert.throws(()=>s.putComment('two',id,cid,{text:'Nice workout'}),{status:410});
 s.follow('two','one',false);assert.throws(()=>s.comments('two',id),{status:404});assert.throws(()=>s.likePost('two',id,false),{status:404});
 s.remove('two');assert.equal(s.getPost('one',id).engagement.likes,0);
});
test('comment cursors are scoped and reported comments can be removed without exposing private training',t=>{
 const h=fixture(t),s=h.s,id=h.post.id;s.follow('two','one',true);
 const comments=Array.from({length:3},(_,i)=>s.putComment('two',id,crypto.randomUUID(),{text:'Comment '+i}).comment);
 const first=s.comments('one',id,{limit:1});assert.ok(first.nextCursor);assert.throws(()=>s.comments('two',id,{cursor:first.nextCursor}),{code:'cursor-invalid'});
 const rest=s.comments('one',id,{cursor:first.nextCursor});assert.equal(rest.comments.length,2);
 const {report}=s.report('one',{requestId:crypto.randomUUID(),targetType:'comment',targetId:comments[0].id,reason:'harassment',details:''});
 assert.equal(s.reviewReport(report.id).target.text,'Comment 0');s.resolveReport(report.id,'remove');assert.equal(s.reviewReport(report.id).target,null);
 assert.throws(()=>s.putComment('two',id,comments[0].id,{text:'Comment 0'}),{status:410});
 assert.equal(s.getPost('one',id).engagement.comments,2);assert.equal(s.getPost('one',id).sourceWorkoutId,'workout');assert.equal(s.getPost('two',id).sourceWorkoutId,undefined);
});
test('schema-four migration preserves posts and graph while enabling interactions',t=>{
 const h=fixture(t);h.s.follow('two','one',true);h.reopenAsFour();assert.equal(h.s.feed('two').posts[0].id,h.post.id);assert.equal(h.s.likePost('two',h.post.id,true).engagement.likes,1);
});

test('profile totals and four recent photos include only workouts visible to this viewer',t=>{
 const h=fixture(t),s=h.s;
 for(let i=0;i<5;i++){
   const assetId=crypto.randomUUID();s.putPostAsset('one',assetId,Buffer.from('photo'),'digest-'+i);
   s.publishPost('one',{requestId:crypto.randomUUID(),profileEpoch:s.get('one').socialEpoch,sourceWorkoutId:'photo-'+i,caption:'',audience:'members',assetId,
     snapshot:{...h.post.snapshot,totalVolume:100,volumeUnit:i===0?'lb':'kg'}});
 }
 const publicView=s.profileOverview('two','one');assert.equal(publicView.totalWorkouts,5);assert.ok(Math.abs(publicView.totalVolumeKg-445.359237)<0.001);
 assert.equal(publicView.photos.length,4);assert.ok(publicView.photos.every(p=>p.assetId&&!('sourceWorkoutId' in p)));
 s.follow('two','one',true);assert.equal(s.profileOverview('two','one').totalWorkouts,6);
 assert.ok(Math.abs(s.profileOverview('two','one').totalVolumeKg-545.359237)<0.001);
 s.block('one','two',true);assert.throws(()=>s.profileOverview('two','one'),{status:404});
});
