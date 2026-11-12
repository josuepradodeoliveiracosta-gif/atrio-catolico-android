import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {renderClosedQaParity} from '../firebase/qa-general/closed-qa-parity.mjs';
import {evaluateOfflinePreparation,prepareOfflineQaActivation,AUDITED_SNAPSHOT}
 from './chat-qa-activation-preflight.mjs';
import {STAGED_QA_DOCS} from '../firebase/qa-general/admin-config-preflight.mjs';
import {OPERATOR_OBSERVATION}
 from './chat-qa-admin-initial-create-plan.mjs';

const read=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');
const sample={
 base:read('../firestore.rules'),
 chat:read('../firebase/atrio-conversas-v1.rules.fragment'),
 group:read('../firebase/atrio-grupos-v1.rules.fragment'),
 rollback:read('../firebase/qa-general/qa-deny-all-reference.rules')
};
const check=patch=>evaluateOfflinePreparation({...sample,...patch});
test('plano gera hash local, sem autorizacao de deploy, Worker ou grupo',()=>{
 const plan=prepareOfflineQaActivation();
 assert.match(plan.candidate_rules_sha256,/^[a-f0-9]{64}$/);
 assert.match(plan.rollback_reference_sha256,/^[a-f0-9]{64}$/);
 assert.equal(plan.mode,'LOCAL_PLAN_ONLY_NO_DEPLOY');
 assert.equal(plan.candidate_source,'VERSIONED_REPOSITORY_FIRESTORE_RULES_PINNED');
 assert.equal(plan.repository_rules_baseline_reused,true);
 assert.equal(plan.live_production_rules_match_unverified,true);
 assert.equal(plan.remote_production_readonly_comparison_required,true);
 assert.equal(plan.legacy_standalone_candidate_is_only_an_isolation_fixture,true);
 assert.equal(plan.candidate_includes_posts_and_replies,true);
 assert.equal(plan.candidate_includes_existing_user_reports,true);
 assert.equal(plan.rollback_reference_is_deny_all,true);
 assert.equal(plan.rollback_reference_is_exact_remote_backup,false);
 assert.equal(plan.snapshot_not_current_state,true);
 assert.equal(plan.notifications_worker_compatible,false);
 assert.equal(plan.push_enabled,false);
 assert.equal(plan.groups_approved_for_activation,false);
 assert.equal(plan.ready_for_deploy,false);
 assert.equal(plan.admin_staged_config_verified,true);
 assert.equal(plan.staged_admin_documents_checked,4);
 assert.equal(plan.staged_chat_enabled,false);
 assert.equal(plan.staged_groups_enabled,false);
 assert.equal(plan.admin_config_published,false);
 assert.equal(plan.four_admin_documents_missing_at_last_operator_snapshot,true);
 assert.equal(plan.admin_snapshot_is_historical,true);
 assert.equal(plan.admin_initial_create_manifest_checked,true);
 assert.equal(plan.admin_create_intents,4);
 assert.equal(plan.admin_create_overwrite_allowed,false);
 assert.equal(plan.admin_initial_create_performed,false);
 assert.equal(plan.production_contacted,false);
 assert.equal(plan.deploy_performed,false);
 assert.ok(plan.blockers.length>=6);
});
test('nao aceita rollback que permita leitura ou escrita',()=>{
 for(const rollback of [
  sample.rollback.replace('if false','if true'),
  sample.rollback.replace('allow read, write: if false;', 'allow read: if false;'),
  sample.rollback.replace('match /{document=**}', 'match /chats/{chatId}'),
  ''
 ]){
  assert.throws(()=>check({rollback}),/qa_activation_plan_rollback_not_deny_all/);
 }
});
test('evidencia do QA real invalida/alterada falha fechado',()=>{
 for(const patch of [
   {project:'atrio-catolico'},
   {android_package:'br.com.atriocatolico'},
   {rules_sha256:'f'.repeat(64)},
   {remote_rules_deny_all:false},
   {remote_firestore_rules_verified:false},
   {remote_project_and_app_verified:false},
   {production_contacted:true},
   {changes_performed:true},
   {ready_for_activation:true},
   {audit_time_local:'2026-11-11T01:18:00Z'}
 ]){
   assert.throws(()=>check({evidence:{...AUDITED_SNAPSHOT,...patch}}),
     /qa_activation_plan_snapshot_mismatch/);
 }
});
test('gerador de rules falha fechado com fonte de chat adulterada',()=>{
 const chat=sample.chat.replace('match /chats/{chatId}', 'match /danger/{chatId}');
 assert.throws(()=>check({chat}),/qa_activation_plan_(candidate_generation_changed|chat_fragment_changed)/);
});
test('grupos nao se tornam elegiveis ao modificar fragmento',()=>{
 const group=sample.group.replace('atrioGroupEligible(request.auth.uid)','true');
 assert.throws(()=>check({group}),/qa_activation_plan_(candidate_(gate_changed|generation_changed)|group_fragment_changed)/);
});
test('referencia de reversao nao e copia fiel das Rules reais',()=>{
 const result=check();
 assert.notEqual(result.rollback_reference_sha256,result.audited_baseline_sha256);
 assert.equal(result.rollback_reference_is_exact_remote_backup,false);
});

test('preflight geral rejeita config administrativa estagiada que ativa chat ou grupos',()=>{
 for(const patch of [
   ['app_config/conversations','enabled',true],
   ['app_config/conversations','minorPolicyApproved',true],
   ['app_config/chat_groups','enabled',true],
   ['app_config/chat_groups','minorPolicyApproved',true],
   ['app_config/email_verification','enabled',false]
 ]){
   const cfg=structuredClone(STAGED_QA_DOCS);
   cfg[patch[0]][patch[1]]=patch[2];
   assert.throws(()=>check({stagedConfig:cfg}),
     /qa_activation_plan_staged_admin_invalid/);
 }
});

test('preflight geral rejeita evidencia administrativa faltando/alterada',()=>{
 for(const change of [
   {existing_documents:1},
   {missing_documents:3},
   {remote_rules_deny_all:false},
   {ruleset_name:'projects/atrio-catolico/rulesets/unsafe'},
   {ready_for_deploy:true},
   {production_contacted:true}
 ]){
  assert.throws(()=>check({
   adminObservation:{...OPERATOR_OBSERVATION,...change}
  }),/qa_activation_plan_initial_create_manifest_invalid/);
 }
});

test('preflight principal usa a base oficial versionada, não reescreve cadastro do zero',()=>{
 const expected=renderClosedQaParity(sample.base,sample.chat,sample.group);
 const digest=createHash('sha256').update(expected,'utf8').digest('hex');
 const report=check();
 assert.equal(report.candidate_rules_sha256,digest);
 for(const route of [
   'match /posts/{postId}',
   'match /user_reports/{reportId}',
   'match /community_consents/{uid}',
   'match /profiles/{uid}',
   'match /chats/{chatId}',
   'match /chat_groups/{groupId}'
 ])assert.ok(expected.includes(route),route);
 assert.notEqual(
   report.candidate_rules_sha256,
   report.audited_baseline_sha256,
   'QA deny-all remoto não foi substituído pelo candidato'
 );
});
test('base oficial versionada adulterada ou ausente interrompe o plano',()=>{
 assert.throws(()=>check({base:sample.base+'\\n// adulterado'}),
  /qa_activation_plan_candidate_generation_changed/);
 assert.throws(()=>check({base:''}),
  /qa_activation_plan_candidate_generation_changed/);
 assert.throws(()=>check({base:undefined}),
  /qa_activation_plan_source_unavailable/);
});
