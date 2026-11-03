/**
 * QA ONLY: independent, fresh pre-Auth / post-Auth reconciliation against the
 * local Firestore Emulator. Never import this in a deployed Worker or Android.
 *
 * Checks all known owned subcollections (including previously unknown document
 * IDs) and relational UID fields, not just the frozen seed list. This DOES NOT
 * establish full production coverage: legacy data, new collection types,
 * external providers, legal holds and cross-service races remain unverified.
 */
import {doc,getDoc,collection,getDocs,collectionGroup,query,where,limit}
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

  // New UGC block references encode their target UID in the document ID,
  // not an indexed field. Scan the *entire small QA collection group* and
  // reject unresolved cross-account references before mock Auth deletion.
  // This is NOT a scalable production inventory and proves no real coverage.
  const blockedMemberDocs=await getDocs(query(
    collectionGroup(db,'blockedMembers'),limit(2001)));
  if(blockedMemberDocs.size>2000 || !Array.isArray(blockedMemberDocs.docs) ||
     blockedMemberDocs.docs.length!==blockedMemberDocs.size)
    throw Error('qa_reconciliation_blocked_members_scan_unbounded');
  for(const blocked of blockedMemberDocs.docs){
    const parts=blocked.ref.path.split('/');
    if(parts.length!==4 || parts[0]!=='users' || parts[2]!=='blockedMembers')
      throw Error('qa_reconciliation_blocked_members_invalid_path');
    if(parts[3]===UID)
      throw Error('qa_reconciliation_residual_firestore');
  }

  // Firestore Security Rules create UGC identifiers in DOCUMENT NAMES:
  // reporterUid_post_*, reporterUid_reply_*, and reporterUid_user_targetUid.
  // A field-only query cannot find a retained moderation case once its
  // reporterUid/targetUid fields are removed. Keep Auth until identifiers
  // embedded in document IDs have been legally adjudicated.
  const MAX_ID_SCOPED=2000;
  async function boundedCollectionIdScan(ref,name){
    const snapshot=await getDocs(query(ref,limit(MAX_ID_SCOPED+1)));
    if(!snapshot || !Array.isArray(snapshot.docs) ||
       snapshot.size!==snapshot.docs.length || snapshot.size>MAX_ID_SCOPED)
      throw Error('qa_reconciliation_unbounded_document_ids:'+name);
    return snapshot.docs;
  }
  const postsReports=await boundedCollectionIdScan(collection(db,'reports'),'reports');
  for(const item of postsReports) {
    if(!item.ref.path.startsWith('reports/') ||
       item.ref.path.split('/').length!==2)
      throw Error('qa_reconciliation_unexpected_report_path');
    if(item.id.startsWith(UID+'_post_') || item.id.startsWith(UID+'_reply_'))
      throw Error('qa_reconciliation_residual_firestore');
  }
  const memberReports=await boundedCollectionIdScan(
    collection(db,'user_reports'),'user_reports');
  for(const item of memberReports) {
    if(!item.ref.path.startsWith('user_reports/') ||
       item.ref.path.split('/').length!==2)
      throw Error('qa_reconciliation_unexpected_user_report_path');
    if(item.id.startsWith(UID+'_user_') || item.id.endsWith('_user_'+UID))
      throw Error('qa_reconciliation_residual_firestore');
  }
  // Reactions use the reacting UID as the document ID, not a searchable
  // field. The exact path is posts/*/replies/*/reactions/{uid}.
  const replyReactions=await boundedCollectionIdScan(
    collectionGroup(db,'reactions'),'reactions');
  for(const item of replyReactions) {
    const parts=item.ref.path.split('/');
    if(parts.length!==6 || parts[0]!=='posts' || parts[2]!=='replies' ||
       parts[4]!=='reactions')
      throw Error('qa_reconciliation_unexpected_reaction_path');
    if(item.id===UID) throw Error('qa_reconciliation_residual_firestore');
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
