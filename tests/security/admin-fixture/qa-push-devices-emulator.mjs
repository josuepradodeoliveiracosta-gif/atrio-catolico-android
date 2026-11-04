/**
 * LOCAL EMULATOR ONLY: privileged cleanup of synthetic Firestore pushDevices.
 * The production Push Worker devices() filters sendable tokens; deletion must
 * instead enumerate ALL document records, even empty, stale or invalid tokens.
 *
 * NO live Firebase, FCM, Cloudinary, Auth deletion or production credential.
 * No import path from Android or Cloudflare runtime. A failed version
 * precondition must abort the entire batch, not delete a newer registration.
 */
import {FieldPath} from 'firebase-admin/firestore';

const PROJECT='demo-atrio-v11';
const ALICE='qa-push-revoke-alice';
const BOB='qa-push-revoke-bob';
const CASE='fa00bbaa-4a09-4fd2-b399-001122334455';
const DEVICE=/^qa-device-[a-z0-9-]{1,40}$/;
const PAGE_SIZE=10,MAX_PAGES=8,MAX_DOCS=64;

function fail(reason){throw Error('qa_push_admin_'+reason);}
function guard(db){
  const env=process.env;
  if(env.GCLOUD_PROJECT!==PROJECT||
     env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
     env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
     env.FIREBASE_CONFIG||env.GOOGLE_APPLICATION_CREDENTIALS||
     env.FIREBASE_SERVICE_ACCOUNT_JSON||env.GOOGLE_CLOUD_PROJECT||
     env.GCLOUD_PROJECT_ID||env.CLOUDINARY_API_SECRET||
     env.CLOUDINARY_API_KEY||env.CLOUDINARY_CLOUD_NAME||
     env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED||
     db?.projectId!==PROJECT||
     typeof db.batch!=='function'||typeof db.collection!=='function')
    fail('environment_not_disposable_emulator');
}
function allow(uid){
  if(uid!==ALICE&&uid!==BOB)fail('foreign_uid');
}
function ref(db,uid){
  allow(uid);
  return db.collection('users').doc(uid).collection('pushDevices');
}
async function inventory(db,uid){
  guard(db);allow(uid);
  const found=[],seen=new Set();let cursor=null;
  for(let page=0;page<MAX_PAGES;page++){
    let query=ref(db,uid).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if(cursor)query=query.startAfter(cursor);
    const snap=await query.get();
    if(!snap||!Array.isArray(snap.docs)||snap.docs.length>PAGE_SIZE)
      fail('incomplete_inventory');
    for(const doc of snap.docs){
      if(!doc.exists||!DEVICE.test(doc.id)||
        doc.ref?.path!=='users/'+uid+'/pushDevices/'+doc.id||
        !doc.updateTime||typeof doc.updateTime.toMillis!=='function'||
        seen.has(doc.id))fail('unexpected_device_record');
      seen.add(doc.id);
      // NEVER read or return token or other document field content.
      found.push({ref:doc.ref,version:doc.updateTime,
        key:doc.id+':'+doc.updateTime.seconds+':'+doc.updateTime.nanoseconds});
      if(found.length>MAX_DOCS)fail('inventory_limit_exceeded');
    }
    if(snap.docs.length<PAGE_SIZE)return found;
    if(snap.docs.length===0)return found;
    cursor=snap.docs.at(-1);
  }
  fail('incomplete_pagination');
}
async function requireFreeze(db){
  guard(db);
  const [lock,request]=await Promise.all([
    db.doc('account_deletion_freeze/'+ALICE).get(),
    db.doc('account_deletion_requests/'+ALICE).get()
  ]);
  if(!lock.exists||!request.exists||
     lock.data()?.uid!==ALICE||lock.data()?.caseId!==CASE||
     lock.data()?.state!=='frozen'||lock.data()?.epoch!==1||
     request.data()?.status!=='requested'||request.data()?.source!=='android')
    fail('freeze_or_request_missing');
}
function same(a,b){
  return a.length===b.length&&a.every((v,i)=>v.key===b[i].key);
}
export const QA_PUSH_DEVICE_UIDS=Object.freeze({alice:ALICE,bob:BOB});
export const QA_PUSH_DEVICE_CASE=CASE;

/**
 * The injected hooks are allowed ONLY in an emulator fixture to force
 * changes before the second inventory or just before Firestore batch commit.
 * Neither hook grants permission to delete a record.
 */
export async function reconcileQaPushDeviceDocsEmulator({
  db,uid,caseId,beforeCommitForQa,beforeBatchCommitForQa
}={}){
  guard(db);
  if(uid!==ALICE||caseId!==CASE||
     (beforeCommitForQa!==undefined&&
      typeof beforeCommitForQa!=='function')||
     (beforeBatchCommitForQa!==undefined&&
      typeof beforeBatchCommitForQa!=='function'))
    fail('unapproved_account_case');
  await requireFreeze(db);
  const [owned,neighbor]=await Promise.all([
    inventory(db,ALICE),inventory(db,BOB)
  ]);
  if(!owned.length||!neighbor.length)
    fail('baseline_must_include_both_accounts');
  await requireFreeze(db);
  if(beforeCommitForQa)await beforeCommitForQa();
  await requireFreeze(db);
  // A new device or a neighbor edit after the original inventory must
  // prevent the owner's destructive batch, not merely fail the readback
  // AFTER some documents were already removed. Recheck all versions in
  // both namespaces and treat any drift as a request for new review.
  const [latestOwned,latestNeighbor]=await Promise.all([
    inventory(db,ALICE),inventory(db,BOB)
  ]);
  if(!same(owned,latestOwned)||!same(neighbor,latestNeighbor))
    fail('precommit_inventory_changed');
  await requireFreeze(db);
  guard(db);
  const batch=db.batch();
  for(const item of owned)
    batch.delete(item.ref,{lastUpdateTime:item.version});
  // Only the synthetic test suite may race a write in the tiny window
  // AFTER the last inventory and BEFORE the atomic versioned commit.
  // Firestore lastUpdateTime CAS must then abort the entire batch.
  if(beforeBatchCommitForQa)await beforeBatchCommitForQa();
  await requireFreeze(db);
  guard(db);
  // The Emulator's Firestore WriteBatch is atomic. A concurrent update
  // invalidates the entire batch (FAILED_PRECONDITION).
  await batch.commit();
  for(let pass=0;pass<2;pass++){
    await requireFreeze(db);
    const [after,control]=await Promise.all([
      inventory(db,ALICE),inventory(db,BOB)
    ]);
    if(after.length!==0||!same(neighbor,control))
      fail('residual_or_neighbor_changed');
  }
  return Object.freeze({
    status:'qa_emulator_device_documents_removed',
    syntheticOwnedDocsDeleted:owned.length,
    neighborPreserved:true,
    independentReadbacks:2,
    staleAndInvalidTokenDocsIncluded:true,
    realFcmTokenRevocationVerified:false,
    legacyTopicSubscriptionsVerified:false,
    productionWorkerFenceVerified:false,
    cloudinaryRemoteDeletionVerified:false,
    playReleaseAuthorized:false
  });
}
