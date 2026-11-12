#!/usr/bin/env node
// Security design ONLY: no HTTP handler, credentials, data, network, receipt or deploy.
import {fileURLToPath} from 'node:url';
import {evaluateExceptionalIntakeReadiness} from './chat-qa-exceptional-intake-contract.mjs';
const fail=()=>{throw Error('qa_gateway_design_untrusted_scenario');};
const keys=['environment','method','route','body_class','origin','abuse','identity','replay'];
const allowed={
 environment:['QA_ISOLATED','PRODUCTION','UNKNOWN'],
 method:['POST','GET','DELETE','OPTIONS'],
 route:['INTAKE_CANDIDATE','STATUS_CANDIDATE','OTHER'],
 body_class:['MINIMAL','PRIVATE_HISTORY','ATTACHMENTS','UNBOUNDED'],
 origin:['UNVERIFIED','SIMULATED_FIRST_PARTY'],
 abuse:['UNCHECKED','SIMULATED_WITHIN_LIMIT','SIMULATED_LIMIT_REACHED'],
 identity:['UNVERIFIED','SIMULATED_ACCOUNT','SIMULATED_RECOVERY'],
 replay:['UNVERIFIED','SIMULATED_UNIQUE','SIMULATED_DUPLICATE']
};
const exact=(x,k)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===k.length&&k.every(a=>Object.hasOwn(x,a));
function verifyGovernance(g){
 let r;
 try{r=evaluateExceptionalIntakeReadiness(g);}catch{fail();}
 if(r.project!=='atrio-catolico-qa-geral'||r.android_package!=='br.com.atriocatolico.chatqa'||
    r.required_control_count!==8||r.completed_control_count!==0||
    r.exceptional_endpoint_configured!==false||r.no_remote_mutation!==true||
    r.ready_for_deploy!==false||r.ready_for_activation!==false)fail();
 return r;
}
export function evaluateGatewayDesign(v,governance){
 if(!exact(v,keys)||keys.some(k=>!allowed[k].includes(v[k])))fail();
 const g=verifyGovernance(governance);
 const ideal=v.environment==='QA_ISOLATED'&&v.method==='POST'&&
   v.route==='INTAKE_CANDIDATE'&&v.body_class==='MINIMAL'&&
   v.origin==='SIMULATED_FIRST_PARTY'&&v.abuse==='SIMULATED_WITHIN_LIMIT'&&
   ['SIMULATED_ACCOUNT','SIMULATED_RECOVERY'].includes(v.identity)&&
   v.replay==='SIMULATED_UNIQUE';
 return Object.freeze({
  status:'QA_GATEWAY_DESIGN_NO_GO',
  synthetic_gateway_contract_satisfied:ideal,
  missing_real_controls:g.required_control_count,
  endpoint_exists:false,
  received_report:false,
  anonymous_firestore_write_allowed:false,
  private_resource_existence_disclosed:false,
  private_history_read:false,
  raw_user_data_processed:false,
  external_contact_collected:false,
  rate_limiting_operational:false,
  real_identity_verification_operational:false,
  real_receipt_issued:false,
  neutral_response:'SERVICE_UNAVAILABLE_NO_RECEIPT',
  no_cache:true,
  qa_remote_modified:false,
  production_contacted:false,
  activation_approved:false
 });
}
const stateValues=['ABSENT','RESERVED','UNKNOWN','COMMITTED','CONFLICT'];
const eventValues=['BEGIN','RETRY','MOCK_DURABLE_ACK','TIMEOUT','MOCK_RECOVERY','MISMATCH'];
export function modelReceiptRetry(v,governance){
 if(!exact(v,['state','event','same_fingerprint'])||
   !stateValues.includes(v.state)||!eventValues.includes(v.event)||
   typeof v.same_fingerprint!=='boolean')fail();
 verifyGovernance(governance);
 let next=v.state,reason='INVALID_OR_UNPROVEN';
 if(v.event==='MISMATCH'&&v.state!=='ABSENT'||!v.same_fingerprint&&v.event!=='BEGIN'){
   next='CONFLICT';reason='REPLAY_CONFLICT';
 }else if(v.state==='ABSENT'&&v.event==='BEGIN'&&v.same_fingerprint){
   next='RESERVED';reason='MOCK_RESERVATION';
 }else if(v.state==='RESERVED'&&v.event==='MOCK_DURABLE_ACK'&&v.same_fingerprint){
   next='COMMITTED';reason='MOCK_COMMIT_ONLY';
 }else if(v.state==='RESERVED'&&v.event==='TIMEOUT'&&v.same_fingerprint){
   next='UNKNOWN';reason='REQUIRE_SERVER_READ';
 }else if(v.state==='UNKNOWN'&&v.event==='MOCK_RECOVERY'&&v.same_fingerprint){
   next='COMMITTED';reason='MOCK_RECOVERY_ONLY';
 }else if(v.state==='COMMITTED'&&v.event==='RETRY'&&v.same_fingerprint){
   reason='REPLAY_NO_SECOND_WRITE';
 }else if(v.state==='RESERVED'&&v.event==='RETRY'&&v.same_fingerprint){
   reason='IN_FLIGHT_NO_SECOND_WRITE';
 }else if(v.state==='UNKNOWN'&&v.event==='RETRY'&&v.same_fingerprint){
   reason='REQUIRE_SERVER_READ';
 }
 return Object.freeze({
  status:'QA_RECEIPT_MODEL_NO_GO',
  synthetic_next_state:next,
  synthetic_transition:reason,
  simulated_commit_is_not_real_durability:next==='COMMITTED',
  real_server_commit_verified:false,
  real_receipt_issued:false,
  network_attempted:false,
  database_modified:false,
  second_write_performed:false,
  private_resource_existence_disclosed:false,
  activation_approved:false
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try {
  if(process.argv.length!==2)fail();
  const out=evaluateGatewayDesign({
   environment:'QA_ISOLATED',method:'POST',route:'INTAKE_CANDIDATE',
   body_class:'MINIMAL',origin:'SIMULATED_FIRST_PARTY',
   abuse:'SIMULATED_WITHIN_LIMIT',identity:'SIMULATED_RECOVERY',
   replay:'SIMULATED_UNIQUE'
  });
  const retry=modelReceiptRetry({state:'RESERVED',event:'TIMEOUT',same_fingerprint:true});
  console.log(JSON.stringify({gateway:out,receipt:retry,deploy_performed:false},null,2));
 }catch{console.error('qa_gateway_design_failed_closed');process.exitCode=1;}
}
