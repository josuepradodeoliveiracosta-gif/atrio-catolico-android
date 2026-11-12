import test from 'node:test';
import assert from 'node:assert/strict';
import {runQaCombinedReadOnly,summarizeQaReadOnly}
 from './chat-qa-combined-readonly.mjs';
import {OBSERVED_IAM_QA} from './chat-qa-rollback-reference.mjs';
import {STAGED_QA_DOCS}
 from '../firebase/qa-general/admin-config-preflight.mjs';
import {reviewGovernance,readGovernanceRecord}
 from './chat-qa-governance-preflight.mjs';

const project='atrio-catolico-qa-geral';
const pkg='br.com.atriocatolico.chatqa';
const snap=()=>({
 status:'QA_REAL_DENY_ALL_CONFIRMED',
 project,android_package:pkg,
 firebase_android_app_id:'1:123456789:android:deadbeef',
 rules_sha256:OBSERVED_IAM_QA.rules_sha256,
 remote_ruleset_name:OBSERVED_IAM_QA.ruleset_name,
 remote_project_and_app_verified:true,
 remote_firestore_rules_verified:true,remote_rules_deny_all:true,
 ready_for_activation:false,method:'FOUR_QA_GET',
 audit_time_local:'2026-11-12T12:47:48.245Z',
 production_contacted:false,changes_performed:false
});
const admin=(missingAll=true)=>({
 status:'QA_ADMIN_CONFIG_SNAPSHOT_READ_ONLY',
 project,android_package:pkg,
 rules_sha256:OBSERVED_IAM_QA.rules_sha256,
 ruleset_name:OBSERVED_IAM_QA.ruleset_name,
 queried_documents:4,existing_documents:missingAll?0:4,
 missing_documents:missingAll?4:0,
 documents:Object.keys(STAGED_QA_DOCS).map(path=>({
   path,
   state:missingAll?'MISSING':'PRESENT_STAGED_FIELDS_MATCH',
   present:!missingAll,staged_fields_match:!missingAll,
   differs_field_names:[],enabled:missingAll?null:STAGED_QA_DOCS[path].enabled,
   minor_policy_approved:missingAll?null:(
     Object.hasOwn(STAGED_QA_DOCS[path],'minorPolicyApproved')?
       STAGED_QA_DOCS[path].minorPolicyApproved:null),
   version_matches_expected:missingAll?null:true,
   chat_or_group_safely_disabled:
     ['app_config/conversations','app_config/chat_groups'].includes(path)?
       true:null
 })),
 all_four_staged_fields_match:!missingAll,chat_and_groups_observed_closed:true,
 field_mask_excludes_other_fields:true,remote_rules_deny_all:true,
 ready_for_activation:false,ready_for_deploy:false,
 changes_performed:false,production_contacted:false,
 method:'FOUR_QA_IDENTITY_RULES_GET_PLUS_FOUR_FIRESTORE_MASKED_GET',
 audited_at:'2026-11-12T12:49:00.000Z',
 warning:'Mock read only'
});
const iam=()=>({
 status:'QA_IAM_PERMISSION_SNAPSHOT_ONLY',project,android_package:pkg,
 rules_sha256:OBSERVED_IAM_QA.rules_sha256,
 ruleset_name:OBSERVED_IAM_QA.ruleset_name,
 can_read_rules_in_qa:true,may_have_publish_permissions_in_qa:true,
 checked_permissions_count:5,granted_permissions_count:5,
 permission_check_method:'POST_testIamPermissions_NO_MUTATION',
 changes_performed:false,production_contacted:false,
 permissions_do_not_prove_production_isolation:true,ready_for_activation:false
});
const gov=()=>reviewGovernance(readGovernanceRecord());

