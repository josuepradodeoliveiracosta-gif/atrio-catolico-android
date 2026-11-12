#!/usr/bin/env node
/**
 * Simulador OFFLINE de riscos de denuncia tardia. Nao eh um canal de relatos.
 * Somente estados enumerados: dados pessoais, mensagens, UIDs, links e
 * identificadores de protocolos NAO sao aceitos ou registrados.
 * Nao usa rede, Firebase, IAM, clock, armazenamento ou servicos de terceiros.
 */
import {fileURLToPath} from 'node:url';
import {reviewGovernance,readGovernanceRecord}
  from './chat-qa-governance-preflight.mjs';

export const SYNTHETIC_REPORTER_STATES=Object.freeze([
  'AUTHENTICATED_MEMBER','AUTHENTICATED_FORMER_MEMBER',
  'SUSPENDED','NO_LOGIN'
]);
export const SYNTHETIC_FEATURE_STATES=Object.freeze([
  'CHAT_DISABLED','CHAT_AVAILABLE'
]);
export const SYNTHETIC_SUBJECTS=Object.freeze([
  'PARTICIPANT','SPECIFIC_MESSAGE'
]);
export const SYNTHETIC_RISK_LEVELS=Object.freeze([
  'ROUTINE_UNVERIFIED','URGENT_UNVERIFIED'
]);
const CASE_KEYS=Object.freeze([
 'reporter_state','feature_state','subject','claimed_previous_receipt','risk_level'
]);
const fail=()=>{throw Error('qa_late_report_dryrun_invalid_or_untrusted_scenario');};
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

export function simulateLateReportCase(scenario,governance=readGovernanceRecord()){
 if(!exact(scenario,CASE_KEYS) ||
   !SYNTHETIC_REPORTER_STATES.includes(scenario.reporter_state) ||
   !SYNTHETIC_FEATURE_STATES.includes(scenario.feature_state) ||
   !SYNTHETIC_SUBJECTS.includes(scenario.subject) ||
   !SYNTHETIC_RISK_LEVELS.includes(scenario.risk_level) ||
   typeof scenario.claimed_previous_receipt!=='boolean')fail();
 let reviewed;
 try{reviewed=reviewGovernance(governance);}catch{fail();}
 if(reviewed.project!=='atrio-catolico-qa-geral' ||
    reviewed.android_package!=='br.com.atriocatolico.chatqa' ||
    reviewed.ready_for_qa_deploy!==false ||
    reviewed.ready_for_production!==false ||
    reviewed.human_moderation_provisional!==true ||
    reviewed.moderation_principal_role!=='ADMIN_FOUNDER' ||
    reviewed.individually_designated_moderators_verified!==false ||
    reviewed.guardian_v2_approval_recorded!==false ||
    reviewed.review_records_are_not_legal_approvals!==true ||
    reviewed.human_rollout_authorization_recorded!==false)fail();

 const formerOrUnavailable=scenario.reporter_state!=='AUTHENTICATED_MEMBER' ||
   scenario.feature_state==='CHAT_DISABLED';
 const needsExternalPath=formerOrUnavailable ||
   scenario.subject==='SPECIFIC_MESSAGE';
 return Object.freeze({
  status:'LATE_REPORT_SYNTHETIC_SIMULATION_NO_GO',
  project:'atrio-catolico-qa-geral',
  reporter_state_synthetic:scenario.reporter_state,
  subject_synthetic:scenario.subject,
  requested_urgency_unverified:scenario.risk_level==='URGENT_UNVERIFIED',
  external_channel_required_for_scenario:needsExternalPath,
  external_channel_implemented_or_authorized:false,
  receipt_claimed_not_verified:scenario.claimed_previous_receipt,
  previous_receipt_read_permission_not_verified:true,
  remote_qa_rules_currently_deny_all_in_last_snapshot:true,
  historical_chat_or_group_existence_disclosed:false,
  private_message_or_membership_read_authorized:false,
  authenticated_sender_or_target_verified:false,
  automatic_proof_collection_or_export:false,
  claimant_provided_id_is_not_membership_proof:true,
  proof_retention_policy_approved:false,
  evidence_preserved_or_deleted:false,
  evidence_access_granted:false,
  reviewer_appointed_by_simulation:false,
  review_recorded:false,
  urgent_24h_response_promised:false,
  human_response_capacity_confirmed:false,
  escalation_performed:false,
  sanctions_performed:false,
  report_received_or_receipt_issued:false,
  legal_approval_recorded:false,
  governance_reviews_still_pending:reviewed.pending_review_ids.length,
  deploy_performed:false,
  remote_state_changed:false,
  ready_for_qa_deploy:false,
  ready_for_production:false,
  // Resposta fixa: nao revela existencia de grupo, usuario, mensagem ou caso.
  proposed_neutral_response:'O atendimento tardio ainda nao possui canal autorizado. Nenhuma denuncia foi recebida por esta simulacao.',
  human_decisions_pending:Object.freeze([
   'LATE_REPORT_CHANNEL','MODERATION_OWNER_AND_BACKUP','URGENT_ESCALATION',
   'EVIDENCE_ACCESS_AND_ABUSE','APPEAL_AND_TITULAR_RIGHTS',
   'RETENTION_13_CLASSES','PRIVACY_TERMS_FINAL_REVIEW','MINOR_LEGAL_ASSESSMENT'
  ])
 });
}

const SCENARIOS=Object.freeze([
 {reporter_state:'AUTHENTICATED_MEMBER',feature_state:'CHAT_AVAILABLE',subject:'PARTICIPANT',claimed_previous_receipt:false,risk_level:'ROUTINE_UNVERIFIED'},
 {reporter_state:'AUTHENTICATED_FORMER_MEMBER',feature_state:'CHAT_AVAILABLE',subject:'SPECIFIC_MESSAGE',claimed_previous_receipt:true,risk_level:'ROUTINE_UNVERIFIED'},
 {reporter_state:'SUSPENDED',feature_state:'CHAT_DISABLED',subject:'PARTICIPANT',claimed_previous_receipt:true,risk_level:'URGENT_UNVERIFIED'},
 {reporter_state:'NO_LOGIN',feature_state:'CHAT_DISABLED',subject:'SPECIFIC_MESSAGE',claimed_previous_receipt:false,risk_level:'URGENT_UNVERIFIED'}
]);
export function runSyntheticLateReportMatrix(){
 return Object.freeze(SCENARIOS.map(s=>simulateLateReportCase(s)));
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)fail();
  const m=runSyntheticLateReportMatrix();
  console.log(JSON.stringify({status:'QA_LATE_REPORT_MATRIX_OFFLINE_NO_GO',
   synthetic_case_count:m.length,
   cases:m.map(x=>({
    reporter_state:x.reporter_state_synthetic,
    subject:x.subject_synthetic,
    external_channel_required:x.external_channel_required_for_scenario,
    report_received:x.report_received_or_receipt_issued,
    ready_for_deploy:x.ready_for_qa_deploy
   })),
   human_review_required:true,remote_state_changed:false},null,2));
 }catch{
  console.error('qa_late_report_dryrun_invalid_or_untrusted_scenario');
  process.exitCode=1;
 }
}
