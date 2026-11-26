// One-shot read-only identity probe, separate from the automatic delivery epoch.
// No public diagnostic route, no FCM, no automatic outbox or activation mutation.
import {probeQaIdentityLab} from './qa-automatic-d1-identity-probe-lab.mjs';
const clock="CAST(unixepoch('subsec')*1000 AS INTEGER)";
export const D1_PROBE_SCHEDULE_SCHEMA=`CREATE TABLE IF NOT EXISTS qa_auto_identity_probe_lab (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 starts_at INTEGER NOT NULL CHECK(starts_at>0 AND starts_at%60000=0),
 ends_at INTEGER NOT NULL CHECK(ends_at>starts_at AND ends_at<=starts_at+600000),
 consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
);`;
const stopped=reason=>({status:'blocked',reason,externalAttempts:0,fcmAttempts:0,firestoreWrites:0,activationAuthorized:false});
const fresh=(at,now)=>Number.isSafeInteger(at)&&at>0&&at%60000===0&&at<=now&&now-at<=15000;
export function createQaProbeScheduledLab({fetchImpl,report=()=>{}}={}){
 if(typeof fetchImpl!=='function'||typeof report!=='function')throw Error('missing_probe_dependency');
 return async function scheduled(controller,env){
  let result=stopped('probe_disabled');
  try{
   const at=controller?.scheduledTime,raw=env?.QA_IDENTITY_PROBE_START;
   const start=typeof raw==='string'&&/^[1-9]\d{0,15}$/.test(raw)?Number(raw):null;
   if(env?.QA_IDENTITY_PROBE_ENABLED==='true'&&env.QA_AUTO_SCHEDULE_ENABLED!=='true'&&env.QA_AUTO_MODE!=='automatic'&&
    Number.isSafeInteger(start)&&start>0&&start%60000===0&&typeof env.QA_PUSH_DB?.prepare==='function'){
    if(controller?.cron!=='* * * * *'||!fresh(at,Date.now())||at<start)result=stopped('probe_schedule_invalid');
    else{
     // Consume exactly once before network; never refund after a crash.
     const reserved=await env.QA_PUSH_DB.prepare("UPDATE qa_auto_identity_probe_lab SET consumed=1 WHERE singleton=1 AND starts_at=? AND consumed=0 AND ?>=starts_at AND ? BETWEEN "+clock+"-15000 AND "+clock+" AND ends_at>="+clock+"+120000")
      .bind(start,at,at).run();
     if(reserved?.success!==true||reserved.meta?.changes!==1)result=stopped('probe_reservation_unavailable');
     else if(!fresh(at,Date.now()))result=stopped('probe_schedule_expired');
     else{
      const cutoff=Date.now()+45000;
      result=await probeQaIdentityLab({enabled:true,env,fetchImpl:(url,init)=>{
       if(Date.now()>=cutoff)throw Error('probe_deadline');
       return fetchImpl(url,init);
      }});
     }
    }
   }
  }catch{result={status:'failed',reason:'probe_unavailable',externalAttempts:null,fcmAttempts:0,firestoreWrites:0,activationAuthorized:false}}
  try{report(result)}catch{/* never retry a consumed probe */}
  return result;
 };
}
