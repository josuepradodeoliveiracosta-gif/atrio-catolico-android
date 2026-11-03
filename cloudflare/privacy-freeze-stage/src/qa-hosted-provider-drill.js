/**
 * Host-only, one-shot QA proof of D1 cleanup under a real synthetic freeze.
 * No public route. No Firebase Auth, Firestore, Cloudinary, FCM, tokens or
 * production database. No role-separated attestation proof: internal QA
 * test checkpoint deliberately represents synthetic prior canary evidence.
 *
 * Once reserved, this drill NEVER auto-retries, even after a partial
 * failure. Inspect D1 state instead. Production migration is forbidden.
 */
import {createQaPrivilegedWriteBarrier}
  from '../../account-deletion-audit/src/qa-privileged-write-barrier.js';
import {createQaDeletionCaseLedger}
  from './deletion-case-ledger.js';
import {reconcileQaProviderFixture}
  from './qa-provider-reconciliation.js';

export const QA_HOSTED_PROVIDER_RUN='qa-hosted-provider-20261103-a';
const QA_HOSTED_PROVIDER_UID='qa-freeze-alice';
const QA_HOSTED_PROVIDER_NEIGHBOR='qa-freeze-bob';
const QA_HOSTED_PROVIDER_CASE='fa00bbaa-4a09-4fd2-b399-001122334455';
const QA_HOSTED_PROVIDER_START=Date.parse('2026-11-03T20:00:00Z');
const QA_HOSTED_PROVIDER_END=Date.parse('2026-11-04T00:00:00Z');
const qaHostedProviderDeny=()=>{throw Error('qa_hosted_provider_drill_denied')};
async function qaHostedProviderRow(db,sql,...args){
  return await db.prepare(sql).bind(...args).first()||null;
}
async function qaHostedProviderCount(db,sql,...args){
  const row=await qaHostedProviderRow(db,sql,...args);
  if(!row||!Number.isSafeInteger(row.n)||row.n<0)
    qaHostedProviderDeny();
  return row.n;
}
async function qaHostedProviderAuthorized(db){
  const row=await qaHostedProviderRow(db,
    "SELECT run_id,state,case_id FROM qa_provider_drill_once WHERE uid=?",
    QA_HOSTED_PROVIDER_UID);
  return row?.run_id===QA_HOSTED_PROVIDER_RUN &&
    row?.case_id===QA_HOSTED_PROVIDER_CASE &&
    row?.state==='started';
}
async function qaHostedProviderPreflight(db){
  const states=await db.prepare(
    "SELECT uid,state FROM qa_privileged_accounts ORDER BY uid"
  ).all();
  if(!Array.isArray(states?.results)||states.results.length!==2||
     states.results[0].uid!==QA_HOSTED_PROVIDER_UID||
     states.results[1].uid!==QA_HOSTED_PROVIDER_NEIGHBOR||
     states.results.some(x=>x.state!=='active'))
    qaHostedProviderDeny();
  if(await qaHostedProviderCount(db,
    'SELECT COUNT(*) AS n FROM qa_privileged_operations')!==0 ||
     await qaHostedProviderCount(db,
       'SELECT COUNT(*) AS n FROM qa_deletion_cases')!==0 ||
     await qaHostedProviderCount(db,
       'SELECT COUNT(*) AS n FROM qa_deletion_attestations')!==0 ||
     await qaHostedProviderCount(db,
       'SELECT COUNT(*) AS n FROM qa_provider_fixture_holds')!==0 ||
     await qaHostedProviderCount(db,
       'SELECT COUNT(*) AS n FROM qa_provider_fixture_reconciliations')!==0 ||
     await qaHostedProviderCount(db,
       'SELECT COUNT(*) AS n FROM qa_provider_drill_once')!==0 ||
     await qaHostedProviderCount(db,
       "SELECT COUNT(*) AS n FROM qa_stage_hosted_canaries WHERE result='completed'")!==3 ||
     await qaHostedProviderCount(db,
       'SELECT COUNT(*) AS n FROM qa_provider_fixture_refs WHERE uid=?',
       QA_HOSTED_PROVIDER_UID)!==3 ||
     await qaHostedProviderCount(db,
       'SELECT COUNT(*) AS n FROM qa_provider_fixture_refs WHERE uid=?',
       QA_HOSTED_PROVIDER_NEIGHBOR)!==3)
    qaHostedProviderDeny();
}
export async function runQaHostedProviderDrill(db,{cron,scheduledTime}={}){
  // Only a private scheduled handler can call this. Never export via fetch.
  if(typeof db?.prepare!=='function'||typeof db?.batch!=='function'||
     cron!=='* * * * *'||!Number.isSafeInteger(scheduledTime)||
     scheduledTime<QA_HOSTED_PROVIDER_START||
     scheduledTime>=QA_HOSTED_PROVIDER_END)
    return Object.freeze({state:'qa_hosted_drill_not_scheduled'});
  // Every tick after the first reservation exits, including an uncertain
  // error; never interpret timer retries as safe permission to delete.
  if(await qaHostedProviderCount(db,
    'SELECT COUNT(*) AS n FROM qa_provider_drill_once')!==0)
    return Object.freeze({state:'qa_hosted_drill_already_attempted'});
  await qaHostedProviderPreflight(db);
  const inserted=await db.prepare(
    "INSERT OR IGNORE INTO qa_provider_drill_once "+
    "(uid,case_id,run_id,state,started_ms) "+
    "SELECT ?,?,?,'started',? WHERE "+
    "(SELECT COUNT(*) FROM qa_provider_drill_once)=0 AND "+
    "(SELECT COUNT(*) FROM qa_privileged_operations)=0 AND "+
    "(SELECT COUNT(*) FROM qa_provider_fixture_holds)=0 AND "+
    "(SELECT COUNT(*) FROM qa_provider_fixture_reconciliations)=0 AND "+
    "(SELECT COUNT(*) FROM qa_deletion_cases)=0 AND "+
    "(SELECT COUNT(*) FROM qa_stage_hosted_canaries "+
    "WHERE result='completed')=3 AND "+
    "(SELECT COUNT(*) FROM qa_provider_fixture_refs WHERE uid=?)=3 AND "+
    "(SELECT COUNT(*) FROM qa_provider_fixture_refs WHERE uid=?)=3 AND "+
    "(SELECT COUNT(*) FROM qa_privileged_accounts WHERE state='active')=2"
  ).bind(QA_HOSTED_PROVIDER_UID,QA_HOSTED_PROVIDER_CASE,
    QA_HOSTED_PROVIDER_RUN,scheduledTime,
    QA_HOSTED_PROVIDER_UID,QA_HOSTED_PROVIDER_NEIGHBOR).run();
  if(inserted?.success!==true||inserted.meta?.changes!==1)
    return Object.freeze({state:'qa_hosted_drill_reservation_denied'});
  try{
    const barrier=createQaPrivilegedWriteBarrier(db);
    await barrier.beginFreeze(QA_HOSTED_PROVIDER_UID);
    await barrier.finalizeFreeze(QA_HOSTED_PROVIDER_UID);
    const ledger=createQaDeletionCaseLedger(db);
    await ledger.open({uid:QA_HOSTED_PROVIDER_UID,
      caseId:QA_HOSTED_PROVIDER_CASE,at:scheduledTime});
    // A synthetic CI-style checkpoint, not HMAC role attestation or real
    // Firestore removal. The previous 3 hosted canaries are the QA gate.
    await ledger.attest({uid:QA_HOSTED_PROVIDER_UID,
      caseId:QA_HOSTED_PROVIDER_CASE,phase:'firestore_reconciled',
      role:'guardian',at:scheduledTime});
    const stage=await ledger.advance({uid:QA_HOSTED_PROVIDER_UID,
      caseId:QA_HOSTED_PROVIDER_CASE,expectedStep:0});
    if(stage.completedPhases!==1)qaHostedProviderDeny();
    const result=await reconcileQaProviderFixture(db,{
      uid:QA_HOSTED_PROVIDER_UID,caseId:QA_HOSTED_PROVIDER_CASE,
      independentApproval:async()=>qaHostedProviderAuthorized(db),
      independentFreezeCheck:async()=>{
        const [owner,neighbor]=await Promise.all([
          barrier.status(QA_HOSTED_PROVIDER_UID),
          barrier.status(QA_HOSTED_PROVIDER_NEIGHBOR)
        ]);
        return owner.state==='frozen'&&owner.inFlight===0 &&
          neighbor.state==='active'&&neighbor.inFlight===0;
      },
      now:()=>scheduledTime
    });
    if(result.status!=='qa_synthetic_d1_reconciled'||result.productionReady!==false)
      qaHostedProviderDeny();
    const completed=await db.prepare(
      "UPDATE qa_provider_drill_once SET state='verified',completed_ms=? "+
      "WHERE uid=? AND case_id=? AND run_id=? AND state='started'"
    ).bind(scheduledTime,QA_HOSTED_PROVIDER_UID,
      QA_HOSTED_PROVIDER_CASE,QA_HOSTED_PROVIDER_RUN).run();
    if(completed?.success!==true||completed.meta?.changes!==1)
      qaHostedProviderDeny();
    return Object.freeze({state:'qa_hosted_provider_verified',
      productionReady:false,externalProviderEffectsVerified:false});
  }catch{
    // Error leaves evidence in D1, not a silent success or repeatable job.
    await db.prepare(
      "UPDATE qa_provider_drill_once SET state='failed',completed_ms=? "+
      "WHERE uid=? AND run_id=? AND state='started'"
    ).bind(scheduledTime,QA_HOSTED_PROVIDER_UID,
      QA_HOSTED_PROVIDER_RUN).run();
    throw Error('qa_hosted_provider_drill_failed');
  }
}
