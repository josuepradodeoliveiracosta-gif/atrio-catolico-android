#!/usr/bin/env node
/**
 * Pré-flight exclusivamente local. A fonte é pública, sem nomes de
 * operadores, credenciais, dados pessoais, rede ou gravações.
 * Um marcador de revisão NÃO significa aprovação nem autoriza deploy.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const REQUIRED_REVIEW_IDS=Object.freeze([
 'MINOR_LEGAL_ASSESSMENT',
 'MODERATION_OWNER_AND_BACKUP',
 'LATE_REPORT_CHANNEL',
 'URGENT_ESCALATION',
 'EVIDENCE_ACCESS_AND_ABUSE',
 'APPEAL_AND_TITULAR_RIGHTS',
 'RETENTION_13_CLASSES',
 'PRIVACY_TERMS_FINAL_REVIEW'
]);
const fail=()=>{throw Error('qa_governance_invalid_or_untrusted_record');};
function exactKeys(value,keys){
 return value!==null && typeof value==='object' && !Array.isArray(value)
   && Object.keys(value).length===keys.length
   && keys.every(k=>Object.hasOwn(value,k));
}
export function reviewGovernance(record){
 if(!exactKeys(record,['schema','project','android_package','scope','age_decision','reviews']) ||
    record.schema!=='QA_ISSUE_200_GOVERNANCE_V1' ||
    record.project!=='atrio-catolico-qa-geral' ||
    record.android_package!=='br.com.atriocatolico.chatqa' ||
    record.scope!=='DRAFT_QA_ONLY_NO_DEPLOY')fail();
 const age=record.age_decision;
 if(!exactKeys(age,['minimum_age','method','founder_product_decision',
    'independent_age_verification','paid_provider_required_now']) ||
    age.minimum_age!==18 ||
    age.method!=='BIRTHDATE_LOCAL_PLUS_SELF_DECLARATION_18_PLUS' ||
    age.founder_product_decision!=='DECIDED' ||
    age.independent_age_verification!==false ||
    age.paid_provider_required_now!==false)fail();
 if(!exactKeys(record.reviews,REQUIRED_REVIEW_IDS))fail();
 const pending=[],recorded=[];
 for(const id of REQUIRED_REVIEW_IDS){
  const state=record.reviews[id];
  if(state==='PENDING')pending.push(id);
  else if(state==='REVIEW_RECORDED')recorded.push(id);
  else fail(); // APPPROVED, booleans e outros valores nunca criam um GO.
 }
 return Object.freeze({
  mode:'QA_GOVERNANCE_READ_ONLY_NO_DEPLOY',
  project:record.project,
  android_package:record.android_package,
  minimum_chat_age:18,
  temporary_self_declaration_chosen:true,
  paid_age_provider_required_now:false,
  independent_age_verification_confirmed:false,
  required_reviews:REQUIRED_REVIEW_IDS.length,
  review_records_marked:recorded.length,
  pending_review_ids:Object.freeze(pending),
  review_records_are_not_legal_approvals:true,
  responsible_people_verified:false,
  real_post_exit_reporting_channel_verified:false,
  remote_qa_permissions_verified:false,
  human_rollout_authorization_recorded:false,
  ready_for_qa_deploy:false,
  ready_for_production:false,
  remote_state_changed:false,
  production_contacted:false
 });
}
export function readGovernanceRecord(){
 return JSON.parse(readFileSync(
  new URL('../docs/qa-homologacao/ISSUE-200-GOVERNANCA-QA.json',import.meta.url),
  'utf8'
 ));
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)fail();
  console.log(JSON.stringify(reviewGovernance(readGovernanceRecord()),null,2));
 }catch{
  console.error('qa_governance_invalid_or_untrusted_record');
  process.exitCode=1;
 }
}
