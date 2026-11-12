#!/usr/bin/env node
/**
 * Contrato EXCLUSIVAMENTE OFFLINE para a futura entrada excepcional.
 * Nao aceita relatos, identificadores, enderecos ou dados pessoais.
 * Nenhum GET/POST remoto, Firebase Admin, Worker, endpoint, armazenamento,
 * recibo, idempotency key real ou "aceite" de denuncia existe neste modulo.
 */
import {fileURLToPath} from 'node:url';
import {readGovernanceRecord,reviewGovernance}
  from './chat-qa-governance-preflight.mjs';

export const QA_INTAKE_PROJECT='atrio-catolico-qa-geral';
export const QA_INTAKE_PACKAGE='br.com.atriocatolico.chatqa';
export const EXCEPTIONAL_ACCESS_STATES=Object.freeze([
 'NO_LOGIN','SUSPENDED','FORMER_MEMBER','CHAT_DISABLED'
]);
export const EXCEPTIONAL_SUBJECTS=Object.freeze([
 'PARTICIPANT','DIRECT_MESSAGE','GROUP_MESSAGE','ACCOUNT_ACCESS'
]);
export const REPORTED_URGENCY=Object.freeze([
 'UNSPECIFIED','ROUTINE_UNVERIFIED','URGENT_UNVERIFIED'
]);
export const SYNTHETIC_TRANSPORT_EVENTS=Object.freeze([
 'NOT_SUBMITTED','NETWORK_TIMEOUT','SERVER_REJECTED',
 'SIMULATED_SERVER_ACCEPTED','SIMULATED_DURABLE_COMMIT'
]);
const ACCEPTANCE_CONTROLS=Object.freeze([
 'AUTHORIZED_INTAKE_TRANSPORT',
 'ANONYMOUS_ABUSE_RATE_LIMITING_AND_APP_CHECK_REVIEWED',
 'IDENTITY_ALTERNATIVE_AND_CONTACT_VERIFICATION_APPROVED',
 'PRIVACY_PURPOSE_MINIMUM_FIELDS_AND_NOTICE_APPROVED',
 'AUTHENTICATED_RESTRICTED_MODERATOR_QUEUE_TESTED',
 'SERVER_IDEMPOTENCY_AND_DURABLE_RECEIPT_TESTED',
 'EVIDENCE_RETENTION_APPEAL_AND_ACCESS_REVIEWED',
 'URGENT_HANDLING_HUMAN_COVERAGE_APPROVED'
]);
const CASE_KEYS=Object.freeze([
 'access','subject','urgency','claims_prior_receipt','transport_event'
]);
const fail=(code)=>{throw Error('qa_exceptional_intake_'+code);};
const hasExactKeys=(value,keys)=>value!==null&&typeof value==='object'&&
 !Array.isArray(value)&&Object.keys(value).length===keys.length&&
 keys.every(k=>Object.hasOwn(value,k));
const assertGovernance=(record)=>{
 let g;
 try{g=reviewGovernance(record);}catch{fail('untrusted_governance');}
 if(g.project!==QA_INTAKE_PROJECT||g.android_package!==QA_INTAKE_PACKAGE||
    g.moderation_principal_role!=='ADMIN_FOUNDER'||
    g.human_moderation_provisional!==true||
    g.guardian_v2_approval_recorded!==false||
    g.review_records_are_not_legal_approvals!==true||
    g.human_rollout_authorization_recorded!==false||
    g.ready_for_qa_deploy!==false||
    g.ready_for_production!==false||
    g.real_post_exit_reporting_channel_verified!==false)
   fail('untrusted_governance');
 return g;
};

