// Free, credentials-free QA policy heartbeat. Exercises fixed synthetic examples
// on Cloudflare Cron but NEVER queries Firestore, stores data, or acts on users.
import {classify,decide} from './policy.js';

const FIXTURES=Object.freeze([
  {label:'legitimate',body:'Qual é o significado da Eucaristia na Missa?',level:'clear',rule:'none',action:'clear'},
  {label:'phishing',body:'Clique https://exemplo.invalid e informe sua senha',level:'hold_candidate',rule:'possible_phishing',action:'review'},
  {label:'threat',body:'Vou te matar amanhã',level:'review',rule:'possible_threat',action:'review'},
  {label:'religious_quote',body:'No Evangelho, citando a frase vou te matar amanhã, quero entender o contexto.',level:'clear',rule:'none',action:'clear'},
  {label:'link_flood',body:'https://a.invalid https://b.invalid https://c.invalid https://d.invalid',level:'warning',rule:'links_excessive',action:'warn'}
]);
export const QA_POLICY_FIXTURE_COUNT=FIXTURES.length;

export function qaPolicyHeartbeatAllowed(env={}) {
  return env.GUARDIAN_V2_TEST_MODE==='true'
    && env.GUARDIAN_V2_ENABLED==='false'
    && env.GUARDIAN_V2_HOLD_ENABLED==='false'
    && env.GUARDIAN_V2_QA_SHADOW_READS==='false'
    && env.GUARDIAN_V2_QA_POLICY_HEARTBEAT==='true'
    && !env.GUARDIAN_FIREBASE_PROJECT_ID
    && !env.GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON;
}

export function runQaPolicyHeartbeat(env={},classifier=classify,policy=decide) {
  if(!qaPolicyHeartbeatAllowed(env))return {status:'disabled'};
  if(typeof classifier!=='function'||typeof policy!=='function')
    return {status:'failed',checks:0};
  try{
    for(const [i,fixture] of FIXTURES.entries()){
      const actual=classifier(fixture.body,{});
      if(!actual||actual.level!==fixture.level||actual.rule!==fixture.rule)
        return {status:'failed',checks:i};
      const outcome=policy(actual,{enabled:true,allowHold:false});
      if(outcome!==fixture.action)return {status:'failed',checks:i};
    }
    return {status:'passed',checks:FIXTURES.length};
  }catch{
    // Never show source text, credentials, user identifiers or stack traces.
    return {status:'failed',checks:0};
  }
}
