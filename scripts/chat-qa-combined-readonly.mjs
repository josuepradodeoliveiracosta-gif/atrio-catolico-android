#!/usr/bin/env node
/**
 * QA: uma rodada de verificacoes remotas SOMENTE LEITURA, sem duplicar auditoria.
 * 4 GET identidade/Rules QA, 4 GET app_config com field mask, e 1 POST
 * projects.testIamPermissions (consulta, NAO modifica IAM).
 * Reutiliza os auditores existentes e uma unica sessao Firebase CLI.
 * Nao faz deploy, PATCH, escrita, contato com producao ou rollback.
 */
import {fileURLToPath} from 'node:url';
import {accessTokenFromExistingFirebaseCli}
  from './termux-email-production-readonly.mjs';
import {auditQaRealReadOnly} from './termux-firebase-qa-audit-readonly.mjs';
import {inspectQaAdminConfigReadOnly}
  from './termux-firebase-qa-admin-config-readonly.mjs';
import {checkQaIamReadOnly} from './termux-firebase-qa-iam-readonly.mjs';
import {evaluateQaRollbackLiveSnapshot}
  from './chat-qa-rollback-live-readonly.mjs';
import {STAGED_QA_DOCS}
  from '../firebase/qa-general/admin-config-preflight.mjs';
import {reviewGovernance,readGovernanceRecord}
  from './chat-qa-governance-preflight.mjs';

const PROJECT='atrio-catolico-qa-geral';
const PACKAGE='br.com.atriocatolico.chatqa';
const PATHS=Object.freeze(Object.keys(STAGED_QA_DOCS));
const fail=code=>{throw Error('qa_combined_readonly_'+code);};

export function summarizeQaReadOnly({audit,admin,iam,governance}){
 // O validador nao aceita auditoria de outra release, Rules abertas
 // ou referencia historica divergente, nem mesmo para emitir GO.
 let baseline;
 try{baseline=evaluateQaRollbackLiveSnapshot(audit);}
 catch{fail('baseline_invalid_or_changed');}
 if(!admin||typeof admin!=='object'||Array.isArray(admin)||
    admin.status!=='QA_ADMIN_CONFIG_SNAPSHOT_READ_ONLY' ||
    admin.project!==PROJECT||admin.android_package!==PACKAGE||
    admin.rules_sha256!==audit.rules_sha256||
    admin.ruleset_name!==audit.remote_ruleset_name||
    admin.queried_documents!==4||
    !Number.isInteger(admin.existing_documents)||
    !Number.isInteger(admin.missing_documents)||
    admin.existing_documents<0||admin.missing_documents<0||
    admin.existing_documents+admin.missing_documents!==4||
    !Array.isArray(admin.documents)||admin.documents.length!==4||
    typeof admin.all_four_staged_fields_match!=='boolean'||
    typeof admin.chat_and_groups_observed_closed!=='boolean'||
    admin.field_mask_excludes_other_fields!==true||
    admin.remote_rules_deny_all!==true||
    admin.ready_for_activation!==false||
    admin.ready_for_deploy!==false||
    admin.changes_performed!==false||
    admin.production_contacted!==false||
    admin.method!=='FOUR_QA_IDENTITY_RULES_GET_PLUS_FOUR_FIRESTORE_MASKED_GET'||
    typeof admin.audited_at!=='string'||
    Number.isNaN(Date.parse(admin.audited_at)))fail('config_invalid');
 let countPresent=0,allMatch=true,closed=true;
 const safeDocs=[];
 for(let i=0;i<4;i++){
   const d=admin.documents[i],path=PATHS[i];
   if(!d||typeof d!=='object'||Array.isArray(d)||d.path!==path||
      !['MISSING','PRESENT_STAGED_FIELDS_MATCH','PRESENT_STAGED_FIELDS_DIFFER'].includes(d.state)||
      typeof d.present!=='boolean'||
      typeof d.staged_fields_match!=='boolean'||
      !Array.isArray(d.differs_field_names)||
      d.differs_field_names.some(k=>typeof k!=='string'||
         !Object.hasOwn(STAGED_QA_DOCS[path],k))||
      (d.state==='MISSING'&&
        (d.present!==false||d.staged_fields_match!==false))||
      (d.state==='PRESENT_STAGED_FIELDS_MATCH'&&
        (d.present!==true||d.staged_fields_match!==true||d.differs_field_names.length!==0))||
      (d.state==='PRESENT_STAGED_FIELDS_DIFFER'&&
        (d.present!==true||d.staged_fields_match!==false))||
      (d.enabled!==null && typeof d.enabled!=='boolean')||
      (d.minor_policy_approved!==null&&typeof d.minor_policy_approved!=='boolean'))
        fail('config_document_invalid');
   countPresent+=Number(d.present);
   allMatch=allMatch&&d.staged_fields_match;
   const isChat=path==='app_config/conversations'||path==='app_config/chat_groups';
   if(isChat){
     if(d.chat_or_group_safely_disabled!==
         (d.state==='MISSING'||(d.enabled===false&&d.minor_policy_approved===false)))
       fail('config_closed_flag_inconsistent');
     closed=closed&&d.chat_or_group_safely_disabled===true;
   }else if(d.chat_or_group_safely_disabled!==null)fail('config_document_invalid');
   safeDocs.push(Object.freeze({path,state:d.state}));
 }
 if(countPresent!==admin.existing_documents||
    allMatch!==admin.all_four_staged_fields_match||
    closed!==admin.chat_and_groups_observed_closed)fail('config_counts_inconsistent');
 if(!iam||typeof iam!=='object'||Array.isArray(iam)||
    iam.status!=='QA_IAM_PERMISSION_SNAPSHOT_ONLY'||
    iam.project!==PROJECT||iam.android_package!==PACKAGE||
    iam.rules_sha256!==audit.rules_sha256||
    iam.ruleset_name!==audit.remote_ruleset_name||
    typeof iam.can_read_rules_in_qa!=='boolean'||
    typeof iam.may_have_publish_permissions_in_qa!=='boolean'||
    iam.checked_permissions_count!==5||
    !Number.isInteger(iam.granted_permissions_count)||
    iam.granted_permissions_count<0||iam.granted_permissions_count>5||
    iam.permission_check_method!=='POST_testIamPermissions_NO_MUTATION'||
    iam.permissions_do_not_prove_production_isolation!==true||
    iam.changes_performed!==false||iam.production_contacted!==false||
    iam.ready_for_activation!==false)fail('iam_invalid');
 if(!governance||typeof governance!=='object'||Array.isArray(governance)||
    governance.project!==PROJECT||governance.android_package!==PACKAGE||
    governance.required_reviews!==8||
    !Number.isInteger(governance.review_records_marked)||
    !Array.isArray(governance.pending_review_ids)||
    governance.review_records_marked+governance.pending_review_ids.length!==8||
    governance.review_records_are_not_legal_approvals!==true||
    governance.human_rollout_authorization_recorded!==false||
    governance.ready_for_qa_deploy!==false||
    governance.ready_for_production!==false||
    governance.remote_state_changed!==false||
    governance.production_contacted!==false)fail('governance_invalid');
 // Nunca refletir valores arbitrarios retornados pela nuvem no stdout.
 return Object.freeze({
   status:'QA_COMBINED_REMOTE_SNAPSHOT_NO_GO',
   project:PROJECT,android_package:PACKAGE,
   active_ruleset_matches_historical_at_read_time:
     baseline.reference_matches_at_read_time,
   remote_rules_deny_all:true,
   baseline_read_time:audit.audit_time_local,
   admin_config_read_time:admin.audited_at,
   snapshots_are_non_atomic_and_historical:true,
   queried_qa_identity_rules_gets:4,
   queried_qa_app_config_masked_gets:4,
   iam_permission_test_post_is_non_mutating:true,
   cli_login_reused:true,
   app_config_documents:Object.freeze(safeDocs),
   existing_app_config_documents:countPresent,
   missing_app_config_documents:4-countPresent,
   staged_config_matches:allMatch,
   chat_and_groups_observed_closed:closed,
   iam_checked_permission_count:iam.checked_permissions_count,
   iam_granted_permission_count:iam.granted_permissions_count,
   iam_can_read_rules:iam.can_read_rules_in_qa,
   iam_may_publish_rules:iam.may_have_publish_permissions_in_qa,
   production_permissions_and_isolation_not_verified:true,
   governance_reviews_pending:governance.pending_review_ids.length,
   governance_reviews_are_not_deploy_approvals:true,
   no_new_legal_approval_recorded:true,
   no_remote_write_performed:true,
   no_exact_rules_backup_created:true,
   ready_for_deploy:false,
   ready_for_activation:false,
   deploymentApproved:false,
   releaseApproved:false,
   rollbackApproved:false,
   production_contacted:false
 });
}

