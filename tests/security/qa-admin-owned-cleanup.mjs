/**
 * Isolated QA administrative cleanup of OWNER-SCOPED subcollections.
 *
 * Uses the real Firestore Emulator only. Never import into a Worker,
 * Android build or production release. Cross-account references, public
 * content, moderator cases and legal-retention material are NOT purged here.
 * A fresh, separate reconciliation must still run before the Auth fixture.
 */
import {collection,getDocs,deleteDoc} from 'firebase/firestore';
import {USER_SUBCOLLECTIONS,GUARDIAN_SUBCOLLECTIONS}
  from '../../cloudflare/account-deletion-audit/src/deletion-orchestrator.js';

const UID='qa-delete-alice';
const PROJECT='demo-atrio-v11';
const HOST='127.0.0.1:8089';
const MAX_PER_COLLECTION=500;
const MAX_TOTAL=2000;

function guard(uid,db,assertLease) {
  if(uid!==UID || !db || typeof assertLease!=='function' ||
     process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIRESTORE_EMULATOR_HOST!==HOST ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.CLOUDINARY_API_KEY)
    throw Error('qa_owned_cleanup_environment_denied');
}
function collections(uid){
  return [
    ...USER_SUBCOLLECTIONS.map(child=>'users/'+uid+'/'+child),
    ...GUARDIAN_SUBCOLLECTIONS.map(child=>'guardian_notices/'+uid+'/'+child)
  ];
}
async function snapshotCollection(db,name,assertLease){
  assertLease();
  const snapshot=await getDocs(collection(db,name));
  assertLease();
  if(typeof snapshot?.size!=='number' || snapshot.size>MAX_PER_COLLECTION ||
     !Array.isArray(snapshot.docs) || snapshot.docs.length!==snapshot.size)
    throw Error('qa_owned_cleanup_unbounded_collection');
  for(const doc of snapshot.docs){
    if(doc?.ref?.parent?.path!==name ||
       !doc.ref.path.startsWith(name+'/') ||
       doc.ref.path.split('/').length!==name.split('/').length+1)
      throw Error('qa_owned_cleanup_unexpected_path');
  }
  return snapshot.docs;
}
export async function inventoryQaOwnedCollections({
  uid=UID,db,assertLease=()=>{}
}={}) {
  guard(uid,db,assertLease);
  const docs=[];
  for(const name of collections(uid)){
    const found=await snapshotCollection(db,name,assertLease);
    docs.push(...found);
    if(docs.length>MAX_TOTAL)
      throw Error('qa_owned_cleanup_unbounded_total');
  }
  // This includes private document refs (never expose outside the QA runner).
  return docs;
}
export async function assertQaOwnedCollectionsEmpty(input={}){
  const found=await inventoryQaOwnedCollections(input);
  if(found.length!==0)throw Error('qa_owned_cleanup_residual_documents');
  return true;
}
export async function purgeQaOwnedCollections(input={}){
  const {uid=UID,db,assertLease=()=>{}}=input;
  guard(uid,db,assertLease);
  const found=await inventoryQaOwnedCollections({uid,db,assertLease});
  for(const document of found){
    // A lease check is intentionally done on EACH document, not once per phase.
    // A remote delete already in-flight cannot be fenced by this local check.
    assertLease();
    await deleteDoc(document.ref);
    assertLease();
  }
  await assertQaOwnedCollectionsEmpty({uid,db,assertLease});
  return Object.freeze({state:'qa_owned_fixture_purged',
    count:found.length,productionReady:false});
}
