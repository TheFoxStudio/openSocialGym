// Derive legacy volume using only the published sets.
export function socialVolume(snapshot, preferredUnit='kg') {
  if(Number.isFinite(snapshot.totalVolume)&&snapshot.volumeUnit)return {value:snapshot.totalVolume,unit:snapshot.volumeUnit}
  let value=0
  for(const exercise of snapshot.exercises||[])for(const set of exercise.sets||[]){
    if(set.mode!=='reps')continue
    let total=(set.weight||0)*(set.reps||0)
    for(const drop of set.drops||[])total+=(drop.weight||0)*(drop.reps||0)
    value+=total*(exercise.unit===preferredUnit?1:exercise.unit==='lb'?0.45359237:1/0.45359237)
  }
  return {value,unit:preferredUnit}
}
