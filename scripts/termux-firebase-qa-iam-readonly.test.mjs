import test from 'node:test';
import assert from 'node:assert/strict';
import {checkQaIamReadOnly,CHECKED_PERMISSIONS} from './termux-firebase-qa-iam-readonly.mjs';
const proj='atrio-catolico-qa-geral';
const target='https://cloudresourcemanager.googleapis.com/v1/projects/'+proj+':testIamPermissions';
const token='fictional-qa-oauth-only-987654321000';
const baseline={
 status:'QA_REAL_DENY_ALL_CONFIRMED',project:proj,
 android_package:'br.com.atriocatolico.chatqa',
 remote_project_and_app_verified:true,remote_firestore_rules_verified:true,
 remote_rules_deny_all:true,ready_for_activation:false,
 rules_sha256:'a'.repeat(64),
 remote_ruleset_name:'projects/'+proj+'/rulesets/fixture123',
 production_contacted:false,changes_performed:false
};
function make({granted=CHECKED_PERMISSIONS.slice(0,3),baselinePatch={},http=200,malformed=false}={}){
 const calls=[];
 const qaAuditor=async({fetcher,tokenProvider})=>{
  assert.equal(await tokenProvider(),token);
  assert.equal(typeof fetcher,'function');
  calls.push('QA_AUDIT_ALREADY_CONFIRMED');
  return {...baseline,...baselinePatch};
 };
 const fetcher=async(url,opts)=>{
  calls.push({url,opts});
  assert.equal(url,target);
  assert.equal(opts.method,'POST');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.cache,'no-store');
  assert.equal(opts.headers.Authorization,'Bearer '+token);
  assert.deepEqual(JSON.parse(opts.body),{permissions:CHECKED_PERMISSIONS});
  if(http!==200)return new Response('denied',{status:http});
  return malformed?new Response('{bad',{status:200}):
    Response.json({permissions:granted});
 };
 return {calls,qaAuditor,fetcher,tokenProvider:async()=>token};
}
const run=(f,extra={})=>checkQaIamReadOnly({
  qaAuditor:f.qaAuditor,fetcher:f.fetcher,tokenProvider:f.tokenProvider,...extra
});
test('consultar IAM nao altera permissoes: URL QA fixa e POST testIamPermissions',async()=>{
 const f=make();
 const result=await run(f);
 assert.equal(f.calls.length,2);
 assert.equal(f.calls[1].url,target);
 assert.equal(result.can_read_rules_in_qa,true);
 assert.equal(result.may_have_publish_permissions_in_qa,false);
 assert.equal(result.ready_for_activation,false);
 assert.equal(result.changes_performed,false);
 assert.equal(result.production_contacted,false);
 assert.equal(result.permissions_do_not_prove_production_isolation,true);
 assert.ok(!JSON.stringify(result).includes(token));
 assert.ok(!JSON.stringify(result).includes('fictional'));
});
test('permissao de publicar no QA nao concede autorizacao de deploy',async()=>{
 const f=make({granted:CHECKED_PERMISSIONS});
 const result=await run(f);
 assert.equal(result.may_have_publish_permissions_in_qa,true);
 assert.equal(result.ready_for_activation,false);
});
test('nao consulta IAM se snapshot QA divergir ou nao for deny-all',async()=>{
 for(const patch of [
   {project:'atrio-catolico'},
   {android_package:'br.com.atriocatolico'},
   {status:'QA_REAL_RULES_NOT_DENY_ALL'},
   {remote_rules_deny_all:false},
   {remote_firestore_rules_verified:false},
   {production_contacted:true},
   {changes_performed:true},
   {rules_sha256:'9'},
   {remote_ruleset_name:'projects/atrio-catolico/rulesets/p1'}
 ]){
  const f=make({baselinePatch:patch});
  await assert.rejects(run(f),/qa_iam_readonly_qa_identity_or_rules_unverified/);
  assert.deepEqual(f.calls,['QA_AUDIT_ALREADY_CONFIRMED']);
 }
});
test('erro IAM, lista adulterada, duplicada ou malformada falham fechados',async()=>{
 for(const opts of [
   {http:403},{malformed:true},{granted:['firebaserules.rulesets.delete']},
   {granted:['firebaserules.releases.get','firebaserules.releases.get']}
 ]){
  const f=make(opts);
  await assert.rejects(run(f),/qa_iam_readonly_(iam_read_failed|iam_response_invalid)/);
  assert.equal(f.calls.length,2);
 }
});
test('falha de login ou auditoria impede POST',async()=>{
 const f=make();
 await assert.rejects(run(f,{tokenProvider:async()=>{throw Error('secret');}}),
   /qa_iam_readonly_login_unavailable/);
 assert.equal(f.calls.length,0);
 await assert.rejects(run(f,{qaAuditor:async()=>{throw Error('network-token');}}),
   /qa_iam_readonly_qa_identity_or_rules_unverified/);
 assert.equal(f.calls.length,0);
});
