import{describe,it,expect}from'vitest'
import{tagIdentity,assignedExercise,bindExerciseTag,removeExerciseTag}from'./nfc-assignments.js'
import{mergeStates}from'./sync-merge.js'
describe('existing machine NFC bindings',()=>{
 it('uses stable private identities, supports UID-free reads and refuses ambiguous shared links',async()=>{
  const a=await tagIdentity({serialNumber:'01:02:03:04',urls:['gymapp://machine/42']}),b=await tagIdentity({serialNumber:'05060708',urls:['gymapp://machine/42']}),ios=await tagIdentity({urls:['gymapp://machine/42']});
  expect(a).toEqual(await tagIdentity({serialNumber:'01-02-03-04',urls:['gymapp://machine/42']}));expect(JSON.stringify(a)).not.toContain('gymapp:');
  const S={};bindExerciseTag(S,a,'0025');expect(assignedExercise(S,ios)).toBe('0025');bindExerciseTag(S,b,'0032');
  expect(assignedExercise(S,a)).toBe('0025');expect(assignedExercise(S,b)).toBe('0032');expect(assignedExercise(S,ios)).toBeNull();
  expect(()=>bindExerciseTag(S,ios,'0001')).toThrow('Tags share the same link');
  await expect(tagIdentity({})).rejects.toMatchObject({code:'unsupported'});
 });
 it('reassigns and removes bindings without stale sync resurrecting them',async()=>{
  const tag=await tagIdentity({serialNumber:'01020304',urls:['https://gym.example/machine/42']}),S={};bindExerciseTag(S,tag,'0025');
  const old=structuredClone(S);old.nfcAssignments[tag.key]._ts=1;
  bindExerciseTag(S,tag,'0032');expect(assignedExercise(S,tag)).toBe('0032');removeExerciseTag(S,tag.key);
  const merged=mergeStates(S,old);expect(assignedExercise(merged,tag)).toBeNull();
 });
})
