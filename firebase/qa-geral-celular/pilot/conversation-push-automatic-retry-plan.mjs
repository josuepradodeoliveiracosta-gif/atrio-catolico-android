// Pure scheduling contract. Does not enqueue, sleep, call FCM or extend a notice.
// Retry ONLY a publication deferred by an active pending notice, before a claim.
// The durable scheduler must persist attempts and the original deadline atomically.
const MIN_WINDOW=10_000;
const MAX_RETRIES=3;
const time=t=>Number.isSafeInteger(t)&&t>0;
const stop=reason=>({status:'stop',reason});
export function planPublicationRetry({decision,now,attempts,originalDeadline,pendingExpiresAt,claimed=false}={}){
 if(claimed!==false)return stop('claim_or_transport_started');
 if(decision?.status!=='defer'||decision.reason!=='active_pending')return stop('not_retryable');
 if(!time(now)||!time(originalDeadline)||!time(decision.retryBefore)||!time(pendingExpiresAt)||
    !Number.isSafeInteger(attempts)||attempts<0||attempts>=MAX_RETRIES)
   return stop('invalid_or_exhausted_budget');
 const deadline=Math.min(originalDeadline,decision.retryBefore);
 // Avoid polling the pending slot in a tight loop. A future scheduler can
 // also react to a trusted consumption event, but not reset the budget.
 const nextAt=Math.max(now+1000,pendingExpiresAt);
 if(deadline-nextAt<MIN_WINDOW)return stop('insufficient_original_window');
 return {status:'schedule',nextAt,deadline,attempt:attempts+1};
}
