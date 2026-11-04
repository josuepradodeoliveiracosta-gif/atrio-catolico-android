/**
 * Durable, role-separated, synthetic deletion coordination over D1.
 * Limited to qa-freeze-alice/bob, QA provider assertions, no delete endpoints.
 * External provider correctness is NOT established by this fixture protocol.
 * This module operates on D1's prepare/bind/first/run interface, including
 * SQLite-backed emulation. No network, Firebase, Cloudinary or FCM calls.
 */
import {stageFixtureUid} from './protocol.js';
export const QA_DELETION_PHASES=Object.freeze([
  'firestore_reconciled','avatar_d1_reconciled','fcm_reconciled',
  'before_auth_verified','auth_emulator_deleted','final_qa_verified'
]);
const PHASE_ROLE=Object.freeze([
  'guardian','avatar','push','reconciler','reconciler','reconciler'
]);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=()=>{throw Error('qa_deletion_case_denied')};
const ensure=(db,uid,caseId)=>{
  if(typeof db?.prepare!=='function'||!stageFixtureUid(uid)||
     typeof caseId!=='string'||!UUID.test(caseId))fail();
};
async function get(db,sql,...args){
  const row=await db.prepare(sql).bind(...args).first();
  return row||null;
}
async function write(db,sql,...args){
  const result=await db.prepare(sql).bind(...args).run();
  if(result?.success!==true || result.meta?.changes!==1)fail();
}
function inspect(row,uid,caseId){
  if(!row||row.uid!==uid||row.case_id!==caseId||
     row.generation!==1||!Number.isSafeInteger(row.step)||
     row.step<0||row.step>QA_DELETION_PHASES.length)fail();
  return Object.freeze({
    uid,caseId,generation:row.generation,completedPhases:row.step,
    nextPhase:QA_DELETION_PHASES[row.step]||null,
    caseState:row.step===QA_DELETION_PHASES.length?'qa_fixture_complete':'qa_fixture_pending',
    productionReady:false,providerEffectsVerified:false,accountDeleted:false
  });
}
async function frozen(db,uid){
  const row=await get(db,
    "SELECT state FROM qa_privileged_accounts WHERE uid=? AND state='frozen' "+
    "AND NOT EXISTS (SELECT 1 FROM qa_privileged_operations WHERE uid=?)",
    uid,uid);
  if(!row||row.state!=='frozen')fail();
}
export function createQaDeletionCaseLedger(db){
  if(typeof db?.prepare!=='function')fail();
  return Object.freeze({
    async open({uid,caseId,at}){
      ensure(db,uid,caseId);
      if(!Number.isSafeInteger(at)||at<=0)fail();
      await frozen(db,uid);
      // Unique per UID. Never replace a previous case or reset step.
      const result=await db.prepare(
        "INSERT OR IGNORE INTO qa_deletion_cases "+
        "(uid,case_id,generation,step,opened_ms) "+
        "SELECT ?,?,1,0,? WHERE EXISTS "+
        "(SELECT 1 FROM qa_privileged_accounts a WHERE a.uid=? AND a.state='frozen' "+
        "AND NOT EXISTS(SELECT 1 FROM qa_privileged_operations o WHERE o.uid=a.uid))"
      ).bind(uid,caseId,at,uid).run();
      if(result?.success!==true || ![0,1].includes(result.meta?.changes))fail();
      await frozen(db,uid);
      const row=await get(db,
        'SELECT uid,case_id,generation,step FROM qa_deletion_cases WHERE uid=?',uid);
      return inspect(row,uid,caseId);
    },
    async attest({uid,caseId,phase,role,at}){
      ensure(db,uid,caseId);
      const step=QA_DELETION_PHASES.indexOf(phase);
      if(step<0||role!==PHASE_ROLE[step]||
         !Number.isSafeInteger(at)||at<=0)fail();
      // The specific role signs the HTTP request; do not trust caller-chosen
      // role for access control. The Worker passes verified HMAC role.
      await frozen(db,uid);
      await write(db,
        "INSERT INTO qa_deletion_attestations(uid,case_id,step,role,created_ms) "+
        "SELECT ?,?,?,?,? WHERE EXISTS "+
        "(SELECT 1 FROM qa_deletion_cases c "+
        "JOIN qa_privileged_accounts a ON a.uid=c.uid "+
        "WHERE c.uid=? AND c.case_id=? AND c.generation=1 AND c.step=? "+
        "AND a.state='frozen' AND NOT EXISTS "+
        "(SELECT 1 FROM qa_privileged_operations o WHERE o.uid=c.uid))",
        uid,caseId,step,role,at,uid,caseId,step);
      return Object.freeze({attestationState:'qa_fixture_attested',phase,productionReady:false});
    },
    async advance({uid,caseId,expectedStep}){
      ensure(db,uid,caseId);
      if(!Number.isSafeInteger(expectedStep)||expectedStep<0||
         expectedStep>=QA_DELETION_PHASES.length)fail();
      // Single conditional D1 UPDATE is a race-safe compare-and-swap.
      // No rollback, skipping a phase, parallel double-advance or post-freeze
      // operation admission is possible through this protocol.
      const row=await get(db,
        "UPDATE qa_deletion_cases SET step=step+1 "+
        "WHERE uid=? AND case_id=? AND generation=1 AND step=? "+
        "AND EXISTS (SELECT 1 FROM qa_deletion_attestations att "+
        "WHERE att.uid=qa_deletion_cases.uid "+
        "AND att.case_id=qa_deletion_cases.case_id AND att.step=? AND att.role=?) "+
        "AND EXISTS (SELECT 1 FROM qa_privileged_accounts a "+
        "WHERE a.uid=qa_deletion_cases.uid AND a.state='frozen') "+
        "AND NOT EXISTS (SELECT 1 FROM qa_privileged_operations o "+
        "WHERE o.uid=qa_deletion_cases.uid) "+
        "RETURNING uid,case_id,generation,step",
        uid,caseId,expectedStep,expectedStep,PHASE_ROLE[expectedStep]);
      return inspect(row,uid,caseId);
    },
    async status({uid,caseId}){
      ensure(db,uid,caseId);
      await frozen(db,uid);
      const row=await get(db,
        'SELECT uid,case_id,generation,step FROM qa_deletion_cases WHERE uid=?',uid);
      return inspect(row,uid,caseId);
    }
  });
}
