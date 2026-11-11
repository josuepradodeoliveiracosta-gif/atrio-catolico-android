#!/usr/bin/env node
/**
 * TESTE DE PERMISSÕES QA: chamada POST do método Google Cloud
 * projects.testIamPermissions(), que SOMENTE RETORNA as permissões do
 * chamador. POST é exigido pela API; NÃO é setIamPolicy e NÃO altera IAM.
 * Exige 4 GETs de identidade/Rules QA e o deny-all confirmado antes do POST.
 * SEM acesso ao projeto de produção; SEM deploy, tokens, contas ou IAM listados.
 */
import {fileURLToPath} from 'node:url';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';
import {auditQaRealReadOnly} from './termux-firebase-qa-audit-readonly.mjs';

const PROJECT='atrio-catolico-qa-geral';
const URL='https://cloudresourcemanager.googleapis.com/v1/projects/'+PROJECT+':testIamPermissions';
export const CHECKED_PERMISSIONS=Object.freeze([
  'resourcemanager.projects.get',
  'firebaserules.releases.get',
  'firebaserules.rulesets.get',
  'firebaserules.rulesets.create',
  'firebaserules.releases.update'
]);
const fail=code=>{throw Error('qa_iam_readonly_'+code);};
export async function checkQaIamReadOnly({
 tokenProvider=accessTokenFromExistingFirebaseCli,
 qaAuditor=auditQaRealReadOnly,
 fetcher=fetch
}={}){
 let token;
 try{token=await tokenProvider();}catch{fail('login_unavailable');}
 if(typeof token!=='string'||token.length<20||token.length>12000)
   fail('login_unavailable');

 let snapshot;
 try{snapshot=await qaAuditor({tokenProvider:async()=>token,fetcher});}
 catch{fail('qa_identity_or_rules_unverified');}
 if(snapshot?.project!==PROJECT||
    snapshot?.status!=='QA_REAL_DENY_ALL_CONFIRMED'||
    snapshot?.android_package!=='br.com.atriocatolico.chatqa'||
    snapshot?.remote_project_and_app_verified!==true||
    snapshot?.remote_firestore_rules_verified!==true||
    snapshot?.remote_rules_deny_all!==true||
    snapshot?.production_contacted!==false||
    snapshot?.changes_performed!==false||
    snapshot?.ready_for_activation!==false||
    !/^[a-f0-9]{64}$/.test(snapshot?.rules_sha256||'')||
    !/^projects[/]atrio-catolico-qa-geral[/]rulesets[/][A-Za-z0-9_-]{1,120}$/.test(
      snapshot?.remote_ruleset_name||''))
   fail('qa_identity_or_rules_unverified');

 let response;
 try{
   response=await fetcher(URL,{
     method:'POST',redirect:'error',cache:'no-store',
     headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
     body:JSON.stringify({permissions:CHECKED_PERMISSIONS}),
     signal:AbortSignal.timeout(12000)
   });
 }catch{fail('iam_read_failed');}
 if(!response?.ok)fail('iam_read_failed');
 let parsed;
 try{
  const raw=await response.text();
  if(raw.length>8192)fail('iam_response_invalid');
  parsed=JSON.parse(raw);
 }catch{fail('iam_response_invalid');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
    !Array.isArray(parsed.permissions))fail('iam_response_invalid');
 const granted=parsed.permissions;
 if(granted.length>CHECKED_PERMISSIONS.length ||
    granted.some(x=>typeof x!=='string'||!CHECKED_PERMISSIONS.includes(x))||
    new Set(granted).size!==granted.length)fail('iam_response_invalid');
 const readRules=granted.includes('firebaserules.releases.get')&&
   granted.includes('firebaserules.rulesets.get');
 const writeRules=granted.includes('firebaserules.rulesets.create')&&
   granted.includes('firebaserules.releases.update');
 return Object.freeze({
  status:'QA_IAM_PERMISSION_SNAPSHOT_ONLY',
  project:PROJECT,android_package:'br.com.atriocatolico.chatqa',
  rules_sha256:snapshot.rules_sha256,
  ruleset_name:snapshot.remote_ruleset_name,
  can_read_rules_in_qa:readRules,
  may_have_publish_permissions_in_qa:writeRules,
  checked_permissions_count:CHECKED_PERMISSIONS.length,
  granted_permissions_count:granted.length,
  permission_check_method:'POST_testIamPermissions_NO_MUTATION',
  changes_performed:false,production_contacted:false,
  permissions_do_not_prove_production_isolation:true,
  ready_for_activation:false,
  note:'Snapshot IAM nao comprova seguranca integral, acesso exclusivo nem autorizacao de deploy.'
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)fail('arguments_denied');
  console.log(JSON.stringify(await checkQaIamReadOnly(),null,2));
 }catch(e){
  console.error(/^qa_iam_readonly_[a-z0-9_]+$/.test(e?.message||'')
    ?e.message:'qa_iam_readonly_failed_closed');
  process.exitCode=1;
 }
}
