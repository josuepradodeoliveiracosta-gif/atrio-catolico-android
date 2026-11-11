#!/usr/bin/env node
/**
 * CONTRATO OFFLINE da configuração administrativa do Chat QA.
 * Não importa firebase-admin, não lê credenciais, não possui fetch,
 * não escreve, não chama Google/Cloudflare e não imprime comandos de deploy.
 *
 * Configuracao ESTAGIADA (chat fechado), NÃO a configuração real remota.
 * O modo fictício de chat aberto é exercitado somente no emulador de Rules.
 */
import {fileURLToPath} from 'node:url';
const PROJECT='atrio-catolico-qa-geral';
const PACKAGE='br.com.atriocatolico.chatqa';
const fail=code=>{throw Error('chat_qa_admin_config_'+code);};
const freeze=x=>Object.freeze(x);
const DOCS=freeze({
 email:'app_config/email_verification',
 community:'app_config/community_rules',
 conversations:'app_config/conversations',
 groups:'app_config/chat_groups'
});
const expected=freeze({
 email:freeze({enabled:true,version:'2026-11-v1'}),
 community:freeze({enabled:true,version:'2026-11-v1'}),
 conversations:freeze({
   enabled:false,version:'2026-11-v1',
   minorPolicyApproved:false,safetyReviewVersion:'pending-review',
   editEnabled:false,deleteEnabled:false,
   editWindowMinutes:0,deleteWindowMinutes:0
 }),
 groups:freeze({
   enabled:false,minorPolicyApproved:false,version:'2026-11-groups-v1'
 })
});
export const STAGED_QA_DOCS=freeze(
 Object.fromEntries(Object.entries(DOCS).map(([key,path])=>[path,expected[key]]))
);
export const LAB_ONLY_ACTIVE_CHAT=freeze({
 enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
 safetyReviewVersion:'2026-11-safety-v1'
});
function checkExact(value,template,kind){
 if(!value||typeof value!=='object'||Array.isArray(value))fail(kind+'_not_object');
 const keys=Object.keys(template);
 if(Object.keys(value).length!==keys.length||keys.some(key=>
     !Object.hasOwn(value,key)||value[key]!==template[key]))
   fail(kind+'_not_staged');
}
export function validateStagedQaDocs(config){
 if(!config||typeof config!=='object'||Array.isArray(config))fail('root_invalid');
 const paths=Object.values(DOCS);
 if(Object.keys(config).length!==paths.length||
    paths.some(x=>!Object.hasOwn(config,x)))fail('paths_not_exclusive');
 for(const [key,path] of Object.entries(DOCS))checkExact(config[path],expected[key],key);
 return freeze({
  mode:'LOCAL_STAGED_QA_CONFIG_NO_WRITE',
  project:PROJECT,android_package:PACKAGE,
  documents_checked:paths.length,
  email_verification_required:true,
  community_rules_acceptance_required:true,
  conversations_enabled:false,
  minor_policy_approved:false,
  groups_enabled:false,group_minor_policy_approved:false,
  push_worker_enabled:false,ready_for_deploy:false,
  remote_state_checked:false,changes_performed:false,
  production_contacted:false,
  blockers:[
   'aprovacao da issue 200 para eventual uso com participantes externos',
   'publicacao controlada e autorizada de Rules e documentos somente no QA',
   'verificar compatibilidade de cadastro e chat em dois dispositivos',
   'revalidar Ruleset IAM rollback e configuração remota antes da ativacao',
   'autorizar a mudanca de enabled apenas em etapa separada e auditada'
  ]
 });
}
export function validateAndroidPolicyAnchors({emailSource,communitySource,chatSource,groupRules}){
 for(const [name,s] of Object.entries({emailSource,communitySource,chatSource,groupRules})){
  if(typeof s!=='string'||s.length<100)fail('android_source_missing_'+name);
 }
 const anchors=[
  [emailSource,'qaEmailVerificationPolicyFromServer'],
  [emailSource,'2026-11-v1'],
  [communitySource,'const val VERSION = "2026-11-v1"'],
  [chatSource,'const val VERSION = "2026-11-v1"'],
  [chatSource,'2026-11-safety-v1'],
  [groupRules,"config.get('minorPolicyApproved',false) == true"],
  [groupRules,"'2026-11-groups-v1'"]
 ];
 if(anchors.some(([src,fragment])=>!src.includes(fragment)))
   fail('version_gate_mismatch');
 return true;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)fail('arguments_denied');
  console.log(JSON.stringify(validateStagedQaDocs(STAGED_QA_DOCS),null,2));
 }catch(e){
  console.error(/^chat_qa_admin_config_[a-z0-9_]+$/.test(e?.message||'')
   ?e.message:'chat_qa_admin_config_failed_closed');
  process.exitCode=1;
 }
}
