#!/usr/bin/env node
/**
 * QA REAL: inspecao de QUATRO documentos app_config com GET e field masks.
 * Revalida antes identidade, RuleSet e deny-all via quatro GETs QA.
 * OAuth do Firebase CLI fica SOMENTE na memoria. Dados integrais, tokens,
 * politicas de usuarios e credenciais NAO sao impressos ou gravados.
 * Nao ha Firebase Admin SDK, comando de deploy, mutacao ou chamada a producao.
 */
import {fileURLToPath} from 'node:url';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';
import {auditQaRealReadOnly} from './termux-firebase-qa-audit-readonly.mjs';
import {STAGED_QA_DOCS} from '../firebase/qa-general/admin-config-preflight.mjs';

const PROJECT='atrio-catolico-qa-geral';
const PACKAGE='br.com.atriocatolico.chatqa';
const BASE='https://firestore.googleapis.com/v1/projects/'+PROJECT+
  '/databases/(default)/documents/';
const EXPECTED_RULES_SHA256='cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b';
const EXPECTED_RULESET='projects/'+PROJECT+
  '/rulesets/1d6b6a71-6d95-48cc-98fe-7bd16c71b3bc';
const PATHS=Object.freeze([
 'app_config/email_verification',
 'app_config/community_rules',
 'app_config/conversations',
 'app_config/chat_groups'
]);
const fail=code=>{throw Error('qa_admin_remote_'+code);};

function exactQaSnapshot(x){
 return x?.project===PROJECT &&
   x?.android_package===PACKAGE &&
   x?.status==='QA_REAL_DENY_ALL_CONFIRMED' &&
   x?.remote_project_and_app_verified===true &&
   x?.remote_firestore_rules_verified===true &&
   x?.remote_rules_deny_all===true &&
   x?.rules_sha256===EXPECTED_RULES_SHA256 &&
   x?.remote_ruleset_name===EXPECTED_RULESET &&
   x?.changes_performed===false &&
   x?.production_contacted===false &&
   x?.ready_for_activation===false;
}

function maskedUrl(path, expected){
 if(!PATHS.includes(path))fail('unexpected_path');
 const url=new URL(BASE+path);
 for(const field of Object.keys(expected))url.searchParams.append('mask.fieldPaths',field);
 return url.toString();
}

