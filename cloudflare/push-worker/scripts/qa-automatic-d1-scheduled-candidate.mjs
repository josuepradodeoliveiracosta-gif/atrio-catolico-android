// Private scheduled candidate: not wired into the official deployment.
// No public HTTP trigger, no default network or remote migration.
export const QA_AUTO_CRON='* * * * *';
const clock="CAST(unixepoch('subsec')*1000 AS INTEGER)";
export const D1_SCHEDULE_SCHEMA=`CREATE TABLE IF NOT EXISTS qa_auto_d1_schedule_lab (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 activated_at INTEGER NOT NULL CHECK(activated_at>0),
 last_scheduled_at INTEGER NOT NULL DEFAULT 0 CHECK(last_scheduled_at>=0 AND last_scheduled_at%60000=0)
);`;
const positive=x=>Number.isSafeInteger(x)&&x>0;
const stop=reason=>({status:'ignored',reason,externalAttempts:0,fcmAttempted:false});
const epoch=env=>typeof env?.QA_AUTO_ACTIVATED_AT==='string'&&/^[1-9]\d{0,15}$/.test(env.QA_AUTO_ACTIVATED_AT)?Number(env.QA_AUTO_ACTIVATED_AT):null;
function ready(env){
 return env?.QA_AUTO_SCHEDULE_ENABLED==='true'&&env.QA_AUTO_MODE==='automatic'&&
  env.QA_PUSH_ENABLED==='true'&&env.QA_CONVERSATION_PUSH_ENABLED==='true'&&
  positive(epoch(env))&&typeof env.QA_PUSH_DB?.prepare==='function'&&
  !!env.QA_FIREBASE_SERVICE_ACCOUNT_JSON&&!!env.QA_FIREBASE_WEB_API_KEY;
}
const fresh=(at,now)=>positive(at)&&at%60000===0&&at<=now&&now-at<=15000;
export function createQaScheduledCandidate({candidate,report=()=>{}}={}){
 if(typeof candidate?.tick!=='function'||typeof report!=='function')throw Error('missing_scheduled_dependency');
 return async function scheduled(controller,env){
  let result=stop('schedule_disabled');
  try{
   const at=controller?.scheduledTime,activatedAt=epoch(env);
   if(ready(env)){
    if(controller?.cron!==QA_AUTO_CRON||!fresh(at,Date.now())||at<activatedAt)result=stop('schedule_invalid');
    else{
     // One durable reservation per minute, monotonically increasing; no
     // refund on crash, no replay, and no schedule-created activation row.
     const r=await env.QA_PUSH_DB.prepare("UPDATE qa_auto_d1_schedule_lab SET last_scheduled_at=? WHERE singleton=1 AND activated_at=? AND last_scheduled_at<? AND ? BETWEEN "+clock+"-15000 AND "+clock+" AND EXISTS (SELECT 1 FROM qa_auto_d1_trial_lab t JOIN qa_auto_d1_activation_lab a ON a.singleton=t.singleton WHERE t.singleton=1 AND t.activated_at=? AND a.activated_at=t.activated_at AND a.enabled=1 AND t.activated_at<=? AND t.ends_at>="+clock+"+120000 AND t.ticks<60)")
      .bind(at,activatedAt,at,at,activatedAt,at).run();
     if(r?.success!==true||r.meta?.changes!==1)result=stop('schedule_reservation_unavailable');
     else if(!fresh(at,Date.now()))result=stop('schedule_expired');
     else{
      // Tick retains its own independent persistent budgets and final FCM gate.
      const out=await candidate.tick(env);
      const transport=out?.result?.transportStatus,attempts=out?.httpUsage?.actualExternalAttempts;
      result={status:'completed',outcome:transport==='accepted_simulated'?'provider_accepted':
       transport==='rejected_simulated'?'provider_rejected':out?.httpUsage?.fcmAttempted===true?'transport_uncertain':'no_confirmed_send',
       externalAttempts:Number.isSafeInteger(attempts)&&attempts>=0&&attempts<=35?attempts:null,
       fcmAttempted:out?.httpUsage?.fcmAttempted===true};
     }
    }
   }
  }catch{result={status:'failed',reason:'schedule_unavailable',externalAttempts:null,fcmAttempted:null}}
  try{report(result)}catch{/* diagnostics cannot alter delivery */}
  return result;
 };
}
