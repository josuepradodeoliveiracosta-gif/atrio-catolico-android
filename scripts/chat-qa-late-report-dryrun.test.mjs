import test from 'node:test';
import assert from 'node:assert/strict';
import {
 simulateLateReportCase,runSyntheticLateReportMatrix,
 SYNTHETIC_REPORTER_STATES,SYNTHETIC_FEATURE_STATES,
 SYNTHETIC_SUBJECTS,SYNTHETIC_RISK_LEVELS
} from './chat-qa-late-report-dryrun.mjs';
import {readGovernanceRecord}
 from './chat-qa-governance-preflight.mjs';
const example=()=>({
 reporter_state:'AUTHENTICATED_MEMBER',
 feature_state:'CHAT_AVAILABLE',
 subject:'PARTICIPANT',
 claimed_previous_receipt:false,
 risk_level:'ROUTINE_UNVERIFIED'
});

test('matriz offline inclui quatro situacoes sem canal ou recibo falsos',()=>{
 const results=runSyntheticLateReportMatrix();
 assert.equal(results.length,4);
 for(const r of results){
  assert.equal(r.status,'LATE_REPORT_SYNTHETIC_SIMULATION_NO_GO');
  assert.equal(r.report_received_or_receipt_issued,false);
  assert.equal(r.external_channel_implemented_or_authorized,false);
  assert.equal(r.remote_state_changed,false);
  assert.equal(r.ready_for_qa_deploy,false);
  assert.equal(r.ready_for_production,false);
  assert.equal(r.governance_reviews_still_pending,8);
  assert.equal(Object.isFrozen(r),true);
  assert.equal(Object.isFrozen(r.human_decisions_pending),true);
 }
});
test('ex-membro com mensagem antiga nao ganha acesso ao historico',()=>{
 const r=simulateLateReportCase({...example(),
  reporter_state:'AUTHENTICATED_FORMER_MEMBER',
  subject:'SPECIFIC_MESSAGE',claimed_previous_receipt:true});
 assert.equal(r.external_channel_required_for_scenario,true);
 assert.equal(r.previous_receipt_read_permission_not_verified,true);
 assert.equal(r.receipt_claimed_not_verified,true);
 assert.equal(r.historical_chat_or_group_existence_disclosed,false);
 assert.equal(r.private_message_or_membership_read_authorized,false);
 assert.equal(r.evidence_access_granted,false);
});
test('conta suspensa e chat bloqueado nao ganham acesso especial',()=>{
 const r=simulateLateReportCase({...example(),
  reporter_state:'SUSPENDED',feature_state:'CHAT_DISABLED',
  risk_level:'URGENT_UNVERIFIED'});
 assert.equal(r.external_channel_required_for_scenario,true);
 assert.equal(r.report_received_or_receipt_issued,false);
 assert.equal(r.escalation_performed,false);
 assert.equal(r.urgent_24h_response_promised,false);
 assert.equal(r.sanctions_performed,false);
});
test('sem login nao revela existencia de grupo ou mensagem',()=>{
 const r=simulateLateReportCase({...example(),
  reporter_state:'NO_LOGIN',subject:'SPECIFIC_MESSAGE'});
 assert.equal(r.historical_chat_or_group_existence_disclosed,false);
 assert.equal(r.authenticated_sender_or_target_verified,false);
 assert.equal(r.claimant_provided_id_is_not_membership_proof,true);
 assert.equal(r.proposed_neutral_response.includes('Nenhuma denuncia foi recebida'),true);
});
test('urgencia nao promete plantao nem automatiza sancao',()=>{
 const r=simulateLateReportCase({...example(),risk_level:'URGENT_UNVERIFIED'});
 assert.equal(r.requested_urgency_unverified,true);
 assert.equal(r.human_response_capacity_confirmed,false);
 assert.equal(r.urgent_24h_response_promised,false);
 assert.equal(r.sanctions_performed,false);
});
test('alegacao de recibo nunca o valida ou fabrica comprovante',()=>{
 const r=simulateLateReportCase({...example(),claimed_previous_receipt:true});
 assert.equal(r.receipt_claimed_not_verified,true);
 assert.equal(r.previous_receipt_read_permission_not_verified,true);
 assert.equal(r.report_received_or_receipt_issued,false);
});
test('evidencia nao e capturada, exportada, retida ou eliminada',()=>{
 const r=simulateLateReportCase(example());
 assert.equal(r.automatic_proof_collection_or_export,false);
 assert.equal(r.evidence_preserved_or_deleted,false);
 assert.equal(r.proof_retention_policy_approved,false);
 assert.equal(r.evidence_access_granted,false);
});
test('todos os estados enumerados preservam NO_GO sem acao remota',()=>{
 for(const reporter_state of SYNTHETIC_REPORTER_STATES)
 for(const feature_state of SYNTHETIC_FEATURE_STATES)
 for(const subject of SYNTHETIC_SUBJECTS)
 for(const risk_level of SYNTHETIC_RISK_LEVELS){
  const r=simulateLateReportCase({
   ...example(),reporter_state,feature_state,subject,risk_level
  });
  assert.equal(r.remote_state_changed,false);
  assert.equal(r.ready_for_qa_deploy,false);
  assert.equal(r.report_received_or_receipt_issued,false);
  assert.equal(r.legal_approval_recorded,false);
 }
});
test('campos de UID, texto, token, link ou dados pessoais extras sao recusados',()=>{
 for(const extra of [
  {uid:'sensitive-account'},
  {group_id:'private-group'},
  {message_body:'private-message'},
  {cpf:'12345678900'},
  {token:'secret'},
  {email:'person@example.org'},
  {url:'https://example.org/report'}
 ])assert.throws(()=>simulateLateReportCase({...example(),...extra}),
   /qa_late_report_dryrun_invalid_or_untrusted_scenario/);
});
test('tipos, flags e chaves ausentes ou forjadas falham fechado',()=>{
 for(const bad of [
  null,{},[],false,
  {...example(),subject:'UNKNOWN'},
  {...example(),subject:'user_reports/real'},
  {...example(),risk_level:'APPROVED_URGENT'},
  {...example(),feature_state:'ACTIVE_PRODUCTION'},
  {...example(),reporter_state:'ADMIN_OVERRIDE'},
  {...example(),claimed_previous_receipt:'true'},
  {...example(),claimed_previous_receipt:null},
  {...example(),ready_for_deploy:true}
 ])assert.throws(()=>simulateLateReportCase(bad),
   /qa_late_report_dryrun_invalid_or_untrusted_scenario/);
});
test('governanca adulterada para aprovar automacao ou deploy nao e aceita',()=>{
 const base=readGovernanceRecord();
 for(const mutate of [
  g=>{g.scope='PRODUCTION';},
  g=>{g.moderation_decision.guardian_v2_approved_for_automation=true;},
  g=>{g.moderation_decision.primary_responsible_role='UNVERIFIED';},
  g=>{g.reviews.LATE_REPORT_CHANNEL='APPROVED';},
  g=>{g.reviews.RETENTION_13_CLASSES=true;},
  g=>{g.age_decision.independent_age_verification=true;}
 ]){
  const g=structuredClone(base);
  mutate(g);
  assert.throws(()=>simulateLateReportCase(example(),g),
   /qa_late_report_dryrun_invalid_or_untrusted_scenario/);
 }
});
test('revisao registrada nao vira permissao de abrir canal',()=>{
 const g=structuredClone(readGovernanceRecord());
 g.reviews.LATE_REPORT_CHANNEL='REVIEW_RECORDED';
 const r=simulateLateReportCase(example(),g);
 assert.equal(r.governance_reviews_still_pending,7);
 assert.equal(r.external_channel_implemented_or_authorized,false);
 assert.equal(r.ready_for_qa_deploy,false);
});
