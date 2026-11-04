/**
 * Verifiable, one-shot hosted QA readback receipt, distinct from the HMAC
 * anti-replay nonce. A nonce alone can be stored before a failed readback.
 *
 * This tiny write is ONLY to an isolated QA fixture D1 table. It records no
 * provider effects, account deletion, Auth, user data or production approval.
 */
const RULES=Object.freeze({
  avatar:Object.freeze({uid:'qa-freeze-alice',state:'frozen',
    nonce:'44444444-4444-4444-8444-444444444444'}),
  guardian:Object.freeze({uid:'qa-freeze-bob',state:'active',
    nonce:'55555555-5555-4555-8555-555555555555'}),
  push:Object.freeze({uid:'qa-freeze-alice',state:'frozen',
    nonce:'66666666-6666-4666-8666-666666666666'})
});
const deny=()=>{throw Error('qa_hmac_role_proof_denied');};
export async function recordQaHostedRoleProof({
  db,role,uid,nonce,at,snapshot
}={}){
  const rule=Object.hasOwn(RULES,role)?RULES[role]:null;
  if(!rule||typeof db?.prepare!=='function'||uid!==rule.uid||
     nonce!==rule.nonce||!Number.isSafeInteger(at)||at<1e12||
     snapshot?.state!==rule.state||snapshot?.inFlight!==0)
    deny();
  // Enforce the same snapshot again AT THE INSERT statement, not merely a
  // stale JavaScript check: account freeze + neighbor isolation + zero
  // in-flight tickets must all hold in one SQLite/D1 statement.
  const statement=db.prepare(
    'INSERT OR IGNORE INTO qa_stage_hmac_role_proofs '+
    '(role,uid,nonce,observed_state,in_flight,created_ms) '+
    'SELECT ?,?,?,?,0,? WHERE '+
    'EXISTS (SELECT 1 FROM qa_privileged_accounts a WHERE a.uid=? '+
    "AND a.state=? AND NOT EXISTS "+
    '(SELECT 1 FROM qa_privileged_operations o WHERE o.uid=a.uid)) '+
    'AND EXISTS (SELECT 1 FROM qa_privileged_accounts neighbor '+
    "WHERE neighbor.uid=? AND neighbor.state=? AND NOT EXISTS "+
    '(SELECT 1 FROM qa_privileged_operations p WHERE p.uid=neighbor.uid))'
  );
  const result=await statement.bind(role,uid,nonce,rule.state,at,
    uid,rule.state,
    uid==='qa-freeze-alice'?'qa-freeze-bob':'qa-freeze-alice',
    uid==='qa-freeze-alice'?'active':'frozen').run();
  // Duplicate, missing schema, raced freeze or unknown response fails shut.
  if(result?.success!==true||result.meta?.changes!==1)deny();
  return Object.freeze({proofRecorded:true,syntheticOnly:true,
    productionReady:false,providerEffectsVerified:false});
}
export const QA_ROLE_PROOF_READINESS=Object.freeze({
  requiresHmacRole:true,
  requiresAtomicD1StateAndNeighborFence:true,
  permitsProductionAccounts:false,
  providerVerified:false,
  accountDeleted:false,
  productionIntegrated:false
});
