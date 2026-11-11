import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectQaAdminConfigReadOnly} from './termux-firebase-qa-admin-config-readonly.mjs';
import {STAGED_QA_DOCS} from '../firebase/qa-general/admin-config-preflight.mjs';
const project='atrio-catolico-qa-geral';
const base='https://firestore.googleapis.com/v1/projects/'+project+
 '/databases/(default)/documents/';
const token='qa-mocked-token-in-memory-not-real-123456789';
const ruleset='projects/'+project+'/rulesets/1d6b6a71-6d95-48cc-98fe-7bd16c71b3bc';
const baseline={
 project,android_package:'br.com.atriocatolico.chatqa',
 status:'QA_REAL_DENY_ALL_CONFIRMED',
 remote_project_and_app_verified:true,remote_firestore_rules_verified:true,
 remote_rules_deny_all:true,ready_for_activation:false,
 rules_sha256:'cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b',
 remote_ruleset_name:ruleset,changes_performed:false,production_contacted:false
};
const type=v=>typeof v==='boolean'?{booleanValue:v}:
 typeof v==='number'?{integerValue:String(v)}:{stringValue:v};
const paths=Object.keys(STAGED_QA_DOCS);
function fixture({missing=[],override={},extraFields={},snapshot={},denyHttp=false,malformed=false}={}){
 const calls=[];
 const fetcher=async (url,opts)=>{
  calls.push({url,opts});
  const u=new URL(url);
  const path=u.pathname.split('/documents/')[1];
  assert.equal(u.origin,'https://firestore.googleapis.com');
  assert.ok(paths.includes(path),'Only 4 static QA app_config documents');
  assert.equal(u.pathname, new URL(base+path).pathname);
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.cache,'no-store');
  assert.equal(opts.headers.Authorization,'Bearer '+token);
  assert.equal(opts.body,undefined);
  assert.deepEqual(u.searchParams.getAll('mask.fieldPaths'),
   Object.keys(STAGED_QA_DOCS[path]));
  if(denyHttp)return new Response('',{status:403});
  if(missing.includes(path))return new Response('',{status:404});
  if(malformed)return new Response('not-json',{status:200});
  const values={...STAGED_QA_DOCS[path],...(override[path]||{})};
  const fields=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,type(v)]));
  Object.assign(fields,extraFields[path]||{});
  return Response.json({
    name:'projects/'+project+'/databases/(default)/documents/'+path,fields
  });
 };
 let authCalls=0;
 const auth=async()=>{authCalls++;return token;};
 const auditor=async({tokenProvider,fetcher:provider})=>{
  assert.equal(await tokenProvider(),token);
  assert.equal(provider,fetcher);
  return {...baseline,...snapshot};
 };
 return {calls,auth,auditor,fetcher,authCalls:()=>authCalls};
}
const inspect=(f,extra={})=>inspectQaAdminConfigReadOnly({
 tokenProvider:f.auth,qaAuditor:f.auditor,fetcher:f.fetcher,
 timestamp:()=> '2026-11-11T04:00:00Z',...extra
});
test('4 GET mascarados depois de QA auditado; sem tokens, corpos ou usuarios',async()=>{
 const f=fixture();
 const out=await inspect(f);
 assert.equal(f.calls.length,4);
 assert.equal(f.authCalls(),1);
 assert.deepEqual(out.documents.map(x=>x.path),paths);
 assert.equal(out.existing_documents,4);
 assert.equal(out.missing_documents,0);
 assert.equal(out.all_four_staged_fields_match,true);
 assert.equal(out.chat_and_groups_observed_closed,true);
 assert.equal(out.ready_for_activation,false);
 assert.equal(out.ready_for_deploy,false);
 assert.equal(out.changes_performed,false);
 assert.equal(out.production_contacted,false);
 const displayed=JSON.stringify(out);
 assert.ok(!displayed.includes(token));
 assert.ok(!displayed.includes('refresh_token'));
 assert.ok(!displayed.includes('api_key'));
 assert.ok(!displayed.includes('birthDate'));
});
test('404 e documento ausente nao provam configuracao administrativa',async()=>{
 const f=fixture({missing:paths});
 const out=await inspect(f);
 assert.equal(out.existing_documents,0);
 assert.equal(out.missing_documents,4);
 assert.equal(out.all_four_staged_fields_match,false);
 assert.equal(out.chat_and_groups_observed_closed,true);
 assert.ok(out.documents.every(d=>d.state==='MISSING'&&d.enabled===null));
});
test('chat ou grupos previamente ativados sao sinalizados como NAO fechados',async()=>{
 for(const path of ['app_config/conversations','app_config/chat_groups']){
  for(const field of ['enabled','minorPolicyApproved']){
   const f=fixture({override:{[path]:{[field]:true}}});
   const out=await inspect(f);
   assert.equal(out.chat_and_groups_observed_closed,false);
   assert.equal(out.ready_for_activation,false);
   assert.equal(out.documents.find(d=>d.path===path).state,
    'PRESENT_STAGED_FIELDS_DIFFER');
  }
 }
});
test('campos esperados alterados sao informados somente por NOME',async()=>{
 const path='app_config/email_verification';
 const f=fixture({override:{[path]:{version:'do-not-leak-sensitive-text'}}});
 const out=await inspect(f);
 const item=out.documents.find(x=>x.path===path);
 assert.deepEqual(item.differs_field_names,['version']);
 assert.equal(item.version_matches_expected,false);
 assert.ok(!JSON.stringify(out).includes('do-not-leak-sensitive-text'));
});
test('qualquer campo extra enviado apesar da mascara aborta sem imprimir conteudo',async()=>{
 const f=fixture({extraFields:{'app_config/conversations':{
   secret:{stringValue:'unprintable-value'}
 }}});
 await assert.rejects(inspect(f),/qa_admin_remote_unmasked_content/);
});
test('404 nao mascara erro 403, resposta malformada ou fonte fora do QA',async()=>{
 for(const patch of [{denyHttp:true},{malformed:true}]){
  const f=fixture(patch);
  await assert.rejects(inspect(f),/qa_admin_remote_(firestore_permission_or_api_error|document_response_invalid)/);
  assert.equal(f.calls.length,1);
 }
 for(const snapshot of [
  {project:'atrio-catolico'},
  {android_package:'br.com.atriocatolico'},
  {status:'QA_REAL_RULES_NOT_DENY_ALL'},
  {remote_rules_deny_all:false},
  {rules_sha256:'a'.repeat(64)},
  {remote_ruleset_name:'projects/atrio-catolico/rulesets/unsafe'},
  {ready_for_activation:true},
  {production_contacted:true}
 ]){
  const f=fixture({snapshot});
  await assert.rejects(inspect(f),/qa_admin_remote_qa_snapshot_unverified/);
  assert.equal(f.calls.length,0);
 }
});
test('sem login ou erro da auditoria, nenhum GET Firestore acontece',async()=>{
 const f=fixture();
 await assert.rejects(inspect(f,{tokenProvider:async()=>{throw Error('secret');}}),
  /qa_admin_remote_cli_login_unavailable/);
 await assert.rejects(inspect(f,{qaAuditor:async()=>{throw Error('private');}}),
  /qa_admin_remote_qa_snapshot_unverified/);
 assert.equal(f.calls.length,0);
});
