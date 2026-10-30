import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  qaPolicyHeartbeatAllowed,runQaPolicyHeartbeat,QA_POLICY_FIXTURE_COUNT
} from './qa-policy-heartbeat.js';
import {classify} from './policy.js';

const safe={
  GUARDIAN_V2_TEST_MODE:'true',GUARDIAN_V2_ENABLED:'false',
  GUARDIAN_V2_HOLD_ENABLED:'false',GUARDIAN_V2_QA_SHADOW_READS:'false',
  GUARDIAN_V2_QA_POLICY_HEARTBEAT:'true'
};
test('executa somente exemplos fictícios, sem contas, tokens ou redes',()=>{
 const result=runQaPolicyHeartbeat(safe);
 assert.deepEqual(result,{status:'passed',checks:5});
 assert.equal(QA_POLICY_FIXTURE_COUNT,5);
 assert.deepEqual(Object.keys(result).sort(),['checks','status']);
});
test('heartbeat só pode existir no Worker QA isolado e expressamente habilitado',()=>{
 for(const [key,value] of Object.entries({
   GUARDIAN_V2_TEST_MODE:'false',
   GUARDIAN_V2_ENABLED:'true',
   GUARDIAN_V2_HOLD_ENABLED:'true',
   GUARDIAN_V2_QA_SHADOW_READS:'true',
   GUARDIAN_V2_QA_POLICY_HEARTBEAT:'false',
   GUARDIAN_FIREBASE_PROJECT_ID:'atrio-catolico',
   GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:'{}'
 })){
   assert.equal(qaPolicyHeartbeatAllowed({...safe,[key]:value}),false,key);
   assert.deepEqual(runQaPolicyHeartbeat({...safe,[key]:value}),{status:'disabled'});
 }
});
test('mecanismo falha fechado quando uma regra é regressiva',()=>{
 const broken=()=>({level:'clear',rule:'none'});
 const result=runQaPolicyHeartbeat(safe,broken,()=> 'clear');
 assert.deepEqual(result,{status:'failed',checks:1});
});
test('exceções são convertidas para status estático sem vazamento',()=>{
 const result=runQaPolicyHeartbeat(safe,()=>{throw Error('private-user-content')});
 assert.deepEqual(result,{status:'failed',checks:0});
 assert.equal(JSON.stringify(result).includes('private-user-content'),false);
});
test('uma mudança real de classificação é detectada',()=>{
 const changed=(text,ctx)=>{
   const current=classify(text,ctx);
   if(current.rule==='possible_phishing')return {...current,rule:'none'};
   return current;
 };
 assert.deepEqual(runQaPolicyHeartbeat(safe,changed),{status:'failed',checks:1});
});
test('não ativa quarentena: policy só recebe allowHold false',()=>{
 const checks=[];
 const probePolicy=(finding,settings)=>{
   checks.push({level:finding.level,enabled:settings.enabled,allowHold:settings.allowHold});
   if(finding.level==='clear')return 'clear';
   if(finding.level==='warning')return 'warn';
   return 'review';
 };
 assert.deepEqual(runQaPolicyHeartbeat(safe,classify,probePolicy),{status:'passed',checks:5});
 assert.equal(checks.length,5);
 assert.ok(checks.every(x=>x.allowHold===false));
});