function typedValue(v){
 if(!v||typeof v!=='object'||Array.isArray(v))return undefined;
 if(Object.keys(v).length!==1)return undefined;
 if(Object.hasOwn(v,'booleanValue') && typeof v.booleanValue==='boolean')
   return v.booleanValue;
 if(Object.hasOwn(v,'stringValue') && typeof v.stringValue==='string')
   return v.stringValue;
 if(Object.hasOwn(v,'integerValue') && /^-?[0-9]{1,18}$/.test(v.integerValue))
   return Number(v.integerValue);
 return undefined;
}
function summarizeMaskedDoc(path,body){
 const expected=STAGED_QA_DOCS[path];
 const name='projects/'+PROJECT+'/databases/(default)/documents/'+path;
 if(!body||typeof body!=='object'||Array.isArray(body)||
    body.name!==name||!body.fields||typeof body.fields!=='object'||
    Array.isArray(body.fields))fail('unexpected_document');
 const fields=body.fields,mask=Object.keys(expected);
 // A field-mask nao deve retornar nenhum campo de fora do esquema aprovado.
 if(Object.keys(fields).some(k=>!mask.includes(k)))fail('unmasked_content');
 const differs=mask.filter(k=>typedValue(fields[k])!==expected[k]);
 const state=differs.length===0?'PRESENT_STAGED_FIELDS_MATCH':
   'PRESENT_STAGED_FIELDS_DIFFER';
 const enabled=typedValue(fields.enabled);
 const minor=Object.hasOwn(expected,'minorPolicyApproved')?
   typedValue(fields.minorPolicyApproved):null;
 return Object.freeze({
  path,state,
  present:true,staged_fields_match:differs.length===0,
  differs_field_names:differs,
  // Sinais publicos de configuracao, nunca valores arbitrarios.
  enabled:typeof enabled==='boolean'?enabled:null,
  minor_policy_approved:typeof minor==='boolean'?minor:null,
  version_matches_expected:
    typedValue(fields.version)===expected.version,
  chat_or_group_safely_disabled:
    path==='app_config/conversations'||path==='app_config/chat_groups'
      ? enabled===false && minor===false : null
 });
}
function missingDoc(path){
 return Object.freeze({
  path,state:'MISSING',present:false,staged_fields_match:false,
  differs_field_names:[],enabled:null,minor_policy_approved:null,
  version_matches_expected:null,
  chat_or_group_safely_disabled:
    path==='app_config/conversations'||path==='app_config/chat_groups'
      ? true : null
 });
}
export async function inspectQaAdminConfigReadOnly({
 tokenProvider=accessTokenFromExistingFirebaseCli,
 qaAuditor=auditQaRealReadOnly,
 fetcher=fetch,
 timestamp=()=>new Date().toISOString()
}={}){
 let token;
 try{token=await tokenProvider();}catch{fail('cli_login_unavailable');}
 if(typeof token!=='string'||token.length<20||token.length>12000)
   fail('cli_login_unavailable');
 let snapshot;
 try{snapshot=await qaAuditor({tokenProvider:async()=>token,fetcher});}
 catch{fail('qa_snapshot_unverified');}
 if(!exactQaSnapshot(snapshot))fail('qa_snapshot_unverified');
 const docs=[];
 for(const path of PATHS){
   const url=maskedUrl(path,STAGED_QA_DOCS[path]);
   let res;
   try{
    res=await fetcher(url,{
     method:'GET',redirect:'error',cache:'no-store',
     headers:{Authorization:'Bearer '+token,Accept:'application/json'},
     signal:AbortSignal.timeout(12000)
    });
   }catch{fail('firestore_request_failed');}
   if(res?.status===404){docs.push(missingDoc(path));continue;}
   if(!res?.ok)fail('firestore_permission_or_api_error');
   let data;
   try{
     const raw=await res.text();
     if(raw.length>32768)fail('document_response_invalid');
     data=JSON.parse(raw);
   }catch{fail('document_response_invalid');}
   docs.push(summarizeMaskedDoc(path,data));
 }
 const chat=docs.find(x=>x.path==='app_config/conversations');
 const groups=docs.find(x=>x.path==='app_config/chat_groups');
 return Object.freeze({
  status:'QA_ADMIN_CONFIG_SNAPSHOT_READ_ONLY',
  project:PROJECT,android_package:PACKAGE,
  rules_sha256:snapshot.rules_sha256,
  ruleset_name:snapshot.remote_ruleset_name,
  queried_documents:docs.length,existing_documents:docs.filter(x=>x.present).length,
  missing_documents:docs.filter(x=>!x.present).length,
  documents:docs,
  all_four_staged_fields_match:docs.every(x=>x.staged_fields_match),
  chat_and_groups_observed_closed:
    chat.chat_or_group_safely_disabled===true &&
    groups.chat_or_group_safely_disabled===true,
  field_mask_excludes_other_fields:true,
  remote_rules_deny_all:true,
  ready_for_activation:false,ready_for_deploy:false,
  changes_performed:false,production_contacted:false,
  method:'FOUR_QA_IDENTITY_RULES_GET_PLUS_FOUR_FIRESTORE_MASKED_GET',
  audited_at:timestamp(),
  warning:'IAM OAuth le app_config; fields fora da mascara NAO sao auditados; nunca autoriza deploy.'
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
   if(process.argv.length!==2)fail('arguments_denied');
   const result=await inspectQaAdminConfigReadOnly();
   console.log(JSON.stringify(result,null,2));
   // Divergencia significa configuracao a revisar, nao autoriza correcoes.
   if(!result.chat_and_groups_observed_closed)process.exitCode=2;
 }catch(e){
   console.error(/^qa_admin_remote_[a-z0-9_]+$/.test(e?.message||'')
     ?e.message:'qa_admin_remote_failed_closed');
   process.exitCode=1;
 }
}
