import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewQaAutomaticPreflight} from '../../cloudflare/push-worker/scripts/qa-automatic-preflight-review.mjs';
const now=Date.now();
const good={observedAt:now,projectId:'atrio-catolico-qa-general',workerName:'atrio-push-qa-general',databaseId:'dc88db76-99c2-46d0-b5e3-df68152c564d',workersPlan:'free',firebaseBillingEnabled:false,
 deploymentId:'af89cc1b-2ef9-443a-a38d-e60673b2ad17',versionId:'6fcc1921-05da-4395-ae36-b8215eff8d1b',singleVersion:true,cronCount:0,
 firestoreReadsRemaining:15000,d1RowsReadRemaining:200000,d1RowsWrittenRemaining:20000,workerRequestsRemaining:1000,
 secretIdentityVerified:true,effectivePermissionsVerified:true,noFirestoreWritePermission:true,authRevocationVerified:true,qaDevicesVerified:true,
 manualQuiesced:true,pendingDrained:true,rollbackVerified:true,abuseProtectionVerified:true,metricsAvailable:true,explicitTrialApproval:true};
test('preflight defaults blocked and never authorizes activation',()=>{
 assert.equal(reviewQaAutomaticPreflight().status,'blocked');
 const r=reviewQaAutomaticPreflight(good,now);assert.equal(r.status,'ready_for_human_review');assert.equal(r.activationAuthorized,false);assert.equal(r.remoteWrites,false);
});
test('each missing, stale, inconsistent or paid assertion blocks',()=>{
 for(const k of Object.keys(good)){const e={...good};delete e[k];assert.equal(reviewQaAutomaticPreflight(e,now).status,'blocked',k)}
 for(const bad of [{observedAt:now-900001},{observedAt:now+1},{workersPlan:'paid'},{firebaseBillingEnabled:true},{cronCount:1},{firestoreReadsRemaining:14999},{d1RowsWrittenRemaining:19999},{secretIdentityVerified:'true'}])
  assert.equal(reviewQaAutomaticPreflight({...good,...bad},now).status,'blocked');
});

test('preflight refuses impossible quota or malformed rollback evidence',()=>{
 for(const patch of [{deploymentId:'-'.repeat(36)},{versionId:'a'.repeat(36)},{firestoreReadsRemaining:50001},
  {d1RowsReadRemaining:5000001},{d1RowsWrittenRemaining:100001},{workerRequestsRemaining:100001}]){
  assert.equal(reviewQaAutomaticPreflight({...good,...patch},now).status,'blocked');
 }
});
