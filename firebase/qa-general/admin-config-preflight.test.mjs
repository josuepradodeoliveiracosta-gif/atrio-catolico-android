import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STAGED_QA_DOCS,LAB_ONLY_ACTIVE_CHAT,validateStagedQaDocs,
 validateAndroidPolicyAnchors} from './admin-config-preflight.mjs';
const clone=o=>JSON.parse(JSON.stringify(o));
test('staged config exclusively QA, 4 documents, chat/groups/push closed',()=>{
 const report=validateStagedQaDocs(STAGED_QA_DOCS);
 assert.equal(report.project,'atrio-catolico-qa-geral');
 assert.equal(report.android_package,'br.com.atriocatolico.chatqa');
 assert.equal(report.documents_checked,4);
 assert.equal(report.email_verification_required,true);
 assert.equal(report.community_rules_acceptance_required,true);
 assert.equal(report.conversations_enabled,false);
 assert.equal(report.groups_enabled,false);
 assert.equal(report.minor_policy_approved,false);
 assert.equal(report.push_worker_enabled,false);
 assert.equal(report.ready_for_deploy,false);
 assert.equal(report.remote_state_checked,false);
 assert.equal(report.changes_performed,false);
 assert.equal(report.production_contacted,false);
 assert.deepEqual(Object.keys(STAGED_QA_DOCS).sort(),[
  'app_config/chat_groups','app_config/community_rules',
  'app_config/conversations','app_config/email_verification'
 ]);
 assert.equal(LAB_ONLY_ACTIVE_CHAT.minorPolicyApproved,true);
 assert.equal(STAGED_QA_DOCS['app_config/conversations'].minorPolicyApproved,false);
});
test('tampering any admin config gate fails closed',()=>{
 const mutations=[
  ['app_config/email_verification','enabled',false],
  ['app_config/email_verification','version','2019-01-v0'],
  ['app_config/community_rules','enabled',false],
  ['app_config/community_rules','version','outdated'],
  ['app_config/conversations','enabled',true],
  ['app_config/conversations','minorPolicyApproved',true],
  ['app_config/conversations','safetyReviewVersion','2026-11-safety-v1'],
  ['app_config/conversations','editEnabled',true],
  ['app_config/conversations','deleteEnabled',true],
  ['app_config/conversations','editWindowMinutes',5],
  ['app_config/chat_groups','enabled',true],
  ['app_config/chat_groups','minorPolicyApproved',true],
  ['app_config/chat_groups','version','outdated']
 ];
 for(const [path,key,value] of mutations){
  const altered=clone(STAGED_QA_DOCS);
  altered[path][key]=value;
  assert.throws(()=>validateStagedQaDocs(altered),
    /chat_qa_admin_config_/,path+' '+key);
 }
});
test('no extra fields, docs, missing docs or unsafe root types',()=>{
 for(const obj of [null,[],{},'test']){
  assert.throws(()=>validateStagedQaDocs(obj),/chat_qa_admin_config_/);
 }
 const extra=clone(STAGED_QA_DOCS);
 extra['app_config/production']={enabled:true};
 assert.throws(()=>validateStagedQaDocs(extra),/chat_qa_admin_config_/);
 const more=clone(STAGED_QA_DOCS);
 more['app_config/conversations'].moderator=true;
 assert.throws(()=>validateStagedQaDocs(more),/chat_qa_admin_config_/);
 const missing=clone(STAGED_QA_DOCS);
 delete missing['app_config/community_rules'];
 assert.throws(()=>validateStagedQaDocs(missing),/chat_qa_admin_config_/);
});
test('versions match actual Android and group gates in reviewed code',()=>{
 const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
 const sources={
  emailSource:read('../../app/src/main/java/br/com/atriocatolico/EmailVerificationPolicyAccess.kt'),
  communitySource:read('../../app/src/main/java/br/com/atriocatolico/CommunityRulesGate.kt'),
  chatSource:read('../../app/src/main/java/br/com/atriocatolico/AtrioConversations.kt'),
  groupRules:read('../atrio-grupos-v1.rules.fragment')
 };
 assert.equal(validateAndroidPolicyAnchors(sources),true);
 assert.throws(()=>validateAndroidPolicyAnchors(
  {...sources,chatSource:sources.chatSource.replace('2026-11-v1','2025-01')}
 ),/chat_qa_admin_config_version_gate_mismatch/);
});
