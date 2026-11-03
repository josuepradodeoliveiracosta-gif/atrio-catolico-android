/**
 * Synthetic QA-only D1 fixture cleanup. NOT a Cloudinary/FCM deletion adapter.
 *
 * Three references are labels, not live provider resources or FCM tokens.
 * Bounded by a frozen QA case at step 1, zero privileged in-flight operations,
 * absence of moderation holds and an exact 3-kind manifest. D1.batch is used
 * for transactional journal+delete. A fresh, independent SELECT follows it.
 *
 * This module has NO HTTP endpoint or deployed import. It must NOT be
 * connected to a real Worker and cannot authorize real account deletion.
 */
import {stageFixtureUid} from './protocol.js';

const KINDS=Object.freeze([
  'avatar_d1_pointer','cloudinary_qa_pointer',
  'push_registration_pointer'
]);
const QA_PROVIDER_CASE_RE=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const deny=reason=>{throw Error('qa_provider_fixture_denied:'+reason)};
function safeUidCase(uid,caseId){
  if(!stageFixtureUid(uid)||typeof caseId!=='string'||!QA_PROVIDER_CASE_RE.test(caseId))
    deny('untrusted_identity');
}
async function qaProviderFirst(db,sql,...args){
  const x=await db.prepare(sql).bind(...args).qaProviderFirst();
  if(x===undefined)deny('unknown_d1_read');
  return x;
}
async function qaProviderRows(db,sql,...args){
  const r=await db.prepare(sql).bind(...args).all();
  if(!r||!Array.isArray(r.results))deny('unknown_d1_rows');
  return r.results;
}
function exactCount(value){
  if(!Number.isSafeInteger(value)||value<0)deny('untrusted_count');
  return value;
}
async function currentGate(db,uid,caseId){
  const row=await qaProviderFirst(db,
    "SELECT a.state,c.case_id,c.step,"+
    "(SELECT COUNT(*) FROM qa_privileged_operations WHERE uid=a.uid) AS pending,"+
    "(SELECT COUNT(*) FROM qa_provider_fixture_holds WHERE uid=a.uid) AS holds "+
    "FROM qa_privileged_accounts a "+
    "JOIN qa_deletion_cases c ON c.uid=a.uid "+
    "WHERE a.uid=? AND c.case_id=?",uid,caseId);
  if(!row||row.state!=='frozen'||row.case_id!==caseId||
     row.step!==1||exactCount(row.pending)!==0||exactCount(row.holds)!==0)
    deny('fence_case_or_retention');
}
async function manifest(db,uid){
  const items=await qaProviderRows(db,
    "SELECT kind,fixture_ref FROM qa_provider_fixture_refs WHERE uid=? ORDER BY kind",uid);
  if(items.length!==KINDS.length ||
     items.some((item,i)=>item.kind!==[...KINDS].sort()[i] ||
       typeof item.fixture_ref!=='string' ||
       !/^qa-fixture-[a-z0-9-]{1,80}$/.test(item.fixture_ref)))
    deny('manifest_incomplete_or_unknown');
}
async function independentPostcheck(db,uid,caseId){
  const m=await qaProviderFirst(db,
    "SELECT COUNT(*) AS n FROM qa_provider_fixture_refs WHERE uid=?",uid);
  const j=await qaProviderFirst(db,
    "SELECT case_id FROM qa_provider_fixture_reconciliations WHERE uid=?",uid);
  if(exactCount(m?.n)!==0||j?.case_id!==caseId)
    deny('residual_or_ambiguous_effect');
  return Object.freeze({
    status:'qa_synthetic_d1_reconciled',
    productProviderDeleted:false,remoteCloudinaryVerified:false,
    remoteFcmVerified:false,productionReady:false
  });
}
export async function reconcileQaProviderFixture(db,{
  uid,caseId,independentApproval,independentFreezeCheck,now=Date.now
}={}){
  safeUidCase(uid,caseId);
  if(typeof db?.prepare!=='function'||typeof db?.batch!=='function'||
     typeof independentApproval!=='function'||
     typeof independentFreezeCheck!=='function'||typeof now!=='function')
    deny('untrusted_adapter');
  const reauthorize=async()=>{
    if(await independentApproval(uid,caseId)!==true)
      deny('approval_revoked');
    if(await independentFreezeCheck(uid,caseId)!==true)
      deny('freeze_not_independently_confirmed');
    await currentGate(db,uid,caseId);
  };
  await reauthorize();
  const prior=await qaProviderFirst(db,
    "SELECT case_id FROM qa_provider_fixture_reconciliations WHERE uid=?",uid);
  if(prior){
    if(prior.case_id!==caseId)deny('case_conflict');
    await reauthorize();
    return Object.freeze({...await independentPostcheck(db,uid,caseId),
      resumed:true});
  }
  await manifest(db,uid);
  await reauthorize();
  const marker=db.prepare(
    "INSERT INTO qa_provider_fixture_reconciliations(uid,case_id,completed_ms) "+
    "SELECT ?,?,? WHERE EXISTS "+
    "(SELECT 1 FROM qa_deletion_cases c "+
    "JOIN qa_privileged_accounts a ON a.uid=c.uid "+
    "WHERE c.uid=? AND c.case_id=? AND c.step=1 AND a.state='frozen' "+
    "AND NOT EXISTS(SELECT 1 FROM qa_privileged_operations o WHERE o.uid=c.uid) "+
    "AND NOT EXISTS(SELECT 1 FROM qa_provider_fixture_holds h WHERE h.uid=c.uid)) "+
    "AND (SELECT COUNT(*) FROM qa_provider_fixture_refs WHERE uid=?)=3"
  ).bind(uid,caseId,now(),uid,caseId,uid);
  const cleanup=db.prepare(
    "DELETE FROM qa_provider_fixture_refs WHERE uid=? "+
    "AND EXISTS (SELECT 1 FROM qa_provider_fixture_reconciliations "+
    "WHERE uid=? AND case_id=?) RETURNING kind"
  ).bind(uid,uid,caseId);
  // D1 executes a batch transactionally. A concurrent losing INSERT,
  // timeout, exception or partial commit must not produce a success verdict.
  // Crucially, no real provider write takes place in this code path.
  const results=await db.batch([marker,cleanup]);
  if(!Array.isArray(results)||results.length!==2 ||
     results[0]?.success!==true||results[0]?.meta?.changes!==1 ||
     results[1]?.success!==true ||
     !Array.isArray(results[1]?.results) ||
     results[1].results.length!==KINDS.length ||
     results[1].results.map(x=>x.kind).sort().join(',')!==KINDS.slice().sort().join(','))
    deny('transaction_unconfirmed');
  await reauthorize();
  return independentPostcheck(db,uid,caseId);
}
