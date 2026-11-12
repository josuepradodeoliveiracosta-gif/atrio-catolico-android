import test from 'node:test';
import assert from 'node:assert/strict';
import {
 assessExceptionalIntakeDryRun,evaluateExceptionalIntakeReadiness,
 EXCEPTIONAL_ACCESS_STATES,EXCEPTIONAL_SUBJECTS,
 REPORTED_URGENCY,SYNTHETIC_TRANSPORT_EVENTS
} from './chat-qa-exceptional-intake-contract.mjs';
import {readGovernanceRecord}
 from './chat-qa-governance-preflight.mjs';

const sample=()=>({
 access:'NO_LOGIN',subject:'PARTICIPANT',
 urgency:'UNSPECIFIED',claims_prior_receipt:false,
 transport_event:'NOT_SUBMITTED'
});
const safe=(result)=>{
 assert.equal(result.received_report,false);
 assert.equal(result.receipt_issued,false);
 assert.equal(result.private_message_or_group_existence_disclosed,false);
 assert.equal(result.private_history_read,false);
 assert.equal(result.admin_queue_written,false);
 assert.equal(result.remote_state_changed,false);
 assert.equal(result.ready_for_qa_deploy,false);
 assert.equal(result.ready_for_production,false);
 assert.equal(Object.isFrozen(result),true);
};

