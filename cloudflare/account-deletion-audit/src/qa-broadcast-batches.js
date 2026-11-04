/**
 * QA-only batch broadcast ledger. This module is Node/SQLite-only and cannot
 * send FCM, enumerate users, or connect to a production Cloudflare Worker.
 * The existing HMAC two-user stage remains unchanged and production blocked.
 *
 * Safety: complete synthetic inventory BEFORE planning; per-request unique
 * ledger, one persisted batch lease, atomic eligibility check at claim time,
 * no automatic retry after an ambiguous effect, independently reconciled
 * tickets, and a freeze that waits for ALL outstanding account effects.
 */
import {createHash} from 'node:crypto';

const ACTOR='qa-batch-00';
const ID=/^qa-batch-0[0-8]$/;
const TOKEN=/^qa-fcm-[a-z0-9-]{1,40}$/;
const REQUEST=/^qa-broadcast-[a-z0-9-]{1,40}$/;
const REVISION=/^qa-revision-[a-z0-9-]{1,32}$/;
const MAX_ROWS=9;
const PAGE_SIZE=3;
const BATCH_SIZE=3;
const states=new Set(['queued','inflight','acked','ambiguous','reconciled']);
function fail(code){throw Error(code);}
function keys(obj,want){
  return obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).sort().join(',')===[...want].sort().join(',');
}
function checkDb(db){
  if(!db||typeof db.prepare!=='function'||typeof db.exec!=='function')
    fail('qa_batch_database_missing');
}
function checkUid(uid){if(!ID.test(uid))fail('qa_batch_invalid_identity');}
function checkRequest(requestId){
  if(typeof requestId!=='string'||!REQUEST.test(requestId))
    fail('qa_batch_invalid_request');
}
function tx(db,action){
  db.exec('BEGIN IMMEDIATE');
  try{const value=action();db.exec('COMMIT');return value;}
  catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
/** Only a trusted, immutable, fully enumerated QA fixture is accepted.
 * A matching count declared by a real API would not prove completeness.
 */
export async function collectQaBatchInventory({actorUid,readPage}={}){
  if(actorUid!==ACTOR||typeof readPage!=='function')
    fail('qa_batch_inventory_unverified');
  const rows=[],uids=new Set(),tokens=new Set(),cursors=new Set();
  let revision=null,total=null,cursor=null,last='';
  for(let index=0;index<MAX_ROWS;index++){
    const page=await readPage(cursor);
    if(!keys(page,['revision','pageIndex','expectedTotal','rows','nextCursor','complete'])||
      typeof page.revision!=='string'||!REVISION.test(page.revision)||
      page.pageIndex!==index||typeof page.complete!=='boolean'||
      !Number.isSafeInteger(page.expectedTotal)||page.expectedTotal<2||
      page.expectedTotal>MAX_ROWS||!Array.isArray(page.rows)||
      page.rows.length<1||page.rows.length>PAGE_SIZE)
      fail('qa_batch_inventory_unverified');
    if(revision===null){revision=page.revision;total=page.expectedTotal;}
    if(revision!==page.revision||total!==page.expectedTotal)
      fail('qa_batch_inventory_unverified');
    for(const row of page.rows){
      if(!keys(row,['uid','optedIn','token'])||!ID.test(row.uid)||
        typeof row.optedIn!=='boolean'||
        (row.uid===ACTOR&&(row.optedIn||row.token!==null))||
        (row.optedIn?!TOKEN.test(row.token):row.token!==null)||
        row.uid<=last||uids.has(row.uid)||
        (row.optedIn&&tokens.has(row.token)))
        fail('qa_batch_inventory_unverified');
      rows.push(Object.freeze({...row}));
      uids.add(row.uid);
      if(row.optedIn)tokens.add(row.token);
      last=row.uid;
    }
    if(rows.length>total)fail('qa_batch_inventory_unverified');
    if(page.complete){
      if(page.nextCursor!==null||rows.length!==total||!uids.has(ACTOR))
        fail('qa_batch_inventory_unverified');
      return Object.freeze({revision,rows:Object.freeze(rows)});
    }
    const next='qa-page-'+(index+1);
    if(index+1>=MAX_ROWS||rows.length>=total||
      page.nextCursor!==next||cursors.has(next))
      fail('qa_batch_inventory_unverified');
    cursors.add(next);
    cursor=next;
  }
  fail('qa_batch_inventory_unverified');
}
function manifest(inventory){
  return createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
}
/** Persist a complete synthetic manifest exactly once, under a SQLite write
 * transaction. A request ID reused with a changed inventory is rejected.
 */
export async function planQaBatch({db,actorUid,requestId,readPage}={}){
  checkDb(db);checkUid(actorUid);checkRequest(requestId);
  const inventory=await collectQaBatchInventory({actorUid,readPage});
  const digest=manifest(inventory);
  return tx(db,()=>{
    const prior=db.prepare('SELECT actor_uid,revision,manifest_hash FROM qa_bcast_jobs WHERE request_id=?')
      .get(requestId);
    if(prior){
      if(prior.actor_uid!==actorUid||prior.revision!==inventory.revision||
         prior.manifest_hash!==digest)fail('qa_batch_idempotency_conflict');
      return Object.freeze({status:'qa_duplicate_plan',requestId,productionReady:false});
    }
    const eligible=inventory.rows.filter(row=>row.uid!==actorUid&&row.optedIn);
    const involved=[actorUid,...eligible.map(x=>x.uid)];
    for(const uid of involved){
      const subject=db.prepare('SELECT state FROM qa_bcast_accounts WHERE uid=?').get(uid);
      if(subject?.state!=='active')fail('qa_batch_privileged_write_blocked');
    }
    db.prepare("INSERT INTO qa_bcast_jobs (request_id,actor_uid,revision,manifest_hash,state) VALUES (?,?,?,?,'ready')")
      .run(requestId,actorUid,inventory.revision,digest);
    const insert=db.prepare("INSERT INTO qa_bcast_deliveries (request_id,recipient_uid,fake_token,state) VALUES (?,?,?,'queued')");
    for(const row of eligible)insert.run(requestId,row.uid,row.token);
    return Object.freeze({status:'qa_planned',requestId,
      queued:eligible.length,productionReady:false});
  });
}
/** A single SQLite UPDATE serializes a claim with freeze transitions.
 * The job's persistent lease also excludes competing batch consumers.
 */
function claim(db,requestId,uid){
  return db.prepare(
    "UPDATE qa_bcast_deliveries SET state='inflight' "+
    "WHERE request_id=? AND recipient_uid=? AND state='queued' "+
    "AND EXISTS (SELECT 1 FROM qa_bcast_accounts a "+
      "WHERE a.uid=recipient_uid AND a.state='active') "+
    "AND EXISTS (SELECT 1 FROM qa_bcast_jobs j "+
      "JOIN qa_bcast_accounts a ON a.uid=j.actor_uid "+
      "WHERE j.request_id=qa_bcast_deliveries.request_id AND a.state='active') "+
    "RETURNING recipient_uid,fake_token"
  ).get(requestId,uid);
}
/** One explicit batch invocation, not a scheduler. 'accepted' is only a
 * synthetic fixture acknowledgement, never proof of FCM/device delivery.
 */
export async function simulateQaBatch({db,requestId,sendFixture}={}){
  checkDb(db);checkRequest(requestId);
  if(typeof sendFixture!=='function')fail('qa_batch_missing_fixture_sender');
  const lease=db.prepare(
    "UPDATE qa_bcast_jobs SET state='processing' "+
    "WHERE request_id=? AND state='ready' "+
    "AND NOT EXISTS (SELECT 1 FROM qa_bcast_deliveries d "+
      "WHERE d.request_id=? AND d.state IN ('ambiguous','inflight')) "+
    "RETURNING request_id"
  ).get(requestId,requestId);
  if(!lease)return Object.freeze({status:'qa_batch_not_admitted',productionReady:false});
  let attempts=0;
  try{
    const queued=db.prepare(
      "SELECT recipient_uid FROM qa_bcast_deliveries "+
      "WHERE request_id=? AND state='queued' ORDER BY recipient_uid LIMIT ?"
    ).all(requestId,BATCH_SIZE);
    for(const {recipient_uid} of queued){
      const ticket=claim(db,requestId,recipient_uid);
      if(!ticket){
        db.prepare("UPDATE qa_bcast_jobs SET state='halted' WHERE request_id=? AND state='processing'")
          .run(requestId);
        return Object.freeze({status:'qa_batch_frozen_or_denied',
          attempted:attempts,productionReady:false});
      }
      attempts++;
      let accepted=false;
      try{
        const result=await sendFixture(Object.freeze({
          kind:'qa_broadcast_fixture',requestId,recipientUid:recipient_uid,
          fakeToken:ticket.fake_token
        }));
        accepted=result?.status==='qa_simulated_accepted';
      }catch{accepted=false;}
      db.prepare("UPDATE qa_bcast_deliveries SET state=? "+
        "WHERE request_id=? AND recipient_uid=? AND state='inflight'")
        .run(accepted?'acked':'ambiguous',requestId,recipient_uid);
      if(!accepted){
        db.prepare("UPDATE qa_bcast_jobs SET state='halted' WHERE request_id=? AND state='processing'")
          .run(requestId);
        return Object.freeze({status:'qa_batch_ambiguous_pending_review',
          attempted:attempts,productionReady:false});
      }
    }
    db.prepare("UPDATE qa_bcast_jobs SET state='ready' "+
      "WHERE request_id=? AND state='processing'").run(requestId);
    return Object.freeze({status:attempts?'qa_batch_accepted_pending_review':'qa_batch_no_new_recipients',
      attempted:attempts,productionReady:false});
  }catch(error){
    // A crash or database uncertainty leaves the durable lease/ticket open.
    // Never clear it here, nor re-send an unverified attempt.
    throw error;
  }
}
/** Independent QA-only reconciler (not callable by a real Worker/FCM sender).
 * Evidence strings are purely fictional, not proof of real delivery.
 */
export function createQaBatchReconciler(db){
  checkDb(db);
  return Object.freeze({
    reconcile({requestId,recipientUid,evidence}={}){
      checkRequest(requestId);checkUid(recipientUid);
      if(!['qa-reviewed-synthetic-effect','qa-reviewed-never-started'].includes(evidence))
        fail('qa_batch_independent_evidence_required');
      return tx(db,()=>{
        const row=db.prepare('SELECT state FROM qa_bcast_deliveries WHERE request_id=? AND recipient_uid=?')
          .get(requestId,recipientUid);
        if(!row||!states.has(row.state))fail('qa_batch_unknown_ticket');
        const match=evidence==='qa-reviewed-synthetic-effect'
          ? ['acked','ambiguous'].includes(row.state)
          : row.state==='queued';
        if(!match)fail('qa_batch_evidence_scope_mismatch');
        db.prepare("UPDATE qa_bcast_deliveries SET state='reconciled' "+
          "WHERE request_id=? AND recipient_uid=? AND state=?")
          .run(requestId,recipientUid,row.state);
        db.prepare("UPDATE qa_bcast_jobs SET state='ready' "+
          "WHERE request_id=? AND state='halted' "+
          "AND NOT EXISTS (SELECT 1 FROM qa_bcast_deliveries "+
             "WHERE request_id=? AND state IN ('ambiguous','inflight'))")
          .run(requestId,requestId);
        return Object.freeze({status:'qa_independently_reconciled',productionReady:false});
      });
    },
    beginFreeze(uid){
      checkUid(uid);
      const row=db.prepare("UPDATE qa_bcast_accounts SET state='draining' "+
        "WHERE uid=? AND state='active' RETURNING uid").get(uid);
      if(!row)fail('qa_batch_freeze_not_available');
      return 'draining';
    },
    finalizeFreeze(uid){
      checkUid(uid);
      const row=db.prepare("UPDATE qa_bcast_accounts SET state='frozen' "+
        "WHERE uid=? AND state='draining' "+
        "AND NOT EXISTS (SELECT 1 FROM qa_bcast_deliveries d "+
          "JOIN qa_bcast_jobs j ON j.request_id=d.request_id "+
          "WHERE (d.recipient_uid=? OR j.actor_uid=?) AND d.state!='reconciled') "+
        "RETURNING uid").get(uid,uid,uid);
      if(!row)fail('qa_batch_inflight_or_queued');
      return 'frozen';
    },
    status(uid){
      checkUid(uid);
      const row=db.prepare('SELECT state FROM qa_bcast_accounts WHERE uid=?').get(uid);
      if(!row)fail('qa_batch_unknown_identity');
      const pending=db.prepare(
        "SELECT COUNT(*) AS n FROM qa_bcast_deliveries d "+
        "JOIN qa_bcast_jobs j ON j.request_id=d.request_id "+
        "WHERE (d.recipient_uid=? OR j.actor_uid=?) AND d.state!='reconciled'"
      ).get(uid,uid);
      return Object.freeze({state:row.state,inFlight:pending.n});
    }
  });
}
export const QA_BATCH_READINESS=Object.freeze({
  productionIntegrated:false,realFcmEnabled:false,realD1Configured:false,
  userDataAllowed:false,automaticRetryEnabled:false,
  independentProductionEvidence:false,stagingOnly:true
});