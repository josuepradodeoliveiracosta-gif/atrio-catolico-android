#!/usr/bin/env node
// QUATRO GETs autenticados, SOMENTE QA. Nao publica, nao grava, nao exibe credenciais.
import {fileURLToPath} from 'node:url';
import {lstat,readFile} from 'node:fs/promises';
import {inspectFirebaseQaIdentity} from './termux-firebase-qa-identity-readonly.mjs';
import {inspectQaRules} from './termux-firestore-qa-readonly.mjs';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';
const PROJECT='atrio-catolico-qa-geral';
const PACKAGE='br.com.atriocatolico.chatqa';
const CONFIG=new URL('../app/src/chatQa/google-services.json',import.meta.url);
const fail=code=>{throw Error('qa_real_audit_'+code);};

export function validatedQaAppId(raw){
 if(typeof raw!=='string'||raw.length>65536)fail('config_invalid');
 let data;
 try{data=JSON.parse(raw);}catch{fail('config_invalid');}
 if(data?.project_info?.project_id!==PROJECT||
   !/^[0-9]+$/.test(String(data?.project_info?.project_number||''))||
   !Array.isArray(data.client)||data.client.length!==1)fail('config_not_qa');
 const info=data.client[0]?.client_info;
 const id=info?.mobilesdk_app_id;
 if(typeof id!=='string'|| !/^1:[0-9]+:android:[a-fA-F0-9]+$/.test(id)||
   id.split(':')[1]!==String(data.project_info.project_number)||
   info?.android_client_info?.package_name!==PACKAGE)fail('app_not_qa');
 return id;
}
async function loadQaConfig(){
 let stat,raw;
 try{
  stat=await lstat(CONFIG);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)fail('config_unsafe');
  raw=await readFile(CONFIG,'utf8');
 }catch{fail('config_unavailable');}
 return raw;
}
export async function auditQaRealReadOnly({
 configLoader=loadQaConfig,
 tokenProvider=accessTokenFromExistingFirebaseCli,
 identityInspector=inspectFirebaseQaIdentity,
 rulesInspector=inspectQaRules,
 fetcher=fetch,
 timestamp=()=>new Date().toISOString()
}={}){
 let appId,token,id,rules;
 try{appId=validatedQaAppId(await configLoader());}
 catch{fail('config_invalid_or_missing');}
 try{token=await tokenProvider();}catch{fail('cli_login_unavailable');}
 if(typeof token!=='string'||token.length<20||token.length>12000)
   fail('cli_login_unavailable');
 const cached=async()=>token;
 try{
  id=await identityInspector({expectedAppId:appId,tokenProvider:cached,fetcher});
  if(id?.firebase_project_id!==PROJECT||id?.android_package!==PACKAGE||
    id?.firebase_android_app_id!==appId||id?.cloud_metadata_verified!==true||
    id?.deploy_performed!==false||id?.production_contacted!==false)
      fail('identity_mismatch');
  rules=await rulesInspector({tokenProvider:cached,fetcher});
  if(rules?.project!==PROJECT||rules?.deployPerformed!==false||
    rules?.productionContacted!==false||rules?.safeToEnableChat!==false||
    !/^[0-9a-f]{64}$/.test(rules?.sha256||'')||
    !/^projects[/]atrio-catolico-qa-geral[/]rulesets[/][A-Za-z0-9_-]{1,120}$/.test(
      rules?.rulesetName||''))
      fail('rules_mismatch');
 }catch{fail('remote_verification_failed');}
 if(typeof rules.firestoreRulesCurrentlyDenyAll!=='boolean')fail('rules_mismatch');
 const closed=rules.firestoreRulesCurrentlyDenyAll;
 return Object.freeze({
  status:closed?'QA_REAL_DENY_ALL_CONFIRMED':'QA_REAL_RULES_NOT_DENY_ALL',
  project:PROJECT,android_package:PACKAGE,firebase_android_app_id:appId,
  rules_sha256:rules.sha256,
  remote_ruleset_name:rules.rulesetName,remote_project_and_app_verified:true,
  remote_firestore_rules_verified:true,remote_rules_deny_all:closed,
  ready_for_activation:false,method:'FOUR_QA_GET',
  audit_time_local:timestamp(),production_contacted:false,
  changes_performed:false
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)fail('arguments_denied');
  const result=await auditQaRealReadOnly();
  console.log(JSON.stringify(result,null,2));
  if(!result.remote_rules_deny_all)process.exitCode=2;
 }catch(e){
  console.error(/^qa_real_audit_[a-z0-9_]+$/.test(e?.message||'')
    ?e.message:'qa_real_audit_failed_closed');
  process.exitCode=1;
 }
}
