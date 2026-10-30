// Ponte REAL do Guardião, executada LOCALMENTE com ID token do Firebase QA.
// Injeções de Rate Limiting e D1 são SIMULADAS; nenhum Worker é implantado.
// O token passa exclusivamente via stdin; sem logs, arquivos ou argumentos de shell.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {qaFixtureRequest} from '../cloudflare/guardian-worker/src/qa-user-firestore-bridge.js';
import {QA_D1_RESERVE_SQL,QA_DAILY_READ_LIMIT} from '../cloudflare/guardian-worker/src/qa-d1-budget.js';

const URL='https://firestore.googleapis.com/v1/projects/atrio-catolico-qa-v2/databases/(default)/documents/posts/qa_post_1';
const JWT=/^[A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,2048}$/;
const SAFE=new Set(['qa_fixture_clear','qa_fixture_warn','qa_fixture_review']);
export async function localBridgeProbe(token,{fetcher=fetch}={}){
 if(typeof token!=='string'||!JWT.test(token))
  return {status:'blocked',code:'invalid_token',gets:0};
 let gets=0,budgetCalls=0,rateCalls=0;
 const env={
  GUARDIAN_V2_TEST_MODE:'true',GUARDIAN_V2_ENABLED:'false',
  GUARDIAN_V2_HOLD_ENABLED:'false',GUARDIAN_V2_QA_SHADOW_READS:'false',
  GUARDIAN_V2_QA_AUTO_DISPATCH:'false',GUARDIAN_QA_DISPATCH_READY:'false',
  GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'true', // LOCAL ONLY
  GUARDIAN_V2_QA_READER_PROJECT:'atrio-catolico-qa-v2',
  GUARDIAN_QA_GLOBAL_LIMITER:{limit:async()=>{rateCalls++;return {success:true};}},
  GUARDIAN_QA_TOKEN_LIMITER:{limit:async()=>{rateCalls++;return {success:true};}},
  GUARDIAN_QA_BUDGET_DB:{prepare:sql=>{
   if(sql!==QA_D1_RESERVE_SQL)throw Error('unexpected_d1_statement');
   return {bind:(day,limit)=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||limit!==QA_DAILY_READ_LIMIT)
     throw Error('unexpected_d1_parameters');
    return {first:async()=>{budgetCalls++;return {used:1};}};
   }};
  }}
 };
 const req=new Request('https://qa-local.invalid/qa/firebase-fixture',{
  method:'POST',headers:{Authorization:'Bearer '+token}});
 let response;
 try{
  response=await qaFixtureRequest(req,env,{fetcher:async(url,options)=>{
   if(url!==URL||options?.method!=='GET'||options?.headers?.Authorization!=='Bearer '+token
     ||options?.redirect!=='manual'||gets!==0)
     throw Error('unexpected_firestore_request');
   gets++;
   return fetcher(url,options);
  }});
  const data=await response.json();
  const code=typeof data?.status==='string'?data.status:'invalid_response';
  if(!SAFE.has(code)||response.status!==200||gets!==1||rateCalls!==2||budgetCalls!==1)
   return {status:'blocked',code:'qa_bridge_failed',gets};
  return {status:'passed',code,gets};
 }catch{return {status:'blocked',code:'qa_bridge_unavailable',gets};}
}
const invoked=process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href;
if(invoked){
 try{
  // One short-lived ID token, in memory only; never persist or print it.
  const token=readFileSync(0,'utf8').trim();
  const r=await localBridgeProbe(token);
  if(r.status==='passed'){
   console.log('QA_BRIDGE_LOCAL_PASS:',r.code);
  }else{
   console.log('QA_BRIDGE_LOCAL_BLOCKED');
   process.exitCode=1;
  }
 }catch{
  console.log('QA_BRIDGE_LOCAL_BLOCKED');
  process.exitCode=1;
 }
}
