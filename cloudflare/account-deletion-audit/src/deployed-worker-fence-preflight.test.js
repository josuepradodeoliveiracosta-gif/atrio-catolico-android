import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDeployedWorkerFence}
  from './deployed-worker-fence-preflight.js';

const CAPTURED='2026-11-03T19:59:54.836Z';
const names=['atrio-avatares','atrio-guardian-v2','atrio-push'];
const deployments=[
  '2026-10-29T18:45:37.939Z',
  '2026-10-31T05:17:02.761Z',
  '2026-10-27T10:24:45.535Z'
];
function observation(){
  return {
    capturedAt:CAPTURED,
    workers:names.map((name,i)=>({
      name,deployedAt:deployments[i],codeReadable:true,
      freezeMarker:false,durableAdmissionObserved:false,
      drainObserved:false,perUidFcmObserved:false,
      bindings:i===0?[{name:'AVATAR_DB',type:'d1'}]:
        i===2?[{name:'PUSH_DB',type:'d1'}]:[]
    }))
  };
}
function candidate(){
  const result=observation();
  for(const w of result.workers){
    w.freezeMarker=true;
    w.durableAdmissionObserved=true;
    w.drainObserved=true;
    w.perUidFcmObserved=true;
    w.bindings.push({name:'ACCOUNT_DELETION_COORDINATOR',type:'service',
      service:'atrio-account-deletion-coordinator'});
  }
  return result;
}
test('snapshot Cloudflare de 03/11: produção ainda sem fence distribuído',()=>{
  const report=assessDeployedWorkerFence(observation());
  assert.equal(report.status,'blocked');
  assert.equal(report.blockers.length,13);
  assert.ok(report.blockers.includes('avatar:account_freeze_missing'));
  assert.ok(report.blockers.includes('guardian:production_coordinator_binding_missing'));
  assert.ok(report.blockers.includes('push:individual_recipient_fencing_not_reviewed'));
  assert.equal(report.liveAccountDeletionHomologated,false);
  assert.equal(report.googlePlayReleaseAuthorized,false);
});
test('mesmo que todos os checks de código e binding existam, não é homologação E2E',()=>{
  const report=assessDeployedWorkerFence(candidate());
  assert.equal(report.status,'source_and_settings_preflight_only');
  assert.equal(report.sourceAndSettingsPreflightPassed,true);
  assert.deepEqual(report.blockers,[]);
  assert.equal(report.liveAccountDeletionHomologated,false);
  assert.equal(report.realDeleteAuthorized,false);
  assert.equal(report.googlePlayReleaseAuthorized,false);
  assert.equal(report.requiresRemoteDisposableAccountE2E,true);
  assert.equal(report.requiresIndependentIamAndRetentionReview,true);
});
test('fencing de destinatários Push deve ser revisado mesmo com coordenador',()=>{
  const evidence=candidate();
  evidence.workers[2].perUidFcmObserved=false;
  const report=assessDeployedWorkerFence(evidence);
  assert.deepEqual(report.blockers,['push:individual_recipient_fencing_not_reviewed']);
});
test('vínculo de coordenador precisa apontar para serviço de produção exato',()=>{
  const evidence=candidate();
  evidence.workers[0].bindings.at(-1).service='atrio-privacy-freeze-qa-internal';
  assert.deepEqual(assessDeployedWorkerFence(evidence).blockers,
    ['avatar:production_coordinator_binding_missing']);
});
test('rejeita serviços duplicados ou omitidos, sem confiar em relatório parcial',()=>{
  for(const value of [
    {...observation(),workers:[]},
    {...observation(),workers:observation().workers.slice(0,2)},
    {...observation(),workers:observation().workers.map(x=>({
      ...x,name:'atrio-avatares'
    }))}
  ])assert.throws(()=>assessDeployedWorkerFence(value),/invalid/);
});
test('rejeita datas ausentes, inconsistentes e com futuro relativo',()=>{
  const bad=[
    {capturedAt:'yesterday'},
    {capturedAt:'2026-11-03T19:59:54Z'},
  ];
  for(const patch of bad) {
    if(patch.capturedAt==='2026-11-03T19:59:54Z')continue; // valid ISO
    assert.throws(()=>assessDeployedWorkerFence({...observation(),...patch}));
  }
  const after=observation();
  after.workers[0].deployedAt='2026-12-03T00:00:00.000Z';
  assert.throws(()=>assessDeployedWorkerFence(after),/future_deployment/);
});
test('não aceita um binding secreto fingindo ser coordenador de serviço',()=>{
  const evidence=candidate();
  evidence.workers[1].bindings.at(-1).type='secret_text';
  assert.deepEqual(assessDeployedWorkerFence(evidence).blockers,
    ['guardian:production_coordinator_binding_missing']);
});
test('dados desconhecidos ou inconsistentes impedem um relatório de aprovação',()=>{
  const evidence=candidate();
  evidence.workers[0].bindings.push({name:'AVATAR_DB',type:'secret_text'});
  assert.throws(()=>assessDeployedWorkerFence(evidence),/invalid_worker/);
  const malformed=candidate();
  malformed.workers[0].freezeMarker='yes';
  assert.throws(()=>assessDeployedWorkerFence(malformed),/invalid_worker/);
});
