import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewGovernance,readGovernanceRecord,REQUIRED_REVIEW_IDS}
 from './chat-qa-governance-preflight.mjs';

const fixture=()=>structuredClone(readGovernanceRecord());

test('decisao do fundador de 18+ permanece fechada sem fornecedor pago',()=>{
 const report=reviewGovernance(fixture());
 assert.equal(report.minimum_chat_age,18);
 assert.equal(report.temporary_self_declaration_chosen,true);
 assert.equal(report.paid_age_provider_required_now,false);
 assert.equal(report.independent_age_verification_confirmed,false);
 assert.equal(report.required_reviews,8);
 assert.equal(report.review_records_marked,0);
 assert.equal(report.pending_review_ids.length,8);
 assert.equal(report.ready_for_qa_deploy,false);
 assert.equal(report.ready_for_production,false);
 assert.equal(report.production_contacted,false);
 assert.equal(report.remote_state_changed,false);
 assert.equal(Object.isFrozen(report),true);
});

test('revisões marcadas em arquivo público jamais viram autorização automática',()=>{
 const draft=fixture();
 for(const id of REQUIRED_REVIEW_IDS)draft.reviews[id]='REVIEW_RECORDED';
 const report=reviewGovernance(draft);
 assert.equal(report.review_records_marked,8);
 assert.equal(report.pending_review_ids.length,0);
 assert.equal(report.review_records_are_not_legal_approvals,true);
 assert.equal(report.responsible_people_verified,false);
 assert.equal(report.human_rollout_authorization_recorded,false);
 assert.equal(report.ready_for_qa_deploy,false);
 assert.equal(report.ready_for_production,false);
});

test('rejeita qualquer sinal falso de verificação etária independente',()=>{
 for(const patch of [
  {minimum_age:16},
  {method:'PROVIDER_VERIFIED'},
  {founder_product_decision:'PENDING'},
  {independent_age_verification:true},
  {paid_provider_required_now:true},
  {birthDate:'2001-01-01'}
 ]){
  const draft=fixture();
  Object.assign(draft.age_decision,patch);
  assert.throws(()=>reviewGovernance(draft),/qa_governance_invalid_or_untrusted_record/);
 }
});

test('não aceita que um marcador substitua aprovação humana',()=>{
 for(const state of ['APPROVED','LEGAL_APPROVED','GO',true,null,1,'']){
  const draft=fixture();
  draft.reviews.LATE_REPORT_CHANNEL=state;
  assert.throws(()=>reviewGovernance(draft),/qa_governance_invalid_or_untrusted_record/);
 }
});

test('mudança de projeto, pacote, escopo ou dados extras falha fechada',()=>{
 for(const patch of [
  {project:'atrio-catolico'},
  {android_package:'br.com.atriocatolico'},
  {scope:'PRODUCTION'},
  {schema:'unknown'},
  {private_report_text:'texto de conversa'}
 ]){
  const draft=fixture();
  Object.assign(draft,patch);
  assert.throws(()=>reviewGovernance(draft),/qa_governance_invalid_or_untrusted_record/);
 }
 const draft=fixture();
 draft.reviews.private_reporter_uid='uid-privado';
 assert.throws(()=>reviewGovernance(draft),/qa_governance_invalid_or_untrusted_record/);
});

test('rejeita omissão de qualquer uma das oito frentes de governança',()=>{
 for(const id of REQUIRED_REVIEW_IDS){
  const draft=fixture();
  delete draft.reviews[id];
  assert.throws(()=>reviewGovernance(draft),/qa_governance_invalid_or_untrusted_record/);
 }
});
