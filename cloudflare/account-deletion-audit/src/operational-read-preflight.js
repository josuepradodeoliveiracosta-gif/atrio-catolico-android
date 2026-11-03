/**
 * Server-side operational read preflight. Composes the existing Firestore
 * REST read-only adapters, with a fresh authenticated deletion request.
 *
 * This is deliberately NOT an HTTP route, a production service, a reviewer
 * identity provider, a full account inventory, or a deletion executor.
 * Every source must be independently reconciled before any destructive work.
 */
import {validUid} from './plan.js';
import {createFirestoreReadAdapter} from './firestore-read-adapter.js';
import {createRelationalFirestoreReadAdapter}
  from './relational-firestore-read-adapter.js';
import {inventoryOwnedDocuments} from './owned-inventory.js';
import {discoverRelationalCandidates,summarizeRelationalCandidates}
  from './relational-inventory.js';
import {readBoundedFirestoreJson} from './bounded-firestore-response.js';

const PROJECT='atrio-catolico';
const ROOT='https://firestore.googleapis.com/v1/projects/'+PROJECT+
  '/databases/(default)/documents';
const TIMESTAMP=/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
const REQUEST_FIELDS=['requestedAt','source','status'];
const UNVERIFIED=Object.freeze([
  'firestore_transactional_snapshot_and_write_freeze',
  'reactions_identified_only_by_document_id',
  'third_party_blocking_and_legacy_references',
  'firebase_auth_and_fcm_registration',
  'cloudinary_objects_and_all_delivery_types',
  'avatar_worker_d1_and_push_worker_d1',
  'guardian_and_report_retention_decisions',
  'other_firestore_databases_and_future_collections',
  'operator_identity_and_retention_authorization'
]);
const fail=reason=>{throw Error('operational_read_preflight_'+reason);};

function exactFields(fields){
  return fields && typeof fields==='object' && !Array.isArray(fields) &&
    Object.keys(fields).sort().join(',')===REQUEST_FIELDS.join(',');
}
async function readRequest(uid,oauthToken,fetcher,now){
  const url=ROOT+'/account_deletion_requests/'+encodeURIComponent(uid);
  const res=await fetcher(url,{method:'GET',redirect:'error',
    headers:{Authorization:'Bearer '+oauthToken,Accept:'application/json'}});
  if(res.status===404)fail('request_missing');
  if(res.status!==200)fail('request_read_unavailable');
  const data=await readBoundedFirestoreJson(res,{
    limit:32768,sizeError:'account_request_too_large',
    parseError:'untrusted_account_request'
  });
  const name='projects/'+PROJECT+'/databases/(default)/documents/'+
    'account_deletion_requests/'+uid;
  if(!data || typeof data!=='object' || Array.isArray(data) ||
     data.name!==name || !exactFields(data.fields) ||
     data.fields.status?.stringValue!=='requested' ||
     !['android','web'].includes(data.fields.source?.stringValue))
    fail('request_not_verified');
  const at=data.fields.requestedAt?.timestampValue;
  const millis=typeof at==='string'&&TIMESTAMP.test(at)?Date.parse(at):NaN;
  if(!Number.isFinite(millis)||millis>now.getTime() ||
    millis<Date.parse('2020-01-01T00:00:00.000Z'))
    fail('request_timestamp_invalid');
  return true; // Never return request content, UID or metadata.
}

/**
 * Requires an independently authenticated operator, an IAM-restricted OAuth
 * token from backend infrastructure, and an explicit authorization callback.
 * Passing a callback does NOT prove the caller's identity: this must remain
 * inaccessible to clients until integrated with real IAM.
 *
 * Does only Firestore REST document reads, :listCollectionIds and :runQuery.
 * The latter two use POST as READ operations; never :commit or :batchWrite.
 */
export async function inspectOperationalDeletionReadSources({
  uid,oauthToken,projectId=PROJECT,fetcher=fetch,
  assertAuthorizedRead,now=new Date()
}={}){
  if(projectId!==PROJECT)fail('unexpected_project');
  if(!validUid(uid))fail('invalid_uid');
  if(typeof oauthToken!=='string'||oauthToken.length<20||
    oauthToken.length>4096||/[\s\x00-\x1f]/.test(oauthToken))
    fail('invalid_backend_token');
  if(typeof fetcher!=='function'||typeof assertAuthorizedRead!=='function'||
    !(now instanceof Date)||!Number.isFinite(now.getTime()))
    fail('missing_trusted_backend');
  let checks=0;
  const authorize=async()=>{
    if(await assertAuthorizedRead()!==true)
      fail('operator_authorization_lost');
    checks++;
  };
  // This wrapper closes the transport to Firestore's reviewed read-only
  // endpoints, regardless of how the underlying fetcher is implemented.
  const readTransport=(url,options)=>{
    const endpoint=String(url),method=options?.method;
    const allowed=endpoint.startsWith(ROOT+'/') &&
      ((method==='GET' && !endpoint.includes(':')) ||
       (method==='POST' && endpoint.endsWith(':listCollectionIds'))) ||
      (endpoint===ROOT+':runQuery' && method==='POST');
    if(!allowed)fail('unexpected_firestore_endpoint');
    return fetcher(url,options);
  };
  await authorize();
  await readRequest(uid,oauthToken,readTransport,now);
  await authorize();
  const owned=await inventoryOwnedDocuments(uid,
    createFirestoreReadAdapter(uid,oauthToken,readTransport));
  await authorize();
  if(owned.directReadCompleted!==true || owned.pagesComplete!==false ||
     owned.ownedNestedTreeScanComplete!==true ||
     owned.directRootSubcollectionDiscoveryComplete!==true)
    fail('owned_tree_not_exhaustively_scanned');
  const relational=await discoverRelationalCandidates(uid,
    createRelationalFirestoreReadAdapter(uid,oauthToken,readTransport));
  await authorize();
  const cross=summarizeRelationalCandidates(relational);
  if(relational.safeToExecute!==false ||
    relational.globalCoverageComplete!==false ||
    cross.safeToExecute!==false)
    fail('untrusted_relational_summary');
  const unverified=[...new Set([...UNVERIFIED,...relational.unverifiedScopes])].sort();
  // Counts only; no raw documents, report text, account identifier, OAuth
  // token, Cloudinary ID, D1 row, device token or review evidence is returned.
  return Object.freeze({
    status:'read_only_review_required',
    accountRequestReadFromFirestore:true,
    firestoreOwnedRootDocumentsAndDescendants:owned.documents.length,
    ownedNestedCollectionCount:owned.nestedOwnedCollectionCount,
    unexpectedDirectSubcollectionCount:
      owned.unknownDirectSubcollections.length,
    firestoreRelationalReferences:relational.findings.length,
    relationalKinds:Object.freeze({...cross.groups}),
    queriedRelationalScopeCount:relational.queriedScopes.length,
    authorizationRechecks:checks,
    unresolvedScopes:Object.freeze(unverified),
    firestoreReadSourcesExercised:true,
    otherDataSourcesRead:false,
    transactionalSnapshotVerified:false,
    allAccountDataDiscovered:false,
    thirdPartyRetentionReviewed:false,
    operatorIdentityIndependentlyVerified:false,
    liveDeploymentConnected:false,
    destructiveOperationsEnabled:false,
    accountDeletionAuthorized:false,
    googlePlayReleaseAuthorized:false
  });
}
