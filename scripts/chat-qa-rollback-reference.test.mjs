import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareQaRollbackReference,OBSERVED_IAM_QA}
  from './chat-qa-rollback-reference.mjs';

const original=()=>({...OBSERVED_IAM_QA});
test('referencia QA do operador nao vira autorizacao nem backup exato',()=>{
 const r=prepareQaRollbackReference();
 assert.equal(r.project,'atrio-catolico-qa-geral');
 assert.equal(r.observed_baseline_sha256,OBSERVED_IAM_QA.rules_sha256);
 assert.equal(r.observed_baseline_ruleset_name,OBSERVED_IAM_QA.ruleset_name);
 assert.equal(r.release_name,'projects/atrio-catolico-qa-geral/releases/cloud.firestore');
 assert.equal(r.reconstructed_deny_all_is_not_exact_remote_backup,true);
 assert.equal(r.rollback_target_existence_now_unverified,true);
 assert.equal(r.isolated_production_permissions_not_verified,true);
 assert.equal(r.precise_rollback_authorization_recorded,false);
 assert.equal(r.remote_state_changed,false);
 assert.equal(r.deploy_performed,false);
 assert.equal(r.rollback_performed,false);
 assert.equal(r.ready_for_deploy,false);
 assert.equal(r.safe_to_activate_qa,false);
 assert.ok(r.blockers.length>=5);
 assert.equal(Object.isFrozen(r),true);
});
test('troca de hash, identidade ou ruleset e rejeitada',()=>{
 for(const patch of [
  {project:'atrio-catolico'},
  {android_package:'br.com.atriocatolico'},
  {status:'QA_READY'},
  {rules_sha256:'f'.repeat(64)},
  {ruleset_name:'projects/atrio-catolico/rulesets/other'},
  {ruleset_name:'projects/atrio-catolico-qa-geral/rulesets/forged'}
 ])assert.throws(()=>prepareQaRollbackReference({...original(),...patch}),
   /qa_rollback_reference_untrusted_or_modified/);
});
test('IAM nao concede GO, dados modificados falham fechado',()=>{
 for(const patch of [
  {can_read_rules_in_qa:false},
  {may_have_publish_permissions_in_qa:false},
  {checked_permissions_count:4},
  {granted_permissions_count:4},
  {permission_check_method:'setIamPolicy'},
  {changes_performed:true},
  {production_contacted:true},
  {permissions_do_not_prove_production_isolation:false},
  {ready_for_activation:true},
  {approved:true}
 ])assert.throws(()=>prepareQaRollbackReference({...original(),...patch}),
   /qa_rollback_reference_untrusted_or_modified/);
});
test('snapshot ausente ou com dados pessoais e recusado',()=>{
 for(const record of [null,{}, { ...original(), uid:'sensitive' }, []])
  assert.throws(()=>prepareQaRollbackReference(record),
   /qa_rollback_reference_untrusted_or_modified/);
});
