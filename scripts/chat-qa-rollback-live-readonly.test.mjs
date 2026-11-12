import test from 'node:test';
import assert from 'node:assert/strict';
import {OBSERVED_IAM_QA} from './chat-qa-rollback-reference.mjs';
import {evaluateQaRollbackLiveSnapshot,checkQaRollbackLiveReadOnly}
  from './chat-qa-rollback-live-readonly.mjs';

const sample=()=>({
  status:'QA_REAL_DENY_ALL_CONFIRMED',
  project:'atrio-catolico-qa-geral',
  android_package:'br.com.atriocatolico.chatqa',
  firebase_android_app_id:'1:123456789:android:deadbeef',
  rules_sha256:OBSERVED_IAM_QA.rules_sha256,
  remote_ruleset_name:OBSERVED_IAM_QA.ruleset_name,
  remote_project_and_app_verified:true,
  remote_firestore_rules_verified:true,
  remote_rules_deny_all:true,
  ready_for_activation:false,
  method:'FOUR_QA_GET',
  audit_time_local:'2026-11-12T12:00:00.000Z',
  production_contacted:false,
  changes_performed:false
});

test('mesmo Ruleset ativo comprova apenas igualdade na leitura, nunca GO',()=>{
 const result=evaluateQaRollbackLiveSnapshot(sample());
 assert.equal(result.status,'QA_ROLLBACK_REFERENCE_MATCH_AT_READ_TIME_NO_GO');
 assert.equal(result.active_ruleset_name,OBSERVED_IAM_QA.ruleset_name);
 assert.equal(result.active_rules_sha256,OBSERVED_IAM_QA.rules_sha256);
 assert.equal(result.reference_matches_at_read_time,true);
 assert.equal(result.snapshot_stale_after_read,true);
 assert.equal(result.read_only_qa_get_requests,4);
 assert.equal(result.current_rollback_target_after_future_rollout_not_guaranteed,true);
 assert.equal(result.production_isolation_still_unverified,true);
 assert.equal(result.historical_iam_is_not_current_iam_audit,true);
 assert.equal(result.deploymentApproved,false);
 assert.equal(result.releaseApproved,false);
 assert.equal(result.rollbackApproved,false);
 assert.equal(result.ready_for_activation,false);
 assert.equal(result.deploy_performed,false);
 assert.equal(result.rollback_performed,false);
 assert.equal(result.production_contacted,false);
 assert.equal(Object.isFrozen(result),true);
});

test('mesmo hash em outro Ruleset e mesmo Ruleset com hash trocado falham fechados',()=>{
 for(const patch of [
   {rules_sha256:'f'.repeat(64)},
   {remote_ruleset_name:'projects/atrio-catolico-qa-geral/rulesets/outro'},
   {rules_sha256:'f'.repeat(64),remote_ruleset_name:'projects/atrio-catolico-qa-geral/rulesets/outro'}
 ])assert.throws(()=>evaluateQaRollbackLiveSnapshot({...sample(),...patch}),
   /qa_rollback_live_historical_ruleset_not_active_or_modified/);
});

test('alvo errado, deny-all ausente e flags de aprovacao sao recusados',()=>{
 for(const patch of [
   {project:'atrio-catolico'},
   {android_package:'br.com.atriocatolico'},
   {firebase_android_app_id:'invalid'},
   {status:'QA_REAL_RULES_NOT_DENY_ALL'},
   {remote_rules_deny_all:false},
   {remote_firestore_rules_verified:false},
   {remote_project_and_app_verified:false},
   {ready_for_activation:true},
   {changes_performed:true},
   {production_contacted:true},
   {method:'POST'},
   {approved:true},
   {uid:'user-personal-data'},
   {audit_time_local:'not-a-date'},
   {audit_time_local:'2026-11-12 12:00:00'},
   {remote_ruleset_name:'projects/atrio-catolico/rulesets/falso'},
   {rules_sha256:'not-hex'}
 ]) assert.throws(()=>evaluateQaRollbackLiveSnapshot({...sample(),...patch}),
  /qa_rollback_live_audit_invalid_or_untrusted/);
});

test('auditoria incompleta e entradas malformadas sao recusadas',()=>{
 for(const bad of [null,{},[],42,'read_only', {...sample(),rules_sha256:null},
   {...sample(),audit_time_local:null}])
  assert.throws(()=>evaluateQaRollbackLiveSnapshot(bad),
    /qa_rollback_live_audit_invalid_or_untrusted/);
});

test('reusa somente uma vez o auditor QA ja existente, sem chamadas adicionais',async()=>{
 let calls=0;
 const result=await checkQaRollbackLiveReadOnly({auditor:async()=>{
   calls++;
   return sample();
 }});
 assert.equal(calls,1);
 assert.equal(result.read_only_qa_get_requests,4);
 assert.equal(result.rollbackPerformed,undefined);
});

test('erro ou divergencia do auditor interrompe sem retornar sucesso',async()=>{
 await assert.rejects(checkQaRollbackLiveReadOnly({auditor:async()=>{
   throw Error('token authentication unavailable');
 }}),/qa_rollback_live_audit_failed_closed/);
 await assert.rejects(checkQaRollbackLiveReadOnly({auditor:async()=>({
   ...sample(),remote_ruleset_name:'projects/atrio-catolico-qa-geral/rulesets/changed'
 })}),/qa_rollback_live_historical_ruleset_not_active_or_modified/);
});
