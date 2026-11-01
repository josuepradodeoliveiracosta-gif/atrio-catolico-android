/**
 * QA ONLY: bind a disposable SQLite deletion journal to the exact initial
 * Firestore Emulator request. No production credentials, Firestore writes,
 * live Auth, routes, or external deletion service.
 *
 * Neither status alone nor UID alone is sufficient to resume a journal.
 * A future production service MUST use a server-created immutable request ID
 * and an authenticated, durable cross-service fencing generation.
 */
import {doc,getDoc} from 'firebase/firestore';

const UID='qa-delete-alice';
const PROJECT='demo-atrio-v11';
const HOST='127.0.0.1:8089';

function guard(db,journal,uid){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIRESTORE_EMULATOR_HOST!==HOST ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     uid!==UID || !db ||
     typeof journal?.exec!=='function' ||
     typeof journal?.prepare!=='function')
    throw Error('qa_request_binding_emulator_only');
}
function normalize(data){
  const timestamp=data?.requestedAt;
  const date=timestamp?.toDate?.();
  if(data?.status!=='requested' ||
     !['android','web'].includes(data?.source) ||
     !(date instanceof Date) || !Number.isFinite(date.getTime()))
    throw Error('qa_request_binding_invalid_request');
  return Object.freeze({
    uid:UID,source:data.source,requestedAt:date.toISOString()
  });
}
export async function verifyBoundQaRequest({db,journal,uid=UID,approvedRequest=null,
  approvedCaseId=null}={}){
  guard(db,journal,uid);
  const snapshot=await getDoc(doc(db,'account_deletion_requests/'+UID));
  if(!snapshot.exists())
    throw Error('qa_request_binding_missing_request');
  const current=normalize(snapshot.data());
  if(approvedRequest!==null &&
     (!approvedRequest || Object.getPrototypeOf(approvedRequest)!==Object.prototype ||
      Object.keys(approvedRequest).sort().join(',')!=='requestedAt,source' ||
      current.source!==approvedRequest.source ||
      current.requestedAt!==approvedRequest.requestedAt))
    throw Error('qa_request_binding_approval_mismatch');
  journal.exec('CREATE TABLE IF NOT EXISTS qa_deletion_request_binding ('+
    'uid TEXT PRIMARY KEY, source TEXT NOT NULL, requested_at TEXT NOT NULL)');
  let previous=journal.prepare(
    'SELECT uid,source,requested_at FROM qa_deletion_request_binding WHERE uid=?'
  ).get(UID);
  if(!previous){
    // An old checkpoint journal without a request binding must NEVER resume:
    // the operator would be reusing a stale decision from another request.
    const count=journal.prepare(
      'SELECT COUNT(*) AS n FROM qa_deletion_checkpoints'
    ).get();
    if(!count || !Number.isSafeInteger(count.n) || count.n!==0)
      throw Error('qa_request_binding_missing_on_resume');
    journal.prepare(
      'INSERT OR IGNORE INTO qa_deletion_request_binding '+
      '(uid,source,requested_at) VALUES(?,?,?)'
    ).run(UID,current.source,current.requestedAt);
    previous=journal.prepare(
      'SELECT uid,source,requested_at FROM qa_deletion_request_binding WHERE uid=?'
    ).get(UID);
  }
  if(previous?.uid!==UID ||
     previous.source!==current.source ||
     previous.requested_at!==current.requestedAt)
    throw Error('qa_request_binding_changed');

  // QA admin: checkpoints belong to ONE UUID case, not merely a UID/time.
  // Direct fixture runner without administrative case remains test-only.
  journal.exec('CREATE TABLE IF NOT EXISTS qa_deletion_case_binding ('+
    'uid TEXT PRIMARY KEY,case_id TEXT NOT NULL)');
  const attached=journal.prepare(
    'SELECT case_id FROM qa_deletion_case_binding WHERE uid=?').get(UID);
  if(approvedCaseId===null){
    if(attached)throw Error('qa_request_binding_case_required');
  } else {
    if(typeof approvedCaseId!=='string' ||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(approvedCaseId))
      throw Error('qa_request_binding_invalid_case_id');
    if(!attached){
      const checkpoints=journal.prepare(
        'SELECT COUNT(*) AS n FROM qa_deletion_checkpoints').get();
      if(checkpoints?.n!==0)
        throw Error('qa_request_binding_case_missing_on_resume');
      journal.prepare(
        'INSERT OR IGNORE INTO qa_deletion_case_binding (uid,case_id) VALUES (?,?)'
      ).run(UID,approvedCaseId);
    }
    const confirmed=journal.prepare(
      'SELECT case_id FROM qa_deletion_case_binding WHERE uid=?').get(UID);
    if(confirmed?.case_id!==approvedCaseId)
      throw Error('qa_request_binding_case_changed');
  }
  return Object.freeze({matchesInitialRequest:true,productionReady:false});
}
