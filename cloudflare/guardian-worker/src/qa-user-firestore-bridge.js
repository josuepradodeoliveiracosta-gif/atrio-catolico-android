// Firebase Auth ID-token -> Firestore Rules. QA-only fixture proof of connectivity.
// The caller's token is validated AND authorized by Firestore REST. The Worker
// does NOT validate arbitrary identity claims or elevate any user privileges.
// No service accounts, Firestore writes, user content in responses, or log data.
import {classify,decide} from './policy.js';
import {reserveQaDailyRead} from './qa-d1-budget.js';

const QA_PROJECT='atrio-catolico-qa-v2';
const QA_RESOURCE='projects/'+QA_PROJECT+'/databases/(default)/documents';
const QA_URL='https://firestore.googleapis.com/v1/'+QA_RESOURCE+'/posts/qa_post_1';
const reply=(code,status)=>new Response(JSON.stringify({status}),{status:code,headers:{
 'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'
}});
// Explicit start and expiry are mandatory even if the bridge flag is true.
// No delayed activation from a distant expiry: the entire interval <=10 min.
// Missing or expired windows must fail before rate limits, D1 or Firebase.
const MAX_QA_BRIDGE_WINDOW_MS=10*60*1000;
export function qaBridgeEnabled(env,now=Date.now()){
 const begin=env?.GUARDIAN_V2_QA_BRIDGE_NOT_BEFORE;
 const finish=env?.GUARDIAN_V2_QA_BRIDGE_EXPIRES_AT;
 // Date.parse normalizes impossible calendar dates (e.g. February 30).
 // Accept only the exact canonical UTC instant configured by the operator.
 const valid=s=>{
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s))
   return false;
  const instant=Date.parse(s);
  return Number.isFinite(instant)&&new Date(instant).toISOString()===s;
 };
 if(!valid(begin)||!valid(finish)||!Number.isFinite(now))return false;
 const start=Date.parse(begin),end=Date.parse(finish);
 if(end<=start||end-start>MAX_QA_BRIDGE_WINDOW_MS||now<start||now>=end)
  return false;
 return env?.GUARDIAN_V2_TEST_MODE==='true'
 && env.GUARDIAN_V2_ENABLED==='false'
 && env.GUARDIAN_V2_HOLD_ENABLED==='false'
 && env.GUARDIAN_V2_QA_SHADOW_READS==='false'
 && env.GUARDIAN_V2_QA_AUTO_DISPATCH==='false'
 && env.GUARDIAN_QA_DISPATCH_READY==='false'
 && env.GUARDIAN_V2_QA_FIRESTORE_BRIDGE==='true'
 && env.GUARDIAN_V2_QA_READER_PROJECT===QA_PROJECT
 && !env.GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON
 && !env.GUARDIAN_FIREBASE_PROJECT_ID;
}
// Reject unexpectedly large API responses, including streamed replies with a
// missing or untrustworthy Content-Length. No payload is logged or echoed.
const MAX_QA_RESPONSE_BYTES=8192;
async function boundedQaJson(response){
 const announced=response.headers.get('content-length');
 if(announced!==null){
  const length=Number(announced);
  if(!Number.isSafeInteger(length)||length<0||length>MAX_QA_RESPONSE_BYTES)
   throw Error('invalid_qa_response_size');
 }
 const reader=response.body?.getReader();
 if(!reader)throw Error('invalid_qa_response_body');
 const chunks=[];let total=0;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   total+=value.byteLength;
   if(total>MAX_QA_RESPONSE_BYTES){
    await reader.cancel();
    throw Error('invalid_qa_response_size');
   }
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const data=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
}
// Two independent, approximate Cloudflare rate-limit bindings are required.
// Failure/absence denies Firestore reads; no in-memory per-isolate counters.
// The opaque Firebase ID token is SHA-256 hashed before becoming a limiter key;
// token values and unverified JWT claims never enter the rate limiter or logs.
async function qaReadBudgetGate(env,idToken){
 const global=env?.GUARDIAN_QA_GLOBAL_LIMITER;
 const perToken=env?.GUARDIAN_QA_TOKEN_LIMITER;
 if(typeof global?.limit!=='function'||typeof perToken?.limit!=='function')
  return 'unavailable';
 try{
  const shared=await global.limit({key:'qa-firebase-fixture'});
  if(shared?.success===false)return 'limited';
  if(shared?.success!==true)return 'unavailable';
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(idToken));
  const opaque=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  const personal=await perToken.limit({key:'qa-fixture:'+opaque});
  if(personal?.success===false)return 'limited';
  if(personal?.success!==true)return 'unavailable';
  return 'allowed';
 }catch{return 'unavailable';}
}
// Real Cloudflare POST requests may expose an empty ReadableStream even when
// no body bytes were supplied. Reject data, not the mere presence of a stream.
// Any nonzero declared Content-Length, unreadable body or stalled stream denies.
// Never decode, log or store supplied request content.
async function qaEmptyPostBody(request){
 const length=request.headers.get('content-length');
 if(length!==null&&length!=='0')return false;
 if(request.body===null)return true;
 const reader=request.body.getReader();
 try{
  for(let i=0;i<3;i++){
   let timer;
   const next=await Promise.race([
    reader.read(),
    new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),1200);})
   ]);
   clearTimeout(timer);
   if(next.timeout){reader.cancel().catch(()=>{});return false;}
   if(next.done)return true;
   if(!next.value||next.value.byteLength!==0)return false;
  }
  return false; // Never wait indefinitely for a stream of empty chunks.
 }catch{return false;}
 finally{try{reader.releaseLock();}catch{}}
}
export async function qaFixtureRequest(request,env,{fetcher=fetch,clock=Date.now}={}){
 if(!qaBridgeEnabled(env,clock()))return reply(503,'qa_bridge_disabled');
 if(request.method!=='POST')return reply(404,'not_found');
 if(!await qaEmptyPostBody(request))return reply(400,'invalid_request');
 const header=request.headers.get('authorization')||'';
 const matched=/^Bearer ([A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,2048})$/.exec(header);
 if(!matched)return reply(401,'unauthorized');
 const budget=await qaReadBudgetGate(env,matched[1]);
 if(budget==='limited')return reply(429,'qa_rate_limited');
 if(budget!=='allowed')return reply(503,'qa_rate_limit_unavailable');
 // Global daily ceiling is persisted in D1; no memory-local counters or best-effort quotas.
 const daily=await reserveQaDailyRead(env,{clock});
 if(daily==='limited')return reply(429,'qa_daily_budget_exhausted');
 if(daily!=='allowed')return reply(503,'qa_daily_budget_unavailable');
 // Window may close while D1 is reserving: never start a GET after expiry.
 if(!qaBridgeEnabled(env,clock()))return reply(503,'qa_bridge_disabled');
 // Firestore is responsible for verifying the JWT signature and Rules. Never
 // use decoded-but-unverified token claims for trust or authorization.
 // QA-only error classes: no upstream body, exception, JWT or UID in output.
 let result;
 try{
  result=await fetcher(QA_URL,{method:'GET',headers:{
   Authorization:'Bearer '+matched[1],Accept:'application/json'
  },redirect:'manual',signal:AbortSignal.timeout(6000)});
 }catch{return reply(503,'qa_upstream_network_unavailable');}
 if(!Number.isInteger(result?.status)||result.status<100||result.status>599)
  return reply(503,'qa_upstream_response_invalid');
 if([400,401,403].includes(result.status))return reply(403,'forbidden');
 // Cloudflare Workers does not implement redirect:"error". Using manual keeps
 // the Authorization header strictly on the original Firebase host.
 // Never follow (or read Location from) a 3xx response.
 if(result.status>=300&&result.status<400)return reply(503,'qa_upstream_redirect_blocked');
 if(result.status===404)return reply(404,'fixture_missing');
 if(result.status===429)return reply(503,'qa_upstream_throttled');
 if(!result.ok)return reply(503,'qa_upstream_http_unavailable');
 let data;
 try{data=await boundedQaJson(result);}
 catch{return reply(503,'qa_upstream_response_invalid');}
 if(data?.name!==QA_RESOURCE+'/posts/qa_post_1'||
    data.fields?.qaFixture?.booleanValue!==true ||
    typeof data.fields?.title?.stringValue!=='string'||
    typeof data.fields?.body?.stringValue!=='string')
  return reply(503,'invalid_qa_fixture');
 const title=data.fields.title.stringValue,body=data.fields.body.stringValue;
 if(title.length>120||body.length>1200)return reply(503,'invalid_qa_fixture');
 try{
  const finding=classify(title+' '+body);
  const action=decide(finding,{enabled:true,allowHold:false});
  if(!['clear','review','warn'].includes(action))return reply(503,'qa_bridge_unavailable');
  return reply(200,'qa_fixture_'+action);
 }catch{return reply(503,'qa_bridge_unavailable');}
}
