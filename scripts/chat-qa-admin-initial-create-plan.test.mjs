import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OPERATOR_OBSERVATION,prepareQaAdminCreatePlan}
 from './chat-qa-admin-initial-create-plan.mjs';
import {STAGED_QA_DOCS}
 from '../firebase/qa-general/admin-config-preflight.mjs';

const copy=x=>structuredClone(x);
test('4 create-only intentions, QA-specific, no writes, no enabling chat/groups/push',()=>{
 const plan=prepareQaAdminCreatePlan();
 assert.equal(plan.mode,'OFFLINE_PLAN_ONLY_NO_NETWORK_OR_WRITES');
 assert.equal(plan.project,'atrio-catolico-qa-geral');
 assert.equal(plan.android_package,'br.com.atriocatolico.chatqa');
 assert.equal(plan.planned_documents,4);
 assert.equal(plan.snapshot_is_historical,true);
 assert.equal(plan.requires_new_remote_read_before_any_write,true);
 assert.equal(plan.operator_approval_recorded,false);
 assert.equal(plan.ready_for_deploy,false);
 assert.equal(plan.ready_for_activation,false);
 assert.equal(plan.remote_state_changed,false);
 assert.equal(plan.changes_performed,false);
 assert.equal(plan.production_contacted,false);
 assert.equal(plan.chat_enabled,false);
 assert.equal(plan.groups_enabled,false);
 assert.equal(plan.push_enabled,false);
 assert.equal(plan.overwrite_allowed,false);
 assert.equal(plan.creation_intents.length,4);
 assert.ok(plan.pending_requirements.length>=6);
 const expected=['app_config/email_verification','app_config/community_rules',
 'app_config/conversations','app_config/chat_groups'];
 assert.deepEqual(plan.creation_intents.map(x=>x.path),expected);
 assert.ok(plan.creation_intents.every(x=>
  x.future_method==='CREATE_DOCUMENT_ONLY_IF_ABSENT_NOT_UPDATE_OR_UPSERT' &&
  x.on_already_exists==='ABORT_WITHOUT_OVERWRITE' &&
  x.remotely_created===false && /^[a-f0-9]{64}$/.test(x.desired_document_sha256)));
});
test('integers strings and booleans encoded deterministically without extra fields',()=>{
 const plan=prepareQaAdminCreatePlan();
 const find=path=>plan.creation_intents.find(x=>x.path===path).firestore_fields;
 assert.deepEqual(find('app_config/email_verification'),{
  enabled:{booleanValue:true},version:{stringValue:'2026-11-v1'}
 });
 const dm=find('app_config/conversations');
 assert.deepEqual(dm.editWindowMinutes,{integerValue:'0'});
 assert.deepEqual(dm.deleteWindowMinutes,{integerValue:'0'});
 assert.deepEqual(dm.enabled,{booleanValue:false});
 assert.deepEqual(dm.minorPolicyApproved,{booleanValue:false});
 assert.deepEqual(find('app_config/chat_groups').enabled,{booleanValue:false});
 assert.deepEqual(plan.creation_intents.map(x=>x.desired_document_sha256),
   prepareQaAdminCreatePlan().creation_intents.map(x=>x.desired_document_sha256));
});
test('historical operator snapshot tampering never creates a plan',()=>{
 const cases=[
   {project:'atrio-catolico'},
   {android_package:'br.com.atriocatolico'},
   {status:'QA_REAL_RULES_NOT_DENY_ALL'},
   {rules_sha256:'9'.repeat(64)},
   {ruleset_name:'projects/atrio-catolico/rulesets/wrong'},
   {queried_documents:3},{existing_documents:1},{missing_documents:3},
   {remote_rules_deny_all:false},{chat_and_groups_observed_closed:false},
   {ready_for_deploy:true},{ready_for_activation:true},
   {changes_performed:true},{production_contacted:true},
   {observed_at:'2026-11-11T03:35:00Z'}
 ];
 for(const mutation of cases){
  assert.throws(()=>prepareQaAdminCreatePlan({
   observation:{...OPERATOR_OBSERVATION,...mutation}
  }),/qa_initial_create_plan_/);
 }
});
test('document list cannot omit, add, reorder or mark anything present',()=>{
 const a=copy(OPERATOR_OBSERVATION);
 a.documents[0].present=true;
 assert.throws(()=>prepareQaAdminCreatePlan({observation:a}),
  /qa_initial_create_plan_document_not_missing/);
 const b=copy(OPERATOR_OBSERVATION);
 b.documents[1].state='PRESENT';
 assert.throws(()=>prepareQaAdminCreatePlan({observation:b}),
  /qa_initial_create_plan_document_not_missing/);
 const c=copy(OPERATOR_OBSERVATION);
 c.documents.reverse();
 assert.throws(()=>prepareQaAdminCreatePlan({observation:c}),
  /qa_initial_create_plan_document_paths_changed/);
 const d=copy(OPERATOR_OBSERVATION);
 d.documents[1].path='users/user_id/private';
 assert.throws(()=>prepareQaAdminCreatePlan({observation:d}),
  /qa_initial_create_plan_document_paths_changed/);
});
test('staged config refuses to open chat/groups, grant 18+ admin or add docs',()=>{
 for(const [path,field,value] of [
  ['app_config/conversations','enabled',true],
  ['app_config/conversations','minorPolicyApproved',true],
  ['app_config/chat_groups','enabled',true],
  ['app_config/chat_groups','minorPolicyApproved',true],
  ['app_config/community_rules','version','old'],
  ['app_config/email_verification','enabled',false]
 ]){
  const cfg=copy(STAGED_QA_DOCS);
  cfg[path][field]=value;
  assert.throws(()=>prepareQaAdminCreatePlan({stagedDocs:cfg}),
   /chat_qa_admin_config_/);
 }
 const other=copy(STAGED_QA_DOCS);
 other['users/another-uid']={enabled:true};
 assert.throws(()=>prepareQaAdminCreatePlan({stagedDocs:other}),
  /chat_qa_admin_config_/);
});
test('source cannot call network or import credentials and has no mutation handler',()=>{
 const source=readFileSync(
  new URL('./chat-qa-admin-initial-create-plan.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\bfetch\s*\(/);
 assert.doesNotMatch(source,/firebase-admin|accessTokenFromExistingFirebaseCli/);
 assert.doesNotMatch(source,/\baxios\b|\bXMLHttpRequest\b|\bhttps\.request\b/);
 assert.doesNotMatch(source,/\bwriteFileSync\b|\bexecFile\b|\bspawn\s*\(/);
});
