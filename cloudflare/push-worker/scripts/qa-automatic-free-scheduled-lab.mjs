// Cron policy experiment only. No registered scheduled handler or network.
// Fresh publication and delivery must never share one invocation. A later
// tick can recover only the latest, still valid, never-claimed outbox.
import {FREE_PREPARATION_LIMITS,FREE_TRANSPORT_LIMITS} from './qa-automatic-free-meter-lab.mjs';
const projectId='atrio-catolico-qa-general';
const key=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const time=x=>Number.isSafeInteger(x)&&x>0;
const stop=reason=>({status:'ignored',reason});
const sum=(...stages)=>stages.reduce((n,s)=>n+s.requests,0);
const {discovery,recovery,publication}=FREE_PREPARATION_LIMITS;
const {claim,worker,finish}=FREE_TRANSPORT_LIMITS;
// Two extra HTTP slots for credential acquisition outside the stage meters.
// A future adapter must enforce these slots, not merely rely on arithmetic.
export const FREE_SCHEDULED_ENVELOPE=Object.freeze({
 externalLimit:50,credentialAllowance:2,
 publish:sum(discovery,recovery,publication)+2,
 recoverAndTransport:sum(discovery,recovery,claim,worker,finish)+2,
 prohibitedCombined:sum(discovery,recovery,publication,claim,worker,finish)+2
});
export function createFreeScheduledTickLab({enabled=false,activatedAt,discover,recover,publish,transport}={}){
 if([discover,recover,publish,transport].some(x=>typeof x!=='function'))throw Error('missing_lab_dependency');
 return async function tick(){
  if(enabled!==true||!time(activatedAt))return stop('automation_disabled');
  if(FREE_SCHEDULED_ENVELOPE.publish>50||FREE_SCHEDULED_ENVELOPE.recoverAndTransport>50)
   return stop('invocation_capacity');
  try{
   const candidate=await discover({enabled:true,projectId,activatedAt});
   if(candidate?.status!=='candidate')return candidate;
   const existing=await recover({enabled:true,candidate,activatedAt});
   if(existing?.status==='absent_lab'){
    const result=await publish({enabled:true,candidate});
    // A confirmed publication is durable; don't send on this tick.
    // Unknown commits are not retried here, and recovery rechecks the state.
    return result?.status==='published_lab'&&key(result.eventKey)
     ?{status:'published_waiting_next_tick_lab',eventKey:result.eventKey}:result;
   }
   if(existing?.status!=='published_lab'||!key(existing.eventKey))return existing;
   return await transport(existing);
  }catch{return stop('scheduled_tick_unavailable')}
 };
}
