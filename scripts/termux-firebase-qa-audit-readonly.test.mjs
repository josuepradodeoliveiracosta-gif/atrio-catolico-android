import test from 'node:test';
import assert from 'node:assert/strict';
import {auditQaRealReadOnly,validatedQaAppId} from './termux-firebase-qa-audit-readonly.mjs';
const project='atrio-catolico-qa-geral',appId='1:123456789:android:abc12345';
const token='mock-token-qa-restricted-never-real-0123456789';
const local=JSON.stringify({project_info:{project_id:project,project_number:'123456789'},
client:[{client_info:{mobilesdk_app_id:appId,
android_client_info:{package_name:'br.com.atriocatolico.chatqa'}},
api_key:[{current_key:'fake-not-a-real-key'}]}]});
const base='https://firebase.googleapis.com/v1beta1/projects/'+project;
const release='projects/'+project+'/releases/cloud.firestore';
const ruleset='projects/'+project+'/rulesets/fixture123';
const deny=["rules_version = '2';",'service cloud.firestore {',
'match /databases/{database}/documents {','match /{document=**} {',
'allow read, write: if false;','}', '}', '}'].join('\n');
function setup({text=deny,badApp=false,network=false}={}){
 const calls=[];
 const fetcher=async (url,options)=>{
  calls.push({url,options});
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.cache,'no-store');
  assert.equal(options.headers.Authorization,'Bearer '+token);
  if(network)throw Error('should never be leaked');
  if(url===base)return Response.json({name:'projects/'+project,
   projectId:project,projectNumber:'123456789',state:'ACTIVE'});
  if(url===base+'/androidApps/'+appId)return Response.json({
   name:'projects/'+project+'/androidApps/'+appId,projectId:project,appId,
   packageName:badApp?'not-qa':'br.com.atriocatolico.chatqa',state:'ACTIVE'});
  if(url==='https://firebaserules.googleapis.com/v1/'+release)
   return Response.json({name:release,rulesetName:ruleset});
  if(url==='https://firebaserules.googleapis.com/v1/'+ruleset)
   return Response.json({name:ruleset,source:{files:[{content:text}]}});
  assert.fail('Unauthorized endpoint: '+url);
 };
 let requested=0;
 return {calls,fetcher,tokenProvider:async()=>{requested++;return token;},
   requested:()=>requested};
}
const audit=(s,extra={})=>auditQaRealReadOnly({
 configLoader:async()=>local,tokenProvider:s.tokenProvider,fetcher:s.fetcher,
 timestamp:()=> '2026-11-10T20:00:00.000Z',...extra});
test('config so aceita Firebase QA e pacote chatqa',()=>{
 assert.equal(validatedQaAppId(local),appId);
 for(const patch of [
  {project_info:{project_id:'atrio-catolico',project_number:'123456789'}},
  {project_info:{project_id:project,project_number:'42'}},
  {client:[]}
 ]){
  assert.throws(()=>validatedQaAppId(JSON.stringify({...JSON.parse(local),...patch})),/qa_real_audit_/);
 }
});
test('4 GET exatos e token apenas em memoria: resumo nao vaza nada',async()=>{
 const s=setup();const result=await audit(s);
 assert.deepEqual(s.calls.map(c=>c.url),[
  base,base+'/androidApps/'+appId,
  'https://firebaserules.googleapis.com/v1/'+release,
  'https://firebaserules.googleapis.com/v1/'+ruleset]);
 assert.equal(s.requested(),1);
 assert.equal(result.remote_rules_deny_all,true);
 assert.equal(result.ready_for_activation,false);
 assert.equal(result.changes_performed,false);
 assert.equal(result.production_contacted,false);
 assert.ok(!JSON.stringify(result).includes(token));
 assert.ok(!JSON.stringify(result).includes('fake-not-a-real-key'));
});
test('Rules nao deny-all sao alerta, nunca aprovacao',async()=>{
 const s=setup({text:deny.replace('if false;','if true;')});
 const r=await audit(s);
 assert.equal(r.status,'QA_REAL_RULES_NOT_DENY_ALL');
 assert.equal(r.remote_rules_deny_all,false);
 assert.equal(r.ready_for_activation,false);
});
test('app divergente interrompe antes de GETs Firestore',async()=>{
 const s=setup({badApp:true});
 await assert.rejects(audit(s),/qa_real_audit_remote_verification_failed/);
 assert.equal(s.calls.length,2);
});
test('config ausente e login indisponivel impedem GET',async()=>{
 const s=setup();
 await assert.rejects(audit(s,{configLoader:async()=>'{broken'}),/qa_real_audit_config_invalid_or_missing/);
 assert.equal(s.calls.length,0);
 await assert.rejects(audit(s,{tokenProvider:async()=>{throw Error('secret');}}),/qa_real_audit_cli_login_unavailable/);
 assert.equal(s.calls.length,0);
});
test('erro de rede retorna apenas erro sanitizado',async()=>{
 const s=setup({network:true});
 await assert.rejects(audit(s),/qa_real_audit_remote_verification_failed/);
 assert.equal(s.calls.length,1);
});