test('4+4 GET QA e POST consulta IAM com um login e auditoria unica',async()=>{
 let login=0,baseline=0,configs=0,permissions=0;
 const token='synthetic-qa-token-1234567890123456';
 const result=await runQaCombinedReadOnly({
   tokenProvider:async()=>{login++;return token;},
   qaAuditor:async({tokenProvider})=>{
     baseline++;assert.equal(await tokenProvider(),token);return snap();
   },
   adminInspector:async({tokenProvider,qaAuditor})=>{
     configs++;assert.equal(await tokenProvider(),token);
     assert.deepEqual(await qaAuditor(),snap());return admin();
   },
   iamInspector:async({tokenProvider,qaAuditor})=>{
     permissions++;assert.equal(await tokenProvider(),token);
     assert.deepEqual(await qaAuditor(),snap());return iam();
   },
   governanceReader:readGovernanceRecord,governanceReviewer:reviewGovernance
 });
 assert.deepEqual([login,baseline,configs,permissions],[1,1,1,1]);
 assert.equal(result.queried_qa_identity_rules_gets,4);
 assert.equal(result.queried_qa_app_config_masked_gets,4);
 assert.equal(result.iam_permission_test_post_is_non_mutating,true);
 assert.equal(result.missing_app_config_documents,4);
 assert.equal(result.chat_and_groups_observed_closed,true);
 assert.equal(result.ready_for_activation,false);
 assert.equal(result.ready_for_deploy,false);
 assert.equal(result.deploymentApproved,false);
 assert.equal(result.rollbackApproved,false);
 assert.equal(result.governance_reviews_pending,8);
 assert.ok(!JSON.stringify(result).includes(token));
 assert.equal(Object.isFrozen(result),true);
});
test('quatro documentos estagiados fechados nao resultam em GO',()=>{
 const result=summarizeQaReadOnly({audit:snap(),admin:admin(false),iam:iam(),governance:gov()});
 assert.equal(result.staged_config_matches,true);
 assert.equal(result.existing_app_config_documents,4);
 assert.equal(result.ready_for_deploy,false);
 assert.equal(result.ready_for_activation,false);
});
test('chat ou grupos abertos sao reportados como NO_GO, nunca ativacao',()=>{
 const x=admin(false),d=x.documents[2];
 d.state='PRESENT_STAGED_FIELDS_DIFFER';d.staged_fields_match=false;
 d.differs_field_names=['enabled'];d.enabled=true;
 d.chat_or_group_safely_disabled=false;
 x.chat_and_groups_observed_closed=false;x.all_four_staged_fields_match=false;
 const result=summarizeQaReadOnly({audit:snap(),admin:x,iam:iam(),governance:gov()});
 assert.equal(result.chat_and_groups_observed_closed,false);
 assert.equal(result.ready_for_activation,false);
});
test('Ruleset SHA alterado ou projeto de producao bloqueiam consultas seguintes',async()=>{
 for(const patch of [{rules_sha256:'f'.repeat(64)},{project:'atrio-catolico'},
                      {remote_rules_deny_all:false}]){
   let reachedConfig=0;
   await assert.rejects(runQaCombinedReadOnly({
      tokenProvider:async()=> 'synthetic-qa-token-1234567890123456',
      qaAuditor:async()=>({...snap(),...patch}),
      adminInspector:async()=>{reachedConfig++;return admin();}
   }),/qa_combined_readonly_baseline_invalid_or_changed/);
   assert.equal(reachedConfig,0);
 }
});
test('config e IAM de outro projeto ou com falsos estados nao sao aceitos',()=>{
 for(const mutation of [
   {admin:{project:'atrio-catolico'}},
   {admin:{ready_for_activation:true}},
   {admin:{missing_documents:3}},
   {admin:{documents:[]}},
   {admin:{remote_rules_deny_all:false}},
   {admin:{changes_performed:true}},
   {iam:{project:'atrio-catolico'}},
   {iam:{ruleset_name:'projects/atrio-catolico/rulesets/wrong'}},
   {iam:{permission_check_method:'setIamPolicy'}},
   {iam:{ready_for_activation:true}},
   {iam:{changes_performed:true}},
   {iam:{permissions_do_not_prove_production_isolation:false}},
   {governance:{ready_for_qa_deploy:true}}
 ]){
   const a=Object.assign(admin(),mutation.admin||{});
   const i=Object.assign(iam(),mutation.iam||{});
   const g=Object.assign({...gov()},mutation.governance||{});
   assert.throws(()=>summarizeQaReadOnly({audit:snap(),admin:a,iam:i,governance:g}),
      /qa_combined_readonly_/);
 }
});
test('nome de campo nao esperado, documento duplicado ou dados extras falham',()=>{
 const a=admin();
 a.documents[0].differs_field_names.push('private_token');
 assert.throws(()=>summarizeQaReadOnly({audit:snap(),admin:a,iam:iam(),governance:gov()}),
   /qa_combined_readonly_config_document_invalid/);
 const b=admin();
 b.documents[1].path=b.documents[0].path;
 assert.throws(()=>summarizeQaReadOnly({audit:snap(),admin:b,iam:iam(),governance:gov()}),
   /qa_combined_readonly_config_document_invalid/);
});
test('autenticacao, auditoria e resposta administrativa falham fechado',async()=>{
 for(const options of [
   {tokenProvider:async()=>{throw Error('private token');}},
   {tokenProvider:async()=> 'x'},
   {tokenProvider:async()=> 'synthetic-qa-token-1234567890123456',
    qaAuditor:async()=>{throw Error('private error');}},
   {tokenProvider:async()=> 'synthetic-qa-token-1234567890123456',
    qaAuditor:async()=>snap(),
    adminInspector:async()=>{throw Error('private data');}}
 ]){
   await assert.rejects(runQaCombinedReadOnly(options),/qa_combined_readonly_/);
 }
});
test('permissao IAM ou governanca indisponivel nao fornece conclusao falsa',async()=>{
 const common={
  tokenProvider:async()=> 'synthetic-qa-token-1234567890123456',
  qaAuditor:async()=>snap(),adminInspector:async()=>admin()
 };
 await assert.rejects(runQaCombinedReadOnly({
   ...common,iamInspector:async()=>{throw Error('IAM offline');}
 }),/qa_combined_readonly_iam_read_failed/);
 await assert.rejects(runQaCombinedReadOnly({
   ...common,iamInspector:async()=>iam(),
   governanceReader:()=>{throw Error('invalid JSON');}
 }),/qa_combined_readonly_governance_invalid/);
});
