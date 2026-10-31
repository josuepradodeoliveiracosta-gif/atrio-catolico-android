/**
 * PRIVATE STAGING SERVICE — HMAC-authenticated Worker-to-Worker D1 fixture.
 *
 * Deploy forbidden until a *dedicated* staging D1 and unique scoped secrets
 * are configured and approved. No Wrangler config with production D1 IDs.
 * Do not bind this Worker to live Avatar, Guardian or Push configurations.
 *
 * All data is synthetic (qa-freeze-alice / qa-freeze-bob), no deletion
 * endpoints, no Firebase, FCM, Cloudinary or external fetch.
 */
import {createQaPrivilegedWriteBarrier}
  from '../../account-deletion-audit/src/qa-privileged-write-barrier.js';
import {
  STAGE_HOST,STAGE_ID,STAGE_ROLES,stageSignature,stageNonceOk,
  stageFixtureUid,strictStageKey
} from './protocol.js';

const serviceKinds=Object.freeze({
  avatar:'avatar_upload',
  guardian:'guardian_content_write',
  push:'push_fcm_send'
});
const OPERATIONS=Object.freeze({
  '/v1/admit':'admit',
  '/v1/drain':'drain',
  '/v1/finalize':'finalize',
  '/v1/close':'close',
  '/v1/status':'status'
});
const text=(status,code,extra={})=>new Response(JSON.stringify({status:code,...extra}),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'}
});
const denied=()=>text(403,'stage_denied');
function exactKeys(obj,expected){
  return obj&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).sort().join(',')===[...expected].sort().join(',');
}
async function readBounded(request,cap=512){
  const len=request.headers.get('content-length');
  if(len!==null&&(!/^\d+$/.test(len)||Number(len)>cap))
    throw Error('stage_invalid_length');
  const reader=request.body?.getReader();
  if(!reader)throw Error('stage_missing_body');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,raw='';
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>cap)throw Error('stage_body_too_large');
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }finally{reader.releaseLock();}
  let obj;
  try{obj=JSON.parse(raw)}catch{throw Error('stage_invalid_json')}
  return {raw,obj};
}
async function authenticate(request,env,path,raw){
  const role=request.headers.get('x-atrio-role');
  const ts=request.headers.get('x-atrio-time');
  const nonce=request.headers.get('x-atrio-nonce');
  const signature=request.headers.get('x-atrio-signature');
  if(!role||!Object.hasOwn(STAGE_ROLES,role)||!stageNonceOk(nonce)||
    !/^\d{13}$/.test(ts||'')||!(/^[a-f0-9]{64}$/.test(signature||'')))
    throw Error('stage_invalid_auth');
  const moment=Number(ts);
  if(!Number.isSafeInteger(moment)||Math.abs(Date.now()-moment)>60000)
    throw Error('stage_expired_auth');
  const secret=env[STAGE_ROLES[role]];
  if(!strictStageKey(secret))throw Error('stage_secret_unavailable');
  // Verify MAC before making *any* change to D1; use subtle.verify to
  // avoid weak string comparison of attacker-controlled signatures.
  const expected=await stageSignature(secret,{role,timestamp:ts,nonce,path,body:raw});
  const bytes=Uint8Array.from(signature.match(/../g),x=>parseInt(x,16));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['verify']);
  const signed=[STAGE_ID,role,ts,nonce,path,raw].join('\n');
  if(!(await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(signed)))||
    signature!==expected)throw Error('stage_bad_signature');
  // Replays across *multiple Worker instances* are rejected by one D1
  // primary key. Fail closed when the operation may have succeeded.
  const reserved=await env.STAGE_FREEZE_DB.prepare(
    'INSERT OR IGNORE INTO qa_stage_nonces (nonce,created_ms) VALUES (?,?)'
  ).bind(nonce,moment).run();
  if(reserved?.success!==true||reserved?.meta?.changes!==1)
    throw Error('stage_replayed_nonce');
  return role;
}
function validateOperation(path,role,input){
  if(path==='/v1/admit'){
    if(!Object.hasOwn(serviceKinds,role)||
       !exactKeys(input,role==='push'?['actorUid','recipientUid']:['ownerUid']))
      throw Error('stage_role_scope');
    const accounts=Object.values(input);
    if(accounts.some(uid=>!stageFixtureUid(uid))||
       (role==='push'&&input.actorUid===input.recipientUid))
      throw Error('stage_invalid_uid');
    return {kind:serviceKinds[role],scope:input};
  }
  if(path==='/v1/drain'||path==='/v1/finalize'||path==='/v1/status'){
    if(role!=='admin'||!exactKeys(input,['uid'])||!stageFixtureUid(input.uid))
      throw Error('stage_admin_scope');
    return input;
  }
  if(path==='/v1/close'){
    // Reconciliation is *independent* from the effect caller. This stage
    // flag means fixture evidence only, not verification of real FCM/Cloudinary.
    if(role!=='reconciler'||!exactKeys(input,['operationId','fixtureEvidence'])||
       input.fixtureEvidence!=='demo-confirmed'||
       typeof input.operationId!=='string'||
       !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.operationId))
      throw Error('stage_reconciler_scope');
    return input;
  }
  throw Error('stage_unknown_operation');
}
async function reconcile(db,barrier,operationId){
  const rows=await db.prepare(
    'SELECT uid,kind FROM qa_privileged_operations WHERE operation_id = ? ORDER BY uid'
  ).bind(operationId).all();
  if(!Array.isArray(rows?.results)||rows.results.length<1||
     rows.results.length>2)throw Error('stage_no_ticket');
  const kind=rows.results[0].kind;
  if(!rows.results.every(x=>x.kind===kind&&stageFixtureUid(x.uid)))
    throw Error('stage_corrupt_ticket');
  const ticket={id:operationId,kind,accounts:rows.results.map(x=>x.uid)};
  await barrier.complete(ticket,{verified:async()=>true});
}
export default {
  async fetch(request,env){
    // The Worker must be *internal only*: workers_dev=false and no routes
    // in a dedicated staging account/configuration. No public URL.
    try{
      const url=new URL(request.url);
      if(url.origin!==STAGE_HOST||request.method!=='POST'||
         !Object.hasOwn(OPERATIONS,url.pathname)||url.search)
        return denied();
      if(env?.ATRIO_PRIVACY_STAGE_ID!==STAGE_ID||
         typeof env.STAGE_FREEZE_DB?.prepare!=='function')return denied();
      const {raw,obj}=await readBounded(request);
      // Do not permit an unknown UID into the D1 store, even with a valid MAC.
      const role=await authenticate(request,env,url.pathname,raw);
      const data=validateOperation(url.pathname,role,obj);
      const barrier=createQaPrivilegedWriteBarrier(env.STAGE_FREEZE_DB);
      if(url.pathname==='/v1/admit'){
        const ticket=await barrier.begin(data.kind,data.scope);
        return text(200,'stage_admitted',{operationId:ticket.id});
      }
      if(url.pathname==='/v1/drain'){
        await barrier.beginFreeze(data.uid);
        return text(200,'stage_draining');
      }
      if(url.pathname==='/v1/finalize'){
        await barrier.finalizeFreeze(data.uid);
        return text(200,'stage_frozen');
      }
      if(url.pathname==='/v1/status'){
        const value=await barrier.status(data.uid);
        return text(200,'stage_status',value);
      }
      await reconcile(env.STAGE_FREEZE_DB,barrier,data.operationId);
      return text(200,'stage_reconciled');
    }catch{return denied();}
  }
};
export const STAGE_READINESS=Object.freeze({
  productionIntegrated:false,
  publicAccessAllowed:false,
  userUidsAllowed:false,
  externalDeletionAllowed:false,
  realServiceBindingsConfigured:false
});