export async function runQaCombinedReadOnly({
 tokenProvider=accessTokenFromExistingFirebaseCli,
 qaAuditor=auditQaRealReadOnly,
 adminInspector=inspectQaAdminConfigReadOnly,
 iamInspector=checkQaIamReadOnly,
 governanceReader=readGovernanceRecord,
 governanceReviewer=reviewGovernance
}={}){
 let token;
 try{token=await tokenProvider();}catch{fail('login_unavailable');}
 if(typeof token!=='string'||token.length<20||token.length>12000)
   fail('login_unavailable');
 const cached=async()=>token;
 let audit;
 try{audit=await qaAuditor({tokenProvider:cached});}
 catch{fail('qa_audit_failed');}
 // A identidade/base deve estar validada ANTES de consultar app_config/IAM.
 try{evaluateQaRollbackLiveSnapshot(audit);}
 catch{fail('baseline_invalid_or_changed');}
 // Sem repeticao dos 4 GETs: ambos reutilizam o mesmo snapshot auditado.
 const sameAudit=async()=>audit;
 let admin;
 try{admin=await adminInspector({tokenProvider:cached,qaAuditor:sameAudit});}
 catch{fail('admin_read_failed');}
 // Falha fechada ANTES da consulta IAM se houver resposta admin adulterada.
 // O resumo valida os campos apos a leitura IAM sem expor dados da nuvem.
 if(admin?.project!==PROJECT||admin?.rules_sha256!==audit.rules_sha256||
    admin?.changes_performed!==false||admin?.production_contacted!==false)
   fail('admin_invalid');
 let iam;
 try{iam=await iamInspector({tokenProvider:cached,qaAuditor:sameAudit});}
 catch{fail('iam_read_failed');}
 let gov;
 try{gov=governanceReviewer(governanceReader());}
 catch{fail('governance_invalid');}
 return summarizeQaReadOnly({audit,admin,iam,governance:gov});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
   if(process.argv.length!==2)fail('arguments_denied');
   const report=await runQaCombinedReadOnly();
   console.log(JSON.stringify(report,null,2));
   if(!report.chat_and_groups_observed_closed)process.exitCode=2;
 }catch(e){
   console.error(/^qa_combined_readonly_[a-z0-9_]+$/.test(e?.message||'')
     ?e.message:'qa_combined_readonly_failed_closed');
   process.exitCode=1;
 }
}
