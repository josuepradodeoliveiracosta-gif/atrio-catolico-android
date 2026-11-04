import test from 'node:test';
import assert from 'node:assert/strict';
import {assessQaHostedStagePromotion} from './qa-hosted-stage-promotion-gate.js';

const SHA='0baaf7cc46847baec89314041b9b3396fa8e714c';
const A='8d2b5461-f839-49bd-8f2b-3300c58eb6a6';
const STAGE='atrio-privacy-freeze-qa-internal';
const roles=['avatar','guardian','push'];
const uuid='fa00bbaa-4a09-4fd2-b399-001122334455';
const bindings=(role)=>{
  if(role==='stage')return [
    {name:'ATRIO_PRIVACY_STAGE_ID',type:'plain_text'},
    {name:'STAGE_FREEZE_DB',type:'d1',
      databaseName:'atrio-privacy-freeze-stage-fixtures'},
    ...['ADMIN','AVATAR','GUARDIAN','PUSH','RECONCILER'].map(x=>({
      name:'STAGE_'+x+'_HMAC',type:'secret_text'
    }))
  ];
  return [
    {name:'ATRIO_QA_CONSUMER_FIXTURE',type:'plain_text'},
    {name:'ATRIO_QA_CONSUMER_HMAC',type:'secret_text'},
    {name:'ATRIO_QA_CONSUMER_ROLE',type:'plain_text'},
    {name:'PRIVACY_FREEZE_STAGE',type:'service',service:STAGE}
  ];
};
function observation(){
  const workers=[{name:STAGE,role:'stage'},...roles.map(role=>({
    name:'atrio-privacy-qa-client-'+role,role
  }))].map(x=>({
    name:x.name,commit:SHA,versionId:uuid,deployedVersionId:uuid,
    subdomainEnabled:false,previewEnabled:false,
    zoneRoutesAudited:true,zoneRoutesCount:0,cronCount:0,
    bindings:bindings(x.role)
  }));
  return {
    candidateCommit:SHA,workers,
    artifact:{commit:SHA,sha256:'a'.repeat(64),
      independentReviewVerified:true},
    productionWorkers:['atrio-avatares','atrio-guardian-v2','atrio-push']
      .map(name=>({name,qaStageServiceBindingPresent:false})),
    fixtureDb:{name:'atrio-privacy-freeze-stage-fixtures',
      verifiedReadOnly:true,fixtureAccountCount:2,
      pendingOperations:0,frozenWithPending:0}
  };
}
test('even a perfect QA metadata preflight cannot approve deletion or deployment',()=>{
  const x=assessQaHostedStagePromotion(observation());
  assert.equal(x.state,'metadata_preflight_only');
  assert.equal(x.qaStageReadyForManualReview,true);
  assert.equal(x.hostedCodeDeployedByThisCheck,false);
  assert.equal(x.productionIntegrated,false);
  assert.equal(x.destructiveOperationsAuthorized,false);
  assert.equal(x.googlePlayReleaseAuthorized,false);
});
test('the actually observed older QA stage deployment has no commit provenance',()=>{
  const x=observation();
  x.workers[0].versionId=A;
  x.workers[0].deployedVersionId=A;
  x.workers[0].commit=null; // API version annotations lack commit
  const result=assessQaHostedStagePromotion(x);
  assert.equal(result.state,'blocked');
  assert.ok(result.blockers.includes('stage:code_provenance_missing'));
});
test('missing audited zone routes fails closed even with workers.dev disabled',()=>{
  const x=observation();
  x.workers[2].zoneRoutesAudited=false;
  assert.ok(assessQaHostedStagePromotion(x).blockers.includes(
    'guardian:public_exposure_not_disproven'));
});
test('unexpected D1 or a secret value in metadata is rejected',()=>{
  for(const replacement of [
    {name:'STAGE_FREEZE_DB',type:'d1',databaseName:'atrio-push-delivery'},
    {name:'STAGE_ADMIN_HMAC',type:'secret_text',value:'never-include-this'}
  ]){
    const x=observation();
    x.workers[0].bindings=x.workers[0].bindings.map(b=>
      b.name===replacement.name?replacement:b);
    assert.ok(assessQaHostedStagePromotion(x).blockers.includes(
      'stage:bindings_not_verified'));
  }
});
test('unreconciled tickets and incomplete fixture accounts block manual promotion',()=>{
  for(const patch of [{pendingOperations:1},{frozenWithPending:1},
    {fixtureAccountCount:1},{verifiedReadOnly:false}]){
    const x=observation();Object.assign(x.fixtureDb,patch);
    assert.ok(assessQaHostedStagePromotion(x).blockers.includes(
      'stage_d1:fixture_ledger_not_clean'));
  }
});
test('public endpoints, triggers or production QA bindings always block',()=>{
  const x=observation();
  x.workers[1].subdomainEnabled=true;
  x.workers[2].cronCount=1;
  x.productionWorkers[2].qaStageServiceBindingPresent=true;
  const blockers=assessQaHostedStagePromotion(x).blockers;
  assert.ok(blockers.includes('avatar:public_exposure_not_disproven'));
  assert.ok(blockers.includes('guardian:cron_not_verified_disabled'));
  assert.ok(blockers.includes('production:atrio-push:qa_binding_not_disproven'));
});
test('reject duplicate service names and malformed commit before any approval',()=>{
  const x=observation();x.workers[1].name=STAGE;
  assert.throws(()=>assessQaHostedStagePromotion(x),/invalid:worker_set/);
  const y=observation();y.candidateCommit='unknown';
  assert.throws(()=>assessQaHostedStagePromotion(y),/invalid:shape/);
});
