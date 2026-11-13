import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSyntheticAbuseBoundary as assess}
 from './chat-qa-exceptional-abuse-boundary.mjs';
import {readGovernanceRecord}
 from './chat-qa-governance-preflight.mjs';

const ideal=()=>({
 access:'NO_LOGIN',
 origin:'MOCK_FIRST_PARTY',
 challenge:'MOCK_PASSED',
 budget:'MOCK_WITHIN_LIMIT',
 contact:'MOCK_VERIFIED_ALTERNATIVE',
 replay:'MOCK_UNIQUE',
 transport:'NOT_ATTEMPTED',
 private_lookup_requested:false
});
function closed(x){
 assert.equal(x.status,'QA_EXCEPTIONAL_ABUSE_REVIEW_NO_GO');
 assert.equal(x.real_controls_remaining,8);
 for(const key of [
  'gate_applied_to_real_traffic','rate_limit_operational',
  'challenge_verification_operational','alternative_contact_verified',
  'real_identity_verified','network_attempted','private_lookup_performed',
  'private_resource_existence_disclosed','report_received','receipt_issued',
  'human_urgency_response_promised','admin_queue_updated',
  'production_contacted','qa_remote_modified','ready_for_deploy',
  'ready_for_activation'
 ])assert.equal(x[key],false,key);
 assert.equal(x.neutral_response,'SERVICE_UNAVAILABLE_NO_RECEIPT');
 assert.equal(Object.isFrozen(x),true);
 assert.equal(Object.isFrozen(x.synthetic_blockers),true);
}

test('condicoes ideais apenas MOCK nao liberam trafego nem recibo',()=>{
 const r=assess(ideal());
 closed(r);
 assert.equal(r.synthetic_preconditions_matched,true);
 assert.deepEqual(r.synthetic_blockers,[]);
});

test('sessao ativa usa rota autenticada ja existente, sem ingresso paralelo',()=>{
 const r=assess({...ideal(),access:'ACTIVE_SESSION'});
 closed(r);
 assert.equal(r.synthetic_preconditions_matched,false);
 assert.deepEqual(r.synthetic_blockers,['USE_EXISTING_AUTHENTICATED_ROUTE']);
});

test('cada barreira falha de modo independente, mesmo com demais mocks ideais',()=>{
 const cases=[
  [{origin:'UNKNOWN'},'ORIGIN_NOT_PROVEN'],
  [{origin:'MOCK_FORGED'},'ORIGIN_NOT_PROVEN'],
  [{challenge:'UNKNOWN'},'CHALLENGE_NOT_PROVEN'],
  [{challenge:'MOCK_EXPIRED'},'CHALLENGE_NOT_PROVEN'],
  [{challenge:'MOCK_REUSED'},'CHALLENGE_NOT_PROVEN'],
  [{budget:'UNKNOWN'},'RATE_LIMIT_NOT_PROVEN'],
  [{budget:'MOCK_EXHAUSTED'},'RATE_LIMIT_NOT_PROVEN'],
  [{contact:'UNKNOWN'},'CONTACT_NOT_PROVEN'],
  [{contact:'MOCK_BOUNCED'},'CONTACT_NOT_PROVEN'],
  [{replay:'UNKNOWN'},'REPLAY_NOT_PROVEN'],
  [{replay:'MOCK_DUPLICATE'},'REPLAY_NOT_PROVEN'],
  [{replay:'MOCK_CONFLICT'},'REPLAY_NOT_PROVEN'],
  [{transport:'MOCK_TIMEOUT'},'TRANSPORT_NOT_DURABLE_PROOF'],
  [{transport:'MOCK_ACK'},'TRANSPORT_NOT_DURABLE_PROOF'],
  [{private_lookup_requested:true},'PRIVATE_LOOKUP_FORBIDDEN']
 ];
 for(const [mutation,reason] of cases){
  const r=assess({...ideal(),...mutation});
  closed(r);
  assert.equal(r.synthetic_preconditions_matched,false);
  assert.deepEqual(r.synthetic_blockers,[reason]);
 }
});

test('combinacoes de falhas nao deixam passar bloqueio isolado',()=>{
 let count=0;
 for(const access of ['NO_LOGIN','SUSPENDED','FORMER_MEMBER','CHAT_DISABLED','ACTIVE_SESSION'])
 for(const origin of ['UNKNOWN','MOCK_FIRST_PARTY','MOCK_FORGED'])
 for(const challenge of ['MOCK_PASSED','MOCK_EXPIRED','MOCK_REUSED'])
 for(const budget of ['UNKNOWN','MOCK_WITHIN_LIMIT','MOCK_EXHAUSTED'])
 for(const replay of ['MOCK_UNIQUE','MOCK_DUPLICATE','MOCK_CONFLICT']){
  const r=assess({...ideal(),access,origin,challenge,budget,replay});
  closed(r);
  if(r.synthetic_preconditions_matched){
   assert.equal(access==='ACTIVE_SESSION',false);
   assert.equal(origin,'MOCK_FIRST_PARTY');
   assert.equal(challenge,'MOCK_PASSED');
   assert.equal(budget,'MOCK_WITHIN_LIMIT');
   assert.equal(replay,'MOCK_UNIQUE');
  } else assert.ok(r.synthetic_blockers.length>0);
  count++;
 }
 assert.equal(count,405);
});

test('alvos privados nao alteram resposta publica uniforme',()=>{
 const safe=assess(ideal()).neutral_response;
 for(const transport of ['NOT_ATTEMPTED','MOCK_TIMEOUT','MOCK_ACK'])
 for(const private_lookup_requested of [true,false]){
  const r=assess({...ideal(),transport,private_lookup_requested});
  closed(r);
  assert.equal(r.neutral_response,safe);
  if(private_lookup_requested)
   assert.ok(r.synthetic_blockers.includes('PRIVATE_LOOKUP_FORBIDDEN'));
 }
});

test('entrada desconhecida e qualquer campo pessoal sao recusados',()=>{
 for(const wrong of [
  null,[],{},123,{...ideal(),uid:'u1'},{...ideal(),cpf:'fake'},
  {...ideal(),email:'nobody@example.test'},{...ideal(),ip:'127.0.0.1'},
  {...ideal(),message:'private'},{...ideal(),group_id:'g'},
  {...ideal(),contact:'REAL_VERIFIED'}, {...ideal(),budget:0},
  {...ideal(),private_lookup_requested:'false'},
  {...ideal(),transport:'SERVER_DURABLE_ACK'}
 ])assert.throws(()=>assess(wrong),/qa_exceptional_abuse_untrusted_scenario/);
});

test('governanca adulterada e falsas aprovacoes nao passam',()=>{
 for(const mutate of [
  g=>{g.scope='PRODUCTION';},
  g=>{g.reviews.LATE_REPORT_CHANNEL='APPROVED';},
  g=>{g.moderation_decision.guardian_v2_approved_for_automation=true;}
 ]){
  const g=readGovernanceRecord();
  mutate(g);
  assert.throws(()=>assess(ideal(),g),
   /qa_exceptional_abuse_untrusted_scenario/);
 }
});
