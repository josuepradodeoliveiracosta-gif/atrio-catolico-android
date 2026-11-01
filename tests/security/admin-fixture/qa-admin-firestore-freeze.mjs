/**
 * QA ONLY — durable, Firestore-backed write freeze enforced by an
 * explicitly participating Firebase Admin SDK writer.
 *
 * Firestore Security Rules protect clients; Admin SDK and Workers bypass
 * those rules, so every privileged writer must opt in to the same guard.
 * This fixture demonstrates the protocol in a local emulator; it neither
 * wraps nor secures the real production Workers.
 *
 * No freeze removal endpoint is provided: the marker remains after QA
 * deletion, so a missed writer cannot resurrect the deleted account.
 */
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';

const PROJECT='demo-atrio-v11';
const A='qa-delete-alice',B='qa-delete-bob';
const APP='qa-atrio-admin-freeze-only';
function fail(reason){throw Error('qa_admin_freeze_'+reason);}
function guard(){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089' ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099' ||
     process.env.FIREBASE_CONFIG ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.GOOGLE_CLOUD_PROJECT ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.CLOUDINARY_API_KEY ||
     process.env.CLOUDINARY_CLOUD_NAME ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    fail('real_environment_denied');
}
function allow(uid){
  if(uid!==A && uid!==B)fail('unlisted_uid');
}
function markerValid(data){
  return data?.uid===A && data?.status==='processing' &&
    data?.scope==='qa-only' && data?.generation===1;
}
export function createQaAdminFirestoreFreezeAdapter(){
  guard();
  const app=initializeApp({projectId:PROJECT},APP);
  const db=getFirestore(app); // MUST pick up FIRESTORE_EMULATOR_HOST.
  let disposed=false;
  function ready(){guard();if(disposed)fail('disposed');}
  const freezeRef=uid=>db.doc('account_deletion_freeze/'+uid);
  return Object.freeze({
    async acquire(uid){
      ready();
      if(uid!==A)fail('other_user_freeze_denied');
      const ref=freezeRef(uid);
      const request=db.doc('account_deletion_requests/'+uid);
      // Atomically bind the freeze to a fresh request; never accept an
      // owner-supplied "approved" marker or edit an existing marker.
      await db.runTransaction(async transaction=>{
        ready();
        const ask=await transaction.get(request);
        const locked=await transaction.get(ref);
        if(!ask.exists || ask.data()?.status!=='requested')
          fail('verified_request_required');
        if(locked.exists){
          if(!markerValid(locked.data()))fail('existing_marker_mismatch');
          return; // durable idempotent recovery after crash.
        }
        transaction.create(ref,{
          uid,status:'processing',scope:'qa-only',generation:1,
          createdAt:new Date('2026-10-31T12:00:00Z')
        });
      },{maxAttempts:3});
      ready();
      return this.verify(uid);
    },
    async verify(uid){
      ready();
      if(uid!==A)fail('other_user_verify_denied');
      const snapshot=await freezeRef(uid).get();
      ready();
      if(!snapshot.exists || !markerValid(snapshot.data()))
        fail('missing_or_invalid_freeze');
      return true;
    },
    async guardedWrite(uid,documentId){
      ready();allow(uid);
      if(!['before','after','bobAfter','racing'].includes(documentId))
        fail('unapproved_write_fixture');
      const ref=db.doc('users/'+uid+'/pushDevices/'+documentId);
      const frozen=freezeRef(uid);
      // A single Firestore transaction observes freeze and publishes
      // the write, rejecting the write if the marker exists. If another
      // transaction inserts the marker in between, Firestore retries.
      await db.runTransaction(async transaction=>{
        ready();
        const marker=await transaction.get(frozen);
        if(marker.exists)fail('privileged_write_frozen');
        transaction.set(ref,{
          token:'qa-push-token-fictitious-'+documentId,
          uid,origin:'admin-fixture-only'
        });
      },{maxAttempts:3});
      ready();
      return true;
    },
    async existsWrite(uid,documentId){
      ready();allow(uid);
      if(!['before','after','bobAfter','racing'].includes(documentId))
        fail('unapproved_write_fixture');
      const snap=await db.doc('users/'+uid+'/pushDevices/'+documentId).get();
      ready();
      return snap.exists;
    },
    async close(){
      if(!disposed){
        disposed=true;
        await deleteApp(app);
      }
    }
  });
}
export const QA_FREEZE_UIDS=Object.freeze({alice:A,bob:B});
