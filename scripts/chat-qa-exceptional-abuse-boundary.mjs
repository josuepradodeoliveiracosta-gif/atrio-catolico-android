#!/usr/bin/env node
/**
 * Revisao sintética de abuso do futuro ingresso excepcional.
 *
 * NENHUM middleware, endpoint, credencial, contador real ou recibo.
 * Categorias inventadas para laboratorio; "MOCK" nunca autoriza serviço.
 */
import {evaluateExceptionalIntakeReadiness}
  from './chat-qa-exceptional-intake-contract.mjs';

const KEYS=Object.freeze([
 'access','origin','challenge','budget','contact','replay','transport',
 'private_lookup_requested'
]);
const ALLOWED=Object.freeze({
 access:['NO_LOGIN','SUSPENDED','FORMER_MEMBER','CHAT_DISABLED','ACTIVE_SESSION'],
 origin:['UNKNOWN','MOCK_FIRST_PARTY','MOCK_FORGED'],
 challenge:['UNKNOWN','MOCK_PASSED','MOCK_EXPIRED','MOCK_REUSED'],
 budget:['UNKNOWN','MOCK_WITHIN_LIMIT','MOCK_EXHAUSTED'],
 contact:['UNKNOWN','MOCK_VERIFIED_ALTERNATIVE','MOCK_BOUNCED'],
 replay:['UNKNOWN','MOCK_UNIQUE','MOCK_DUPLICATE','MOCK_CONFLICT'],
 transport:['NOT_ATTEMPTED','MOCK_TIMEOUT','MOCK_ACK'],
 private_lookup_requested:[false,true]
});
const fail=()=>{throw Error('qa_exceptional_abuse_untrusted_scenario');};
const exact=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===KEYS.length&&KEYS.every(k=>Object.hasOwn(value,k));
const trustedGovernance=g=>{
 let report;
 try{report=evaluateExceptionalIntakeReadiness(g);}catch{fail();}
 if(report.status!=='QA_EXCEPTIONAL_INTAKE_APPROVALS_NOT_VERIFIED_NO_GO'||
    report.project!=='atrio-catolico-qa-geral'||
    report.required_control_count!==8||
    report.completed_control_count!==0||
    report.exceptional_endpoint_configured!==false||
    report.no_remote_mutation!==true||
    report.ready_for_activation!==false||
    report.ready_for_deploy!==false)fail();
 return report;
};

/**
 * Apenas enumera os bloqueios em categorias. Nem a combinacao "ideal"
 * emite um recibo ou remove os oito gates reais de aprovacao.
 */
export function assessSyntheticAbuseBoundary(scenario,governance){
 if(!exact(scenario)||KEYS.some(key=>!ALLOWED[key].includes(scenario[key])))
  fail();
 const g=trustedGovernance(governance);
 const flags=[];
 if(scenario.access==='ACTIVE_SESSION')flags.push('USE_EXISTING_AUTHENTICATED_ROUTE');
 if(scenario.origin!=='MOCK_FIRST_PARTY')flags.push('ORIGIN_NOT_PROVEN');
 if(scenario.challenge!=='MOCK_PASSED')flags.push('CHALLENGE_NOT_PROVEN');
 if(scenario.budget!=='MOCK_WITHIN_LIMIT')flags.push('RATE_LIMIT_NOT_PROVEN');
 if(scenario.contact!=='MOCK_VERIFIED_ALTERNATIVE')flags.push('CONTACT_NOT_PROVEN');
 if(scenario.replay!=='MOCK_UNIQUE')flags.push('REPLAY_NOT_PROVEN');
 if(scenario.transport!=='NOT_ATTEMPTED')flags.push('TRANSPORT_NOT_DURABLE_PROOF');
 if(scenario.private_lookup_requested)flags.push('PRIVATE_LOOKUP_FORBIDDEN');

 return Object.freeze({
  status:'QA_EXCEPTIONAL_ABUSE_REVIEW_NO_GO',
  synthetic_preconditions_matched:flags.length===0,
  synthetic_blockers:Object.freeze(flags),
  real_controls_remaining:g.required_control_count,
  gate_applied_to_real_traffic:false,
  rate_limit_operational:false,
  challenge_verification_operational:false,
  alternative_contact_verified:false,
  real_identity_verified:false,
  network_attempted:false,
  private_lookup_performed:false,
  private_resource_existence_disclosed:false,
  report_received:false,
  receipt_issued:false,
  human_urgency_response_promised:false,
  admin_queue_updated:false,
  production_contacted:false,
  qa_remote_modified:false,
  ready_for_deploy:false,
  ready_for_activation:false,
  neutral_response:'SERVICE_UNAVAILABLE_NO_RECEIPT'
 });
}
