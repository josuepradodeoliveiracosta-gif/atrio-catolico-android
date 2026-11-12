import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateGatewayDesign as gate,modelReceiptRetry as receipt}
 from './chat-qa-exceptional-gateway-model.mjs';
import {readGovernanceRecord} from './chat-qa-governance-preflight.mjs';
const ideal=()=>({environment:'QA_ISOLATED',method:'POST',
 route:'INTAKE_CANDIDATE',body_class:'MINIMAL',origin:'SIMULATED_FIRST_PARTY',
 abuse:'SIMULATED_WITHIN_LIMIT',identity:'SIMULATED_RECOVERY',
 replay:'SIMULATED_UNIQUE'});
const noGo=(r)=>{
 assert.equal(r.endpoint_exists,false);
 assert.equal(r.received_report,false);
 assert.equal(r.real_receipt_issued,false);
 assert.equal(r.qa_remote_modified,false);
 assert.equal(r.activation_approved,false);
 assert.equal(r.private_resource_existence_disclosed,false);
 assert.equal(Object.isFrozen(r),true);
};
test('ideal mock continua fechado sem endpoint nem recibo',()=>{
 const r=gate(ideal());noGo(r);
 assert.equal(r.synthetic_gateway_contract_satisfied,true);
 assert.equal(r.missing_real_controls,8);
});
test('contexto e metodo alheios nao habilitam entrada',()=>{
 for(const environment of ['PRODUCTION','UNKNOWN']){
  const r=gate({...ideal(),environment});noGo(r);
  assert.equal(r.synthetic_gateway_contract_satisfied,false);
 }
 for(const method of ['GET','DELETE','OPTIONS']){
  const r=gate({...ideal(),method});noGo(r);
  assert.equal(r.synthetic_gateway_contract_satisfied,false);
 }
});
test('sem contexto privado, anexo ou payload ilimitado',()=>{
 for(const body_class of ['PRIVATE_HISTORY','ATTACHMENTS','UNBOUNDED']){
  const r=gate({...ideal(),body_class});noGo(r);
  assert.equal(r.synthetic_gateway_contract_satisfied,false);
  assert.equal(r.private_history_read,false);
  assert.equal(r.raw_user_data_processed,false);
 }
});
test('nao confundir identidade simulada com identidade aprovada',()=>{
 for(const identity of ['UNVERIFIED','SIMULATED_ACCOUNT','SIMULATED_RECOVERY']){
  const r=gate({...ideal(),identity});noGo(r);
  assert.equal(r.real_identity_verification_operational,false);
 }
});
test('origem, abuso e replay nao verificados bloqueiam desenho',()=>{
 for(const change of [{origin:'UNVERIFIED'},{abuse:'UNCHECKED'},
  {abuse:'SIMULATED_LIMIT_REACHED'},{replay:'UNVERIFIED'},
  {replay:'SIMULATED_DUPLICATE'}]){
  const r=gate({...ideal(),...change});noGo(r);
  assert.equal(r.synthetic_gateway_contract_satisfied,false);
  assert.equal(r.rate_limiting_operational,false);
 }
});
test('envelopes sinteticos nunca contatam QA ou producao',()=>{
 let count=0;
 for(const environment of ['QA_ISOLATED','PRODUCTION','UNKNOWN'])
 for(const body_class of ['MINIMAL','PRIVATE_HISTORY','ATTACHMENTS','UNBOUNDED'])
 for(const abuse of ['UNCHECKED','SIMULATED_WITHIN_LIMIT','SIMULATED_LIMIT_REACHED'])
 for(const identity of ['UNVERIFIED','SIMULATED_ACCOUNT','SIMULATED_RECOVERY']){
  const r=gate({...ideal(),environment,body_class,abuse,identity});noGo(r);
  assert.equal(r.production_contacted,false);count++;
 }
 assert.equal(count,108);
});
test('dados pessoais e qualquer parametro extra falham',()=>{
 for(const key of ['uid','email','cpf','ip','token','message','phone','url','groupId','attachment']){
  assert.throws(()=>gate({...ideal(),[key]:'test'}),
   /qa_gateway_design_untrusted_scenario/);
 }
});
test('estrutura e enums forjados sao recusados',()=>{
 for(const bad of [null,{},[],1,false,{...ideal(),method:'PATCH'},
  {...ideal(),environment:'atrio-catolico'},
  {...ideal(),identity:'VERIFIED_REAL'},{...ideal(),body_class:null}]){
  assert.throws(()=>gate(bad),/qa_gateway_design_untrusted_scenario/);
 }
});
const state=(state,event,same_fingerprint=true)=>({state,event,same_fingerprint});
const safeReceipt=r=>{
 assert.equal(r.real_receipt_issued,false);
 assert.equal(r.real_server_commit_verified,false);
 assert.equal(r.database_modified,false);
 assert.equal(r.network_attempted,false);
 assert.equal(r.private_resource_existence_disclosed,false);
 assert.equal(r.activation_approved,false);
};
test('inicio apenas reserva estado em mock',()=>{
 const r=receipt(state('ABSENT','BEGIN'));safeReceipt(r);
 assert.equal(r.synthetic_next_state,'RESERVED');
});
test('ACK de commit ficticio nao emite protocolo',()=>{
 const r=receipt(state('RESERVED','MOCK_DURABLE_ACK'));safeReceipt(r);
 assert.equal(r.synthetic_next_state,'COMMITTED');
 assert.equal(r.simulated_commit_is_not_real_durability,true);
});
test('timeout nao afirma recebimento e exige leitura de servidor',()=>{
 const r=receipt(state('RESERVED','TIMEOUT'));safeReceipt(r);
 assert.equal(r.synthetic_next_state,'UNKNOWN');
 assert.equal(r.synthetic_transition,'REQUIRE_SERVER_READ');
 const replay=receipt(state('UNKNOWN','RETRY'));safeReceipt(replay);
 assert.equal(replay.synthetic_transition,'REQUIRE_SERVER_READ');
});
test('recuperacao ficticia nao substitui gravacao duravel',()=>{
 const r=receipt(state('UNKNOWN','MOCK_RECOVERY'));safeReceipt(r);
 assert.equal(r.synthetic_next_state,'COMMITTED');
 assert.equal(r.real_server_commit_verified,false);
});
test('repeticao identica nao executa segunda escrita',()=>{
 const r=receipt(state('COMMITTED','RETRY'));safeReceipt(r);
 assert.equal(r.synthetic_transition,'REPLAY_NO_SECOND_WRITE');
 assert.equal(r.second_write_performed,false);
});
test('repeticao divergente falha sem revelar caso',()=>{
 for(const s of ['RESERVED','UNKNOWN','COMMITTED']){
  const r=receipt(state(s,'RETRY',false));safeReceipt(r);
  assert.equal(r.synthetic_next_state,'CONFLICT');
 }
});
test('combinacoes da maquina nunca escrevem',()=>{
 const states=['ABSENT','RESERVED','UNKNOWN','COMMITTED','CONFLICT'];
 const events=['BEGIN','RETRY','MOCK_DURABLE_ACK','TIMEOUT','MOCK_RECOVERY','MISMATCH'];
 let n=0;
 for(const s of states)for(const e of events)for(const b of [true,false]){
  const r=receipt(state(s,e,b));safeReceipt(r);n++;
 }
 assert.equal(n,60);
});
test('entrada de recibo real ou malformada e rejeitada',()=>{
 for(const bad of [null,[],{},state('REAL','BEGIN'),state('ABSENT','STORE'),
   {...state('ABSENT','BEGIN'),uid:'private'},state('ABSENT','BEGIN','true')]){
  assert.throws(()=>receipt(bad),/qa_gateway_design_untrusted_scenario/);
 }
});
test('governanca adulterada nao converte simulacao em acesso real',()=>{
 for(const mutate of [
  g=>{g.scope='PRODUCTION';},
  g=>{g.moderation_decision.guardian_v2_approved_for_automation=true;},
  g=>{g.reviews.LATE_REPORT_CHANNEL='APPROVED';}
 ]){
  const g=readGovernanceRecord();mutate(g);
  assert.throws(()=>gate(ideal(),g),/qa_gateway_design_untrusted_scenario/);
  assert.throws(()=>receipt(state('ABSENT','BEGIN'),g),/qa_gateway_design_untrusted_scenario/);
 }
});
