// Cron policy experiment only. No registered scheduled handler or network.
// Fresh publication and delivery must never share one invocation. A later
// tick can recover only the latest, still valid, never-claimed outbox.
import {createFreeInvocationMeter,FREE_PREPARATION_LIMITS,FREE_TRANSPORT_LIMITS} from './qa-automatic-free-meter-lab.mjs';
import {createFreeRestDiscoveryLab} from './qa-automatic-free-rest-lab.mjs';
import {createFreeRecoveryLab} from './qa-automatic-free-recovery-lab.mjs';
import {createFreePublicationLab} from './qa-automatic-free-publication-lab.mjs';
import {createFreeSnapshotLab} from './qa-automatic-free-snapshot-lab.mjs';
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

// Internal composition for emulator tests. One scheduled meter is shared by
// preparation, dispatch and finish; no public route or default credentials.
// The injected dispatcher MUST use the supplied meter for every operation.
export function createMeteredScheduledTickLab({enabled=false,activatedAt,budget,transport,lookupAccounts,dispatch}={}){
 if([transport,lookupAccounts,dispatch,budget?.reserveDiscovery,budget?.reserveRecovery,
  budget?.reservePublication,budget?.reserveTransport].some(x=>typeof x!=='function'))
   throw Error('missing_lab_dependency');
 return async function tick(){
  const meter=createFreeInvocationMeter({mode:'scheduled'});
  const measured=stage=>async req=>{
   meter.beforeHttp(stage,req.url,req);
   return transport(req);
  };
  const pubTransport=measured('publication');
  const readSnapshot=createFreeSnapshotLab({transport:pubTransport,lookupAccounts:async uids=>{
   // Logical emulator Auth requests, not a measurement of SDK retry traffic.
   meter.charge('publication',{requests:uids.length});
   return lookupAccounts(uids);
  }});
  const run=createFreeScheduledTickLab({enabled,activatedAt,
   discover:createFreeRestDiscoveryLab({transport:measured('discovery'),reserveDiscovery:budget.reserveDiscovery}),
   recover:createFreeRecoveryLab({transport:measured('recovery'),reserveRecovery:budget.reserveRecovery}),
   publish:createFreePublicationLab({transport:pubTransport,readSnapshot,reserveBudget:budget.reservePublication}),
   transport:async publication=>{
    try{if(await budget.reserveTransport()!==true)return stop('transport_budget_unavailable')}
    catch{return stop('transport_budget_unavailable')}
    return dispatch(publication.eventKey,meter);
   }});
  return {result:await run(),usage:meter.snapshot()};
 };
}