/** Entrada de categorias SINTETICAS, sem relato nem payload de usuario. */
export function assessExceptionalIntakeDryRun(scenario,record=readGovernanceRecord()){
 if(!hasExactKeys(scenario,CASE_KEYS)||
    !EXCEPTIONAL_ACCESS_STATES.includes(scenario.access)||
    !EXCEPTIONAL_SUBJECTS.includes(scenario.subject)||
    !REPORTED_URGENCY.includes(scenario.urgency)||
    !SYNTHETIC_TRANSPORT_EVENTS.includes(scenario.transport_event)||
    typeof scenario.claims_prior_receipt!=='boolean')
  fail('invalid_or_personal_input');
 const gov=assertGovernance(record);
 // A aparencia de confirmacao de um mock nao equivale a commit real.
 // Toda confirmacao futura deve nascer exclusivamente de servidor
 // autorizado e de um registro duravel verificado, ainda nao implementado.
 const mockedAck=scenario.transport_event==='SIMULATED_SERVER_ACCEPTED'||
                 scenario.transport_event==='SIMULATED_DURABLE_COMMIT';
 return Object.freeze({
  status:'QA_EXCEPTIONAL_INTAKE_DESIGN_ONLY_NO_GO',
  project:QA_INTAKE_PROJECT,
  android_package:QA_INTAKE_PACKAGE,
  access_synthetic:scenario.access,
  subject_synthetic:scenario.subject,
  claimed_urgency_unverified:scenario.urgency==='URGENT_UNVERIFIED',
  claimed_prior_receipt_not_validated:scenario.claims_prior_receipt,
  synthetic_server_ack_is_not_durable_real_evidence:mockedAck,
  received_report:false,
  receipt_issued:false,
  real_protocol_generated:false,
  private_message_or_group_existence_disclosed:false,
  private_history_read:false,
  complaint_payload_collected:false,
  external_contact_collected:false,
  account_or_membership_verified:false,
  abuse_rate_limiter_operational:false,
  app_check_or_identity_alternative_operational:false,
  human_capacity_verified:false,
  urgent_response_or_24h_service_promised:false,
  escalation_performed:false,
  auto_sanction_performed:false,
  admin_queue_written:false,
  retention_or_proof_preservation_executed:false,
  backend_endpoint_installed:false,
  deploy_performed:false,
  remote_state_changed:false,
  can_open_intake:false,
  ready_for_qa_deploy:false,
  ready_for_production:false,
  required_controls_pending:Object.freeze([...ACCEPTANCE_CONTROLS]),
  governance_reviews_pending:gov.pending_review_ids.length,
  neutral_notice:'Canal excepcional em preparacao. Nenhuma denuncia foi recebida e nenhum protocolo foi emitido.'
 });
}

/** Permite auditar o desenho, nunca registrar aprovacao de qualquer controle. */
export function evaluateExceptionalIntakeReadiness(record=readGovernanceRecord()){
 const g=assertGovernance(record);
 return Object.freeze({
  status:'QA_EXCEPTIONAL_INTAKE_APPROVALS_NOT_VERIFIED_NO_GO',
  project:QA_INTAKE_PROJECT,
  android_package:QA_INTAKE_PACKAGE,
  reuses_existing_reports:true,
  existing_report_sources:Object.freeze([
    'user_reports','chat_reports','chat_group_reports'
  ]),
  exceptional_endpoint_configured:false,
  public_anonymous_firestore_writes_permitted:false,
  privileged_moderator_query_created:false,
  real_transport_selected_and_authorized:false,
  intake_abuse_protection_proven:false,
  alternate_identity_verification_proven:false,
  private_metadata_exposure_tested:false,
  durable_idempotent_receipts_verified:false,
  reviewer_conflict_and_revocation_tested:false,
  retention_and_privacy_approved:false,
  urgent_human_escalation_verified:false,
  completed_control_count:0,
  required_control_count:ACCEPTANCE_CONTROLS.length,
  controls_pending:Object.freeze([...ACCEPTANCE_CONTROLS]),
  governance_reviews_pending:g.pending_review_ids.length,
  ready_for_deploy:false,
  ready_for_activation:false,
  approvals_assumed:false,
  report_received:false,
  receipt_issued:false,
  no_remote_mutation:true,
  production_contacted:false
 });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)fail('cli_arguments_denied');
  const g=evaluateExceptionalIntakeReadiness();
  console.log(JSON.stringify(g,null,2));
 }catch{
  console.error('qa_exceptional_intake_failed_closed');
  process.exitCode=1;
 }
}
