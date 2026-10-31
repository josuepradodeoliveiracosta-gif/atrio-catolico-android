/**
 * QA-only privileged write barrier; NOT connected to any active Worker.
 * All mutations are simulated by tests, never Firebase/Cloudinary/FCM.
 *
 * A single SQL INSERT ... SELECT admits all involved accounts atomically.
 * A freeze changes ACTIVE -> DRAINING atomically, preventing future permits.
 * A freeze becomes FROZEN only after all in-flight operations are verified
 * and removed from the ledger. Unknown/failed external effects leave tickets
 * open and BLOCK the freeze until manual reconciliation.
 *
 * This does not replace a real distributed protocol or IAM controls.
 */
const QA_UIDS=Object.freeze(['qa-freeze-alice','qa-freeze-bob']);
const OPS=Object.freeze({
  avatar_upload:['ownerUid'],
  avatar_promote:['ownerUid'],
  avatar_remove:['ownerUid'],
  avatar_moderation:['ownerUid','actorUid'],
  guardian_content_write:['ownerUid'],
  guardian_review_write:['ownerUid','actorUid'],
  push_thread_notice:['actorUid','recipientUid'],
  push_fcm_send:['recipientUid'],
  push_cleanup_device:['ownerUid']
});
export const QA_PRIVILEGED_KINDS=Object.freeze(Object.keys(OPS));

function accountsFor(kind,scope) {
  const required=OPS[kind];
  if(!required||!scope||typeof scope!=='object'||Array.isArray(scope))
    throw Error('qa_invalid_privileged_operation');
  const keys=Object.keys(scope).sort();
  if(keys.join(',')!==[...required].sort().join(','))
    throw Error('qa_invalid_privileged_scope');
  const accounts=[...new Set(required.map(key=>scope[key]))].sort();
  if(accounts.some(uid=>!QA_UIDS.includes(uid)))
    throw Error('qa_unknown_identity');
  return accounts;
}
function checkUid(uid) {
  if(!QA_UIDS.includes(uid)) throw Error('qa_unknown_identity');
}
async function all(db,query,...values) {
  const response=await db.prepare(query).bind(...values).all();
  if(!response||!Array.isArray(response.results))
    throw Error('qa_invalid_database_result');
  return response.results;
}
async function first(db,query,...values) {
  const row=await db.prepare(query).bind(...values).first();
  return row||null;
}
function validTicket(ticket){
  return ticket&&typeof ticket==='object'&&!Array.isArray(ticket)&&
    typeof ticket.id==='string'&&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ticket.id)&&
    Object.hasOwn(OPS,ticket.kind)&&Array.isArray(ticket.accounts)&&
    ticket.accounts.length>=1&&ticket.accounts.length<=2&&
    ticket.accounts.every(uid=>QA_UIDS.includes(uid))&&
    new Set(ticket.accounts).size===ticket.accounts.length;
}

export function createQaPrivilegedWriteBarrier(db) {
  if(typeof db?.prepare!=='function')throw Error('qa_invalid_barrier_database');
  return Object.freeze({
    async begin(kind,scope){
      const accounts=accountsFor(kind,scope);
      const id=crypto.randomUUID();
      const slots=accounts.map(()=>'?').join(',');
      const query=[
        'INSERT INTO qa_privileged_operations (operation_id,uid,kind)',
        'SELECT ?, a.uid, ? FROM qa_privileged_accounts a',
        'WHERE a.uid IN ('+slots+') AND a.state = ?',
        'AND (SELECT COUNT(*) FROM qa_privileged_accounts',
        'WHERE uid IN ('+slots+') AND state = ?) = ?',
        'RETURNING uid'
      ].join(' ');
      // All-or-nothing: if any subject is draining or frozen,
      // the INSERT SELECT has zero results (not a partial ticket).
      const rows=await all(db,query,id,kind,...accounts,'active',
        ...accounts,'active',accounts.length);
      if(rows.length!==accounts.length)
        throw Error('qa_privileged_write_blocked');
      return Object.freeze({id,kind,accounts:Object.freeze(accounts)});
    },
    async complete(ticket,{verified}={}){
      if(!validTicket(ticket))throw Error('qa_invalid_ticket');
      if(typeof verified!=='function')throw Error('qa_verification_required');
      // A failure or unknown result leaves the ticket in place, preventing
      // finalization. External effects must be reconciled before release.
      if(await verified()!==true)throw Error('qa_unverified_external_effect');
      const slots=ticket.accounts.map(()=>'?').join(',');
      // Require the provided account set to match the WHOLE ledger entry.
      // Each count is checked inside the SAME DELETE statement; a forged
      // subset must not erase one leg of a multi-user notification.
      const rows=await all(db,
        'DELETE FROM qa_privileged_operations WHERE operation_id = ? AND kind = ? '+
        'AND uid IN ('+slots+') '+
        'AND (SELECT COUNT(*) FROM qa_privileged_operations '+
        'WHERE operation_id = ? AND kind = ?) = ? '+
        'AND (SELECT COUNT(*) FROM qa_privileged_operations '+
        'WHERE operation_id = ? AND kind = ? AND uid IN ('+slots+')) = ? '+
        'RETURNING uid',
        ticket.id,ticket.kind,...ticket.accounts,
        ticket.id,ticket.kind,ticket.accounts.length,
        ticket.id,ticket.kind,...ticket.accounts,ticket.accounts.length);
      if(rows.length!==ticket.accounts.length)
        throw Error('qa_ticket_already_closed_or_forged');
      return true;
    },
    async beginFreeze(uid){
      checkUid(uid);
      const row=await first(db,
        "UPDATE qa_privileged_accounts SET state = 'draining' "+
        "WHERE uid = ? AND state = 'active' RETURNING state",uid);
      if(!row)throw Error('qa_freeze_not_available');
      return 'draining';
    },
    async finalizeFreeze(uid){
      checkUid(uid);
      const row=await first(db,
        "UPDATE qa_privileged_accounts SET state = 'frozen' "+
        "WHERE uid = ? AND state = 'draining' "+
        "AND NOT EXISTS (SELECT 1 FROM qa_privileged_operations WHERE uid = ?) "+
        "RETURNING state",uid,uid);
      if(!row)throw Error('qa_inflight_or_not_draining');
      return 'frozen';
    },
    async status(uid){
      checkUid(uid);
      const row=await first(db,
        'SELECT a.state, (SELECT COUNT(*) FROM qa_privileged_operations o '+
        'WHERE o.uid=a.uid) AS open FROM qa_privileged_accounts a WHERE a.uid=?',uid);
      if(!row||!['active','draining','frozen'].includes(row.state)||
        !Number.isSafeInteger(row.open)||row.open<0)
        throw Error('qa_bad_state');
      return Object.freeze({state:row.state,inFlight:row.open});
    }
  });
}

/** A QA-only mock of a privileged Worker operation.
 * Unknown outcomes intentionally leave the ticket open for reconciliation.
 */
export async function runQaPrivilegedOperation(barrier,kind,scope,{effect,verify}={}){
  if(typeof barrier?.begin!=='function'||typeof barrier?.complete!=='function'||
    typeof effect!=='function'||typeof verify!=='function')
    throw Error('qa_invalid_execution_adapter');
  const ticket=await barrier.begin(kind,scope);
  await effect();
  await barrier.complete(ticket,{verified:verify});
  return Object.freeze({status:'qa_simulated_only',productionReady:false});
}