test('todas as combinacoes sinteticas mantem NO_GO e zero envios',()=>{
 let examined=0;
 for(const access of EXCEPTIONAL_ACCESS_STATES)
 for(const subject of EXCEPTIONAL_SUBJECTS)
 for(const urgency of REPORTED_URGENCY)
 for(const transport_event of SYNTHETIC_TRANSPORT_EVENTS)
 for(const claims_prior_receipt of [false,true]){
  const r=assessExceptionalIntakeDryRun({
    access,subject,urgency,transport_event,claims_prior_receipt
  });
  safe(r);
  assert.equal(r.can_open_intake,false);
  assert.equal(r.complaint_payload_collected,false);
  assert.equal(r.external_contact_collected,false);
  examined++;
 }
 assert.equal(examined,480);
});
test('ate fake durable commit nao emite protocolo real',()=>{
 for(const transport_event of [
   'SIMULATED_SERVER_ACCEPTED','SIMULATED_DURABLE_COMMIT'
 ]){
  const r=assessExceptionalIntakeDryRun({...sample(),transport_event});
  assert.equal(r.synthetic_server_ack_is_not_durable_real_evidence,true);
  assert.equal(r.real_protocol_generated,false);
  assert.equal(r.receipt_issued,false);
  assert.equal(r.received_report,false);
 }
});
test('timeout e rejeicao nao criam falso recibo',()=>{
 for(const transport_event of ['NETWORK_TIMEOUT','SERVER_REJECTED']){
  const r=assessExceptionalIntakeDryRun({...sample(),transport_event});
  safe(r);
  assert.match(r.neutral_notice,/Nenhuma denuncia foi recebida/);
 }
});
test('urgencia auto declarada nao implica pronto atendimento',()=>{
 const r=assessExceptionalIntakeDryRun({...sample(),urgency:'URGENT_UNVERIFIED'});
 assert.equal(r.claimed_urgency_unverified,true);
 assert.equal(r.urgent_response_or_24h_service_promised,false);
 assert.equal(r.human_capacity_verified,false);
 assert.equal(r.escalation_performed,false);
 assert.equal(r.auto_sanction_performed,false);
});
test('alegacao de protocolo anterior nao garante leitura ou pertencimento',()=>{
 const r=assessExceptionalIntakeDryRun({...sample(),
  subject:'GROUP_MESSAGE',claims_prior_receipt:true});
 assert.equal(r.claimed_prior_receipt_not_validated,true);
 assert.equal(r.private_history_read,false);
 assert.equal(r.account_or_membership_verified,false);
 assert.equal(r.real_protocol_generated,false);
});
test('campos pessoais, anexos e referencias privadas nao sao aceitos',()=>{
 for(const patch of [
  {uid:'u1'},{email:'pessoa@exemplo.com'},{phone:'11999999999'},
  {cpf:'00000000000'},{reportBody:'privado'},
  {attachment:'binary'},{targetUid:'u2'},
  {chatId:'chat1'},{groupId:'g1'},{messageId:'m1'},
  {idempotencyKey:'real-key'},{authToken:'secret'},
  {contactAddress:'Rua X'},{url:'https://exemplo.test'}
 ])assert.throws(()=>assessExceptionalIntakeDryRun({...sample(),...patch}),
   /qa_exceptional_intake_invalid_or_personal_input/);
});
test('payload ausente, tipos e enum forjado sao recusados',()=>{
 for(const invalid of [
  null,[],{},'',12,
  {...sample(),subject:'UNKNOWN'},
  {...sample(),access:'OWNER_ADMIN'},
  {...sample(),urgency:'LEGAL_APPROVED'},
  {...sample(),transport_event:'REAL_SERVER_COMMITTED'},
  {...sample(),claims_prior_receipt:'true'},
  {...sample(),claims_prior_receipt:null},
  {...sample(),ready_for_deploy:true}
 ])assert.throws(()=>assessExceptionalIntakeDryRun(invalid),
   /qa_exceptional_intake_invalid_or_personal_input/);
});
test('aprovacoes juridicas nao podem ser forjadas no documento',()=>{
 const g=readGovernanceRecord();
 for(const mutation of [
  x=>{x.scope='PRODUCTION';},
  x=>{x.reviews.LATE_REPORT_CHANNEL='APPROVED';},
  x=>{x.reviews.PRIVACY_TERMS_FINAL_REVIEW=true;},
  x=>{x.moderation_decision.primary_responsible_role='PUBLIC_BOT';},
  x=>{x.moderation_decision.guardian_v2_approved_for_automation=true;},
  x=>{x.android_package='br.com.atriocatolico';}
 ]){
  const altered=structuredClone(g);mutation(altered);
  assert.throws(()=>assessExceptionalIntakeDryRun(sample(),altered),
    /qa_exceptional_intake_untrusted_governance/);
 }
});
test('revisao registrada isoladamente nao cria autorizacao',()=>{
 const g=readGovernanceRecord();
 g.reviews.LATE_REPORT_CHANNEL='REVIEW_RECORDED';
 const r=assessExceptionalIntakeDryRun(sample(),g);
 safe(r);
 assert.equal(r.governance_reviews_pending,7);
 assert.equal(r.can_open_intake,false);
});
test('gate de preparacao reutiliza colecoes e exige oito controles',()=>{
 const x=evaluateExceptionalIntakeReadiness();
 assert.deepEqual(x.existing_report_sources,
  ['user_reports','chat_reports','chat_group_reports']);
 assert.equal(x.required_control_count,8);
 assert.equal(x.completed_control_count,0);
 assert.equal(x.controls_pending.length,8);
 assert.equal(x.exceptional_endpoint_configured,false);
 assert.equal(x.public_anonymous_firestore_writes_permitted,false);
 assert.equal(x.privileged_moderator_query_created,false);
 assert.equal(x.no_remote_mutation,true);
 assert.equal(x.ready_for_deploy,false);
 assert.equal(x.ready_for_activation,false);
 assert.equal(x.receipt_issued,false);
 assert.equal(Object.isFrozen(x),true);
 assert.equal(Object.isFrozen(x.controls_pending),true);
});
test('nenhum estado de transporte prova antispam ou verificacao de contato',()=>{
 for(const transport_event of SYNTHETIC_TRANSPORT_EVENTS){
  const r=assessExceptionalIntakeDryRun({...sample(),transport_event});
  assert.equal(r.abuse_rate_limiter_operational,false);
  assert.equal(r.app_check_or_identity_alternative_operational,false);
  assert.equal(r.backend_endpoint_installed,false);
 }
});
test('resumo nao ecoa dados de denuncia nem gera artefato de atendimento',()=>{
 const output=JSON.stringify(assessExceptionalIntakeDryRun(sample()));
 assert.ok(!output.includes('reportBody'));
 assert.ok(!output.includes('receiptId'));
 assert.ok(!output.includes('accessToken'));
 assert.ok(output.includes('NO_GO'));
});
