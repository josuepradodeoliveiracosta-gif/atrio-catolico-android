#!/usr/bin/env node
/**
 * DOCUMENTO DE PLANEJAMENTO, SEM OPERAÇÃO DE ESCRITA.
 * Define intenções de criação exclusiva de quatro documentos app_config QA,
 * sem credenciais, HTTP, filesystem mutável, SDK ou comando deploy.
 * NÃO fornece executar/aplicar/reverter. Requer autorização posterior.
 */
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {STAGED_QA_DOCS,validateStagedQaDocs}
 from '../firebase/qa-general/admin-config-preflight.mjs';

const PROJECT='atrio-catolico-qa-geral';
const PACKAGE='br.com.atriocatolico.chatqa';
const RULES='cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b';
const RULESET='projects/'+PROJECT+
 '/rulesets/1d6b6a71-6d95-48cc-98fe-7bd16c71b3bc';
const PATHS=Object.freeze([
 'app_config/email_verification','app_config/community_rules',
 'app_config/conversations','app_config/chat_groups'
]);
const fail=code=>{throw Error('qa_initial_create_plan_'+code);};
export const OPERATOR_OBSERVATION=Object.freeze({
 evidence_source:'OPERATOR_SCREENSHOTS_NOT_LIVE_QUERY',
 observed_at:'2026-11-11T03:33:17.816Z',
 project:PROJECT,android_package:PACKAGE,
 status:'QA_ADMIN_CONFIG_SNAPSHOT_READ_ONLY',
 rules_sha256:RULES,ruleset_name:RULESET,
 queried_documents:4,existing_documents:0,missing_documents:4,
 remote_rules_deny_all:true,
 chat_and_groups_observed_closed:true,
 ready_for_activation:false,ready_for_deploy:false,
 changes_performed:false,production_contacted:false,
 documents:Object.freeze(PATHS.map(path=>Object.freeze({path,state:'MISSING',present:false})))
});
function assertObservedFourMissing(snapshot){
 if(!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot) ||
    snapshot.evidence_source!=='OPERATOR_SCREENSHOTS_NOT_LIVE_QUERY'||
    snapshot.observed_at!==OPERATOR_OBSERVATION.observed_at||
    snapshot.project!==PROJECT ||snapshot.android_package!==PACKAGE||
    snapshot.status!=='QA_ADMIN_CONFIG_SNAPSHOT_READ_ONLY'||
    snapshot.rules_sha256!==RULES||snapshot.ruleset_name!==RULESET||
    snapshot.queried_documents!==4||snapshot.existing_documents!==0||
    snapshot.missing_documents!==4||
    snapshot.remote_rules_deny_all!==true||
    snapshot.chat_and_groups_observed_closed!==true||
    snapshot.ready_for_activation!==false||snapshot.ready_for_deploy!==false||
    snapshot.changes_performed!==false||snapshot.production_contacted!==false||
    !Array.isArray(snapshot.documents)||snapshot.documents.length!==4)
   fail('observation_mismatch');
 const received=snapshot.documents.map(doc=>{
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||doc.state!=='MISSING'||
     doc.present!==false||typeof doc.path!=='string')fail('document_not_missing');
  return doc.path;
 });
 if(new Set(received).size!==4||received.some((path,i)=>path!==PATHS[i]))
   fail('document_paths_changed');
}
const fieldToFirestore=x=>{
 if(typeof x==='boolean')return Object.freeze({booleanValue:x});
 if(typeof x==='string')return Object.freeze({stringValue:x});
 if(Number.isSafeInteger(x))return Object.freeze({integerValue:String(x)});
 fail('unsupported_field');
};
export function prepareQaAdminCreatePlan({
 observation=OPERATOR_OBSERVATION,stagedDocs=STAGED_QA_DOCS
}={}){
 assertObservedFourMissing(observation);
 const admin=validateStagedQaDocs(stagedDocs);
 if(admin.ready_for_deploy!==false ||
    admin.conversations_enabled!==false || admin.groups_enabled!==false ||
    admin.minor_policy_approved!==false ||
    admin.group_minor_policy_approved!==false)fail('not_closed');
 const intents=PATHS.map(path=>{
  const documentId=path.split('/')[1];
  const data=stagedDocs[path];
  const document=Object.freeze({
   fields:Object.freeze(Object.fromEntries(Object.entries(data)
    .map(([key,value])=>[key,fieldToFirestore(value)])))
  });
  const fingerprint=createHash('sha256')
   .update(JSON.stringify({path,document}),'utf8').digest('hex');
  return Object.freeze({
   path,collection:'app_config',document_id:documentId,
   future_method:'CREATE_DOCUMENT_ONLY_IF_ABSENT_NOT_UPDATE_OR_UPSERT',
   on_already_exists:'ABORT_WITHOUT_OVERWRITE',
   firestore_fields:document.fields,
   desired_document_sha256:fingerprint,
   remotely_created:false
  });
 });
 const chat=intents.find(x=>x.path==='app_config/conversations');
 const groups=intents.find(x=>x.path==='app_config/chat_groups');
 if(chat.firestore_fields.enabled.booleanValue!==false||
    chat.firestore_fields.minorPolicyApproved.booleanValue!==false||
    groups.firestore_fields.enabled.booleanValue!==false||
    groups.firestore_fields.minorPolicyApproved.booleanValue!==false)
   fail('not_closed');
 return Object.freeze({
  mode:'OFFLINE_PLAN_ONLY_NO_NETWORK_OR_WRITES',
  project:PROJECT,android_package:PACKAGE,
  evidence_source:observation.evidence_source,
  observed_at:observation.observed_at,
  baseline_rules_sha256:RULES,
  baseline_ruleset_name:RULESET,
  snapshot_is_historical:true,
  requires_new_remote_read_before_any_write:true,
  operator_approval_recorded:false,
  legal_and_moderation_review_approved:false,
  all_four_currently_absent_unverified:true,
  planned_documents:intents.length,
  creation_intents:Object.freeze(intents),
  overwrite_allowed:false,
  partial_failure_policy:'STOP_AND_RECONCILE_NOT_RETRY_BLINDLY',
  chat_enabled:false,groups_enabled:false,push_enabled:false,
  stage_is_email_community_only_with_chat_closed:true,
  ready_for_deploy:false,ready_for_activation:false,
  remote_state_changed:false,changes_performed:false,
  production_contacted:false,
  pending_requirements:Object.freeze([
   'revisar e aprovar politicas de email, regras da comunidade e issue 200',
   'aprovar explicitamente somente esta escrita de quatro documentos QA',
   'revalidar identidade, Ruleset, IAM e ausencia de cada documento imediatamente antes',
   'fazer criacao exclusiva: documento preexistente deve abortar sem sobrescrever',
   'validar cada criacao no servidor e parar diante de erro ou resultado parcial',
   'manter Rules deny-all, chat, grupos e push desligados nesta fase',
   'autorizar separadamente Rules candidatas apos testes e rollback revistos'
  ])
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)fail('arguments_denied');
  const report=prepareQaAdminCreatePlan();
  console.log(JSON.stringify(report,null,2));
 }catch(e){
  console.error(/^qa_initial_create_plan_[a-z0-9_]+$/.test(e?.message||'')
   ?e.message:'qa_initial_create_plan_failed_closed');
  process.exitCode=1;
 }
}
