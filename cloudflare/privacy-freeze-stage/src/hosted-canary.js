/**
 * Hosted QA Service Binding/D1 canary. Only three known roles, fixed
 * synthetic accounts, one marker per role. Starts+closes a real privileged
 * *fixture* ticket to exercise the same D1 barrier, without external effects.
 * No Firebase, Cloudinary, FCM or live account IDs. NOT deletion proof.
 */
import {createQaPrivilegedWriteBarrier}
  from '../../account-deletion-audit/src/qa-privileged-write-barrier.js';
export const CANARY_RUN_ID='qa-hosted-20261103-a';
const RULES=Object.freeze({
  avatar:{uid:'qa-freeze-alice',kind:'avatar_upload',
    scope:{ownerUid:'qa-freeze-alice'}},
  guardian:{uid:'qa-freeze-bob',kind:'guardian_content_write',
    scope:{ownerUid:'qa-freeze-bob'}},
  push:{uid:'qa-freeze-alice',kind:'push_fcm_send',
    scope:{actorUid:'qa-freeze-alice',recipientUid:'qa-freeze-bob'}}
});
const denied=()=>{throw Error('qa_hosted_canary_denied')};
export function validHostedCanary(role,input){
  const rule=Object.hasOwn(RULES,role)?RULES[role]:null;
  return Boolean(rule&&input&&Object.getPrototypeOf(input)===Object.prototype&&
    Object.keys(input).sort().join(',')==='runId,uid'&&
    input.runId===CANARY_RUN_ID&&input.uid===rule.uid);
}
export async function runHostedCanary(db,role,input,at){
  if(typeof db?.prepare!=='function'||!validHostedCanary(role,input)||
     !Number.isSafeInteger(at)||at<1_000_000_000_000)denied();
  const rule=RULES[role];
  // The marker is inserted before the D1 barrier operation. A timeout
  // or unknown outcome can never generate a second side effect.
  const inserted=await db.prepare(
    "INSERT OR IGNORE INTO qa_stage_hosted_canaries "+
    "(role,run_id,uid,result,created_ms) "+
    "SELECT ?,?,?,'admitted',? WHERE EXISTS "+
    "(SELECT 1 FROM qa_privileged_accounts WHERE uid=? AND state='active') "+
    "AND (? != 'push' OR EXISTS "+
    "(SELECT 1 FROM qa_privileged_accounts WHERE uid='qa-freeze-bob' "+
    "AND state='active'))"
  ).bind(role,CANARY_RUN_ID,rule.uid,at,rule.uid,role).run();
  if(inserted?.success!==true||inserted.meta?.changes!==1)denied();
  const barrier=createQaPrivilegedWriteBarrier(db);
  const ticket=await barrier.begin(rule.kind,rule.scope);
  // This attests NO provider effect; it only closes an admission QA ticket.
  await barrier.complete(ticket,{verified:async()=>true});
  const done=await db.prepare(
    "UPDATE qa_stage_hosted_canaries SET result='completed' "+
    "WHERE role=? AND run_id=? AND uid=? AND result='admitted'"
  ).bind(role,CANARY_RUN_ID,rule.uid).run();
  if(done?.success!==true||done.meta?.changes!==1)denied();
  return Object.freeze({status:'stage_canary_completed',
    syntheticOnly:true,productionReady:false,providerEffectsVerified:false});
}
