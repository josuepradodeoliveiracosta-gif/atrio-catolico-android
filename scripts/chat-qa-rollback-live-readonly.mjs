#!/usr/bin/env node
/**
 * Reconfere SOMENTE POR LEITURA a referencia historica de rollback QA.
 * Reaproveita os QUATRO GETs do auditor QA existente; sem Firebase Admin,
 * PATCH, deploy, backups ou consultas ao projeto de producao.
 * Um resultado positivo apenas comprova igualdade NO MOMENTO DA LEITURA.
 */
import {fileURLToPath} from 'node:url';
import {auditQaRealReadOnly} from './termux-firebase-qa-audit-readonly.mjs';
import {OBSERVED_IAM_QA,prepareQaRollbackReference}
  from './chat-qa-rollback-reference.mjs';

const fail=code=>{throw Error('qa_rollback_live_'+code);};
const EXACT_AUDIT_KEYS=Object.freeze([
  'status','project','android_package','firebase_android_app_id',
  'rules_sha256','remote_ruleset_name','remote_project_and_app_verified',
  'remote_firestore_rules_verified','remote_rules_deny_all',
  'ready_for_activation','method','audit_time_local',
  'production_contacted','changes_performed'
]);
export function evaluateQaRollbackLiveSnapshot(audit){
 const historical=prepareQaRollbackReference();
 if(!audit || typeof audit!=='object' || Array.isArray(audit) ||
    Object.keys(audit).length!==EXACT_AUDIT_KEYS.length ||
    EXACT_AUDIT_KEYS.some(key=>!Object.hasOwn(audit,key)) ||
    audit.project!==historical.project ||
    audit.android_package!==historical.android_package ||
    audit.status!=='QA_REAL_DENY_ALL_CONFIRMED' ||
    audit.method!=='FOUR_QA_GET' ||
    !/^1:[0-9]+:android:[a-fA-F0-9]+$/.test(audit.firebase_android_app_id||'') ||
    audit.remote_project_and_app_verified!==true ||
    audit.remote_firestore_rules_verified!==true ||
    audit.remote_rules_deny_all!==true ||
    audit.ready_for_activation!==false ||
    audit.changes_performed!==false ||
    audit.production_contacted!==false ||
    typeof audit.audit_time_local!=='string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(audit.audit_time_local) ||
    Number.isNaN(Date.parse(audit.audit_time_local)) ||
    !/^projects\/atrio-catolico-qa-geral\/rulesets\/[a-zA-Z0-9_-]{1,120}$/.test(audit.remote_ruleset_name||'') ||
    !/^[0-9a-f]{64}$/.test(audit.rules_sha256||''))
   fail('audit_invalid_or_untrusted');
 if(audit.remote_ruleset_name!==OBSERVED_IAM_QA.ruleset_name ||
    audit.rules_sha256!==OBSERVED_IAM_QA.rules_sha256)
   fail('historical_ruleset_not_active_or_modified');
 return Object.freeze({
   status:'QA_ROLLBACK_REFERENCE_MATCH_AT_READ_TIME_NO_GO',
   project:historical.project,
   android_package:historical.android_package,
   verified_release_name:historical.release_name,
   active_ruleset_name:audit.remote_ruleset_name,
   active_rules_sha256:audit.rules_sha256,
   reference_matches_at_read_time:true,
   snapshot_time:audit.audit_time_local,
   snapshot_stale_after_read:true,
   read_only_qa_get_requests:4,
   method:'REUSE_EXISTING_QA_AUDITOR',
   historical_iam_is_not_current_iam_audit:true,
   production_isolation_still_unverified:true,
   current_rollback_target_after_future_rollout_not_guaranteed:true,
   rule_propagation_not_tested:true,
   no_exact_backup_created:true,
   deploymentApproved:false,
   releaseApproved:false,
   rollbackApproved:false,
   ready_for_activation:false,
   deploy_performed:false,
   rollback_performed:false,
   changes_performed:false,
   production_contacted:false
 });
}

export async function checkQaRollbackLiveReadOnly({auditor=auditQaRealReadOnly}={}){
 let snapshot;
 try{snapshot=await auditor();}
 catch{fail('audit_failed_closed');}
 return evaluateQaRollbackLiveSnapshot(snapshot);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
   if(process.argv.length!==2)fail('arguments_denied');
   console.log(JSON.stringify(await checkQaRollbackLiveReadOnly(),null,2));
 }catch(error){
   console.error(/^qa_rollback_live_[a-z0-9_]+$/.test(error?.message||'')
     ?error.message:'qa_rollback_live_failed_closed');
   process.exitCode=1;
 }
}
