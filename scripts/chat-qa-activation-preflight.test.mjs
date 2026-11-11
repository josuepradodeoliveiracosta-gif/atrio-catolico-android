import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateOfflinePreparation,prepareOfflineQaActivation,AUDITED_SNAPSHOT}
 from './chat-qa-activation-preflight.mjs';

const read=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');
const sample={
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
 assert.equal(plan.rollback_reference_is_deny_all,true);
 assert.equal(plan.rollback_reference_is_exact_remote_backup,false);
 assert.equal(plan.snapshot_not_current_state,true);
 assert.equal(plan.notifications_worker_compatible,false);
 assert.equal(plan.push_enabled,false);
 assert.equal(plan.groups_approved_for_activation,false);
 assert.equal(plan.ready_for_deploy,false);
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
