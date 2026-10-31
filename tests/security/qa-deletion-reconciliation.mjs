/**
 * QA ONLY: independent, fresh pre-Auth / post-Auth reconciliation against the
 * local Firestore Emulator. Never import this in a deployed Worker or Android.
 *
 * Checks all known owned subcollections (including previously unknown document
 * IDs) and relational UID fields, not just the frozen seed list. This DOES NOT
 * establish full production coverage: legacy data, new collection types,
 * external providers, legal holds and cross-service races remain unverified.
 */
import {doc,getDoc,collection,getDocs,collectionGroup,query,where}
  from 'firebase/firestore';
import {OWNED_ROOTS,USER_SUBCOLLECTIONS,GUARDIAN_SUBCOLLECTIONS}
  from '../../cloudflare/account-deletion-audit/src/deletion-orchestrator.js';
import {RELATIONAL_QUERY_SPECS}
  from '../../cloudflare/account-deletion-audit/src/relational-inventory.js';

const UID='qa-delete-alice';
const PROJECT='demo-atrio-v11';
const HOST='127.0.0.1:8089';
const MEDIA='atrio-avatares/qa-delete-alice/123e4567-e89b-42d3-a456-426614174001';

function guard(uid,db,media,auth,context) {
  if(process.env.FIRESTORE_EMULATOR_HOST!==HOST ||
     process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    throw Error('qa_reconciliation_local_emulator_required');
  if(uid!==UID || !db || !(media instanceof Set) ||
    !(auth instanceof Set) || context?.writesFrozen!==true)
    throw Error('qa_reconciliation_untrusted_context');
}
function empty(snapshot){
  if(!snapshot || typeof snapshot.empty!=='boolean')
    throw Error('qa_reconciliation_invalid_read');
  if(!snapshot.empty)throw Error('qa_reconciliation_residual_firestore');
}
async function absent(db,path){
  const result=await getDoc(doc(db,path));
  if(result.exists())throw Error('qa_reconciliation_residual_firestore');
}

/**
 * Recheck from Firestore, not the deletion journal/checkpoint. The query
 * contract is intentionally exhaustive only for KNOWN UID indexed fields;
 * any failure to query prevents mock Auth removal (fail closed).
 *
 * expectedAuth is about the fake Set, NOT Firebase Authentication.
 */
export async function assertQaReconciled({
  uid,db,media,auth,context,expectedAuth='either'
}={}) {
  guard(uid,db,media,auth,context);
  if(!['present','absent','either'].includes(expectedAuth))
    throw Error('qa_reconciliation_invalid_auth_expectation');
  if(expectedAuth==='present' && !auth.has(UID))
    throw Error('qa_reconciliation_auth_missing');
  if(expectedAuth==='absent' && auth.has(UID))
    throw Error('qa_reconciliation_auth_remaining');

  const request=await getDoc(doc(db,'account_deletion_requests/'+UID));
  if(!request.exists() || request.data()?.status!=='requested')
    throw Error('qa_reconciliation_request_invalid');

  for(const root of OWNED_ROOTS)await absent(db,root+'/'+UID);

  for(const subcollection of USER_SUBCOLLECTIONS)
    empty(await getDocs(collection(db,'users/'+UID+'/'+subcollection)));
  for(const subcollection of GUARDIAN_SUBCOLLECTIONS)
    empty(await getDocs(collection(db,'guardian_notices/'+UID+'/'+subcollection)));

  // Independent full collectionGroup queries in the disposable QA database.
  // Any document referencing Alice in an indexed known field is a blocker,
  // even if it is in another person's records or was created after cleanup.
  for(const spec of RELATIONAL_QUERY_SPECS){
    const found=await getDocs(query(collectionGroup(db,spec.collectionGroup),
      where(spec.field,'==',UID)));
    empty(found);
  }

  if(media.has(MEDIA))throw Error('qa_reconciliation_residual_media');
  return Object.freeze({
    state:'qa_reconciled_known_scopes_only',
    productionReady:false,
    globalCoverageComplete:false,
    firebaseAuthActuallyChecked:false,
    cloudinaryActuallyChecked:false
  });
}
