/**
 * Local QA Service Binding emulator for synthetic batch delivery.
 * Node SQLite fixture ONLY: this is NOT deployable production Worker code.
 * No Firebase, FCM, Cloudflare calls, public routes or real user identifiers.
 * Separate HMAC roles and a durable nonce ledger approximate service-to-service
 * admission while retaining the existing production gates as disabled.
 */
import {
  planQaBatch,simulateQaBatch,createQaBatchReconciler
} from './qa-broadcast-batches.js';

export const QA_BATCH_HOST='https://qa-batch-stage.internal';
export const QA_BATCH_PROTOCOL_ID='qa-batch-demo-v1';
const ACTOR='qa-batch-00';
const UID=/^qa-batch-0[0-8]$/;
const REQUEST=/^qa-broadcast-[a-z0-9-]{1,40}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX=/^[0-9a-f]{64}$/;
const ROUTES=Object.freeze({
  plan:'/v1/plan',process:'/v1/process',
  drain:'/v1/drain',finalize:'/v1/finalize',status:'/v1/status',
  reconcile:'/v1/reconcile'
});
const ROLES=Object.freeze({
  push:['plan','process'],
  admin:['drain','finalize','status'],
  reconciler:['reconcile']
});
const text=(status,data)=>new Response(JSON.stringify(data),{
  status,headers:{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
});
const reject=()=>{throw Error('qa_batch_binding_denied');};
function validSecret(v){
  return typeof v==='string'&&v.length>=32&&v.length<=256&&/^[\x21-\x7e]+$/.test(v);
}
function validKeys(obj,fields){
  return obj && typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).sort().join(',')===[...fields].sort().join(',');
}
function validPayload(role,op,p){
  if(!ROLES[role]?.includes(op))reject();
  if(op==='plan'){
    if(!validKeys(p,['actorUid','requestId'])||
      p.actorUid!==ACTOR||!REQUEST.test(p.requestId))reject();
  }else if(op==='process'){
    if(!validKeys(p,['requestId'])||!REQUEST.test(p.requestId))reject();
  }else if(op==='drain'||op==='finalize'||op==='status'){
    if(!validKeys(p,['uid'])||!UID.test(p.uid))reject();
  }else if(op==='reconcile'){
    if(!validKeys(p,['requestId','recipientUid','fixtureEvidence'])||
      !REQUEST.test(p.requestId)||!UID.test(p.recipientUid)||
      !['qa-reviewed-synthetic-effect','qa-reviewed-never-started']
        .includes(p.fixtureEvidence))reject();
  }else reject();
}
async function signature(secret,role,time,nonce,path,raw,mode){
  if(!validSecret(secret)||!ROLES[role]||!UUID.test(nonce)||
    !Number.isSafeInteger(time)||!ROUTES[mode]||path!==ROUTES[mode])reject();
  const subtle=crypto.subtle;
  const key=await subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const bytes=new TextEncoder().encode(
    [QA_BATCH_PROTOCOL_ID,role,time,nonce,path,raw].join('\n'));
  return {key,bytes,subtle};
}
export async function signQaBatchRequest(secret,{role,time,nonce,path,body}){
  const op=Object.keys(ROUTES).find(k=>ROUTES[k]===path);
  const {key,bytes,subtle}=await signature(secret,role,time,nonce,path,body,op);
  const result=new Uint8Array(await subtle.sign('HMAC',key,bytes));
  return Array.from(result,x=>x.toString(16).padStart(2,'0')).join('');
}
async function verify(secret,{role,time,nonce,path,body,mac}){
  const op=Object.keys(ROUTES).find(k=>ROUTES[k]===path);
  const {key,bytes,subtle}=await signature(secret,role,time,nonce,path,body,op);
  if(!HEX.test(mac))reject();
  const sig=Uint8Array.from(mac.match(/../g),x=>parseInt(x,16));
  if(!await subtle.verify('HMAC',key,sig,bytes))reject();
}
async function boundedJson(request){
  const header=request.headers.get('Content-Length');
  if(header!==null&&(!/^\d+$/.test(header)||Number(header)>256))reject();
  const reader=request.body?.getReader();
  if(!reader)reject();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,raw='';
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>256){await reader.cancel();reject();}
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }finally{reader.releaseLock();}
  let parsed;
  try{parsed=JSON.parse(raw);}catch{reject();}
  return {raw,parsed};
}
function validateConfig(config){
  if(!config||typeof config.db?.prepare!=='function'||
    typeof config.db?.exec!=='function'||
    typeof config.readPage!=='function'||
    typeof config.sendFixture!=='function'||
    !config.keys||!['push','admin','reconciler'].every(x=>validSecret(config.keys[x]))||
    new Set(Object.values(config.keys)).size!==3)reject();
}
function reserveNonce(db,nonce,at){
  const result=db.prepare(
    'INSERT OR IGNORE INTO qa_bcast_nonces (nonce,created_ms) VALUES (?,?)'
  ).run(nonce,at);
  if(result.changes!==1)reject();
}
export function createQaBatchStageService(config){
  validateConfig(config);
  const {db,keys,readPage,sendFixture}=config;
  const now=typeof config.now==='function'?config.now:Date.now;
  return Object.freeze({
    async fetch(request){
      try{
        const u=new URL(request.url);
        if(u.origin!==QA_BATCH_HOST||u.search||request.method!=='POST')reject();
        const op=Object.keys(ROUTES).find(k=>ROUTES[k]===u.pathname);
        if(!op)reject();
        const role=request.headers.get('X-Qa-Batch-Role');
        if(!Object.hasOwn(ROLES,role)||!ROLES[role].includes(op))reject();
        const stamp=request.headers.get('X-Qa-Batch-Time');
        const nonce=request.headers.get('X-Qa-Batch-Nonce');
        const mac=request.headers.get('X-Qa-Batch-Mac');
        if(!/^\d{13}$/.test(stamp||'')||!UUID.test(nonce||'')||
          !HEX.test(mac||''))reject();
        const at=Number(stamp);
        if(Math.abs(now()-at)>60_000||!Number.isSafeInteger(at))reject();
        const {raw,parsed}=await boundedJson(request);
        validPayload(role,op,parsed);
        await verify(keys[role],{role,time:at,nonce,path:u.pathname,body:raw,mac});
        // Replay protection remains persisted even after a failed operation.
        reserveNonce(db,nonce,at);
        let result;
        if(op==='plan')result=await planQaBatch({
          db,actorUid:parsed.actorUid,requestId:parsed.requestId,readPage
        });
        else if(op==='process')result=await simulateQaBatch({
          db,requestId:parsed.requestId,sendFixture
        });
        else{
          const officer=createQaBatchReconciler(db);
          if(op==='drain')result={status:'qa_draining',
            state:officer.beginFreeze(parsed.uid)};
          if(op==='finalize')result={status:'qa_frozen',
            state:officer.finalizeFreeze(parsed.uid)};
          if(op==='status')result={status:'qa_account_status',
            ...officer.status(parsed.uid)};
          if(op==='reconcile')result=officer.reconcile({
            requestId:parsed.requestId,recipientUid:parsed.recipientUid,
            evidence:parsed.fixtureEvidence
          });
        }
        return text(200,result);
      }catch{return text(403,{status:'qa_batch_binding_denied'});}
    }
  });
}
export function createQaBatchStageClient({binding,role,secret,now=Date.now,
  nonce=()=>crypto.randomUUID()}={}){
  if(typeof binding?.fetch!=='function'||!Object.hasOwn(ROLES,role)||
    !validSecret(secret)||typeof now!=='function'||typeof nonce!=='function')reject();
  return Object.freeze({
    async request(op,payload){
      validPayload(role,op,payload);
      const at=now(),id=nonce(),path=ROUTES[op];
      if(!Number.isSafeInteger(at)||!UUID.test(id))reject();
      const body=JSON.stringify(payload);
      if(new TextEncoder().encode(body).length>256)reject();
      const mac=await signQaBatchRequest(secret,{
        role,time:at,nonce:id,path,body
      });
      const request=new Request(QA_BATCH_HOST+path,{
        method:'POST',headers:{'Content-Type':'application/json',
          'X-Qa-Batch-Role':role,'X-Qa-Batch-Time':String(at),
          'X-Qa-Batch-Nonce':id,'X-Qa-Batch-Mac':mac},body
      });
      const response=await binding.fetch(request);
      if(!(response instanceof Response)||!response.ok)reject();
      const data=await response.json();
      if(!data||typeof data.status!=='string'||!data.status.startsWith('qa_')||
        data.productionReady===true)reject();
      return data;
    }
  });
}
export const QA_BATCH_BINDING_READINESS=Object.freeze({
  productionIntegrated:false,cloudflareDeployed:false,
  actualServiceBindingConfigured:false,usesRealD1:false,
  realUserUidsAllowed:false,realFcmAllowed:false,stagingOnly:true
});