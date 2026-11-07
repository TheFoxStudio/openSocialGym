import {useNavigate} from 'react-router-dom'
import {useStore} from '../store/useStore.js'
import {isOn} from '../lib/modules.js'
import BodyWeightHomeCard from './BodyWeightHomeCard.jsx'
import RecoveryHint from './RecoveryHint.jsx'
import {RecapHomeCard} from './Recap.jsx'
import {WeeklySetsHomeLine} from './WeeklySets.jsx'
import {ChallengesCard} from './Challenges.jsx'

export default function HomeInfo(){
 const S=useStore(s=>s.S),nav=useNavigate()
 return <>
  {S.showWeightCard===true&&isOn(S,'body')&&<BodyWeightHomeCard S={S}/>}
  {S.recoveryHint===true&&isOn(S,'health')&&<RecoveryHint S={S}/>}
  {S.recap===true&&isOn(S,'motivation')&&<RecapHomeCard S={S}/>}
  {S.homeMuscleSets===true&&<div className="card wsets-solo"><WeeklySetsHomeLine S={S} onOpen={()=>nav('/stats?section=lifts')}/></div>}
  {S.monthlyChallenges===true&&isOn(S,'motivation')&&<ChallengesCard S={S}/>}
 </>
}
