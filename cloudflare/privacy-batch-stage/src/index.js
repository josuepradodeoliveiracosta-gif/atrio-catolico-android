/**
 * Candidate Cloudflare Worker: ISOLATED QA FIXTURE ONLY.
 * Do not deploy without a new dedicated QA account, D1 and independent secrets.
 * No fetch(), Firebase, FCM, Cloudinary, queues, crons or live UID access.
 * A compatibility adapter for Workers D1, not the Node SQLite simulator.
 */
export const QA_STAGE_ID='demo-atrio-batch-cloud-v1';
export const QA_STAGE_HOST='https://qa-batch-cloud.internal';
const ROLE_KEYS=Object.freeze({
  push:'QA_BATCH_PUSH_HMAC',
  admin:'QA_BATCH_ADMIN_HMAC',
  reconciler:'QA_BATCH_RECONCILER_HMAC'
});
const ROLES=Object.freeze({
  '/v1/plan':'push','/v1/process':'push',
  '/v1/drain':'admin','/v1/finalize':'admin','/v1/status':'admin',
  '/v1/reconcile':'reconciler','/v1/release':'reconciler'
});
const UIDS=Object.freeze(Array.from({length:9},(_,i)=>'qa-batch-'+String(i).padStart(2,'0')));
const UID_PATTERN=/^qa-batch-0[0-8]$/;
const REQUEST=/^qa-broadcast-[a-z0-9-]{1,40}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const encoder=new TextEncoder();
const deny=()=>{throw Error('qa_cloud_stage_denied')};
const json=(status,body)=>new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'}
});
function keysMatch(obj,expected){
  return obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).sort().join(',')===[...expected].sort().join(',');
}
function secretOK(value){
  return typeof value==='string'&&value.length>=32&&value.length<=256&&
    /^[\x21-\x7e]+$/.test(value);
}
function scopeOK(path,body){
  if(path==='/v1/plan')return keysMatch(body,['requestId'])&&REQUEST.test(body.requestId);
  if(path==='/v1/process')return keysMatch(body,['requestId','mode'])&&
    REQUEST.test(body.requestId)&&['qa-accept','qa-ambiguous-at-2'].includes(body.mode);
  if(path==='/v1/status'||path==='/v1/drain'||path==='/v1/finalize')
    return keysMatch(body,['uid'])&&UID_PATTERN.test(body.uid);
  if(path==='/v1/release')return keysMatch(body,['requestId','fixtureEvidence'])&&
    REQUEST.test(body.requestId)&&body.fixtureEvidence==='qa-reviewed-lease';
  if(path==='/v1/reconcile')return keysMatch(body,['requestId','recipientUid','fixtureEvidence'])&&
    REQUEST.test(body.requestId)&&UID_PATTERN.test(body.recipientUid)&&
    ['qa-reviewed-synthetic-effect','qa-reviewed-never-started'].includes(body.fixtureEvidence);
  return false;
}
function envOK(env){
  if(env?.ATRIO_QA_BATCH_STAGE_ID!==QA_STAGE_ID ||
     env?.QA_BATCH_MODE!=='fixture-only' ||
     typeof env?.QA_BATCH_STAGE_DB?.prepare!=='function'||
     typeof env?.QA_BATCH_STAGE_DB?.batch!=='function')return false;
  const keys=Object.values(ROLE_KEYS).map(n=>env[n]);
  return keys.every(secretOK)&&new Set(keys).size===3;
}
async function bounded(request){
  const len=request.headers.get('Content-Length');
  if(len!==null&&(!/^\d+$/.test(len)||Number(len)>256))deny();
  const reader=request.body?.getReader();
  if(!reader)deny();
  let raw='',bytes=0;
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>256){await reader.cancel();deny();}
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }finally{reader.releaseLock();}
  let object;
  try{object=JSON.parse(raw)}catch{deny();}
  return {raw,object};
}
async function authenticate(request,env,path,raw){
  const role=request.headers.get('X-Qa-Role');
  if(!Object.hasOwn(ROLE_KEYS,role)||role!==ROLES[path])deny();
  const time=request.headers.get('X-Qa-Time');
  const nonce=request.headers.get('X-Qa-Nonce');
  const sig=request.headers.get('X-Qa-Signature');
  if(!/^\d{13}$/.test(time||'')||!UUID.test(nonce||'')||!HEX.test(sig||''))deny();
  const moment=Number(time);
  if(!Number.isSafeInteger(moment)||Math.abs(Date.now()-moment)>60_000)deny();
  const secret=env[ROLE_KEYS[role]];
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['verify']);
  const signed=encoder.encode([QA_STAGE_ID,role,time,nonce,path,raw].join('\n'));
  const sigBytes=Uint8Array.from(sig.match(/../g),x=>parseInt(x,16));
  if(!await crypto.subtle.verify('HMAC',key,sigBytes,signed))deny();
  return {moment,nonce};
}
async function nonce(db,token,at){
  const result=await db.prepare(
    'INSERT OR IGNORE INTO qa_bcast_nonces (nonce,created_ms) VALUES (?,?)'
  ).bind(token,at).run();
  if(result?.success!==true||result?.meta?.changes!==1)deny();
}
// A plan uses one atomic D1 batch. The only 9 accounts are seeded fixtures,
// not a query over Firestore or any account registry.
async function plan(db,id){
  const inserts=[
    db.prepare(
      "INSERT OR IGNORE INTO qa_bcast_jobs "+
      "(request_id,actor_uid,revision,manifest_hash,state) "+
      "SELECT ?,'qa-batch-00','qa-revision-cloud-v1',"+
      "'fixture-only-immutable-9-accounts','ready' "+
      "WHERE (SELECT COUNT(*) FROM qa_bcast_accounts WHERE state='active')=9"
    ).bind(id)
  ];
  for(let i=1;i<9;i++)inserts.push(db.prepare(
    "INSERT OR IGNORE INTO qa_bcast_deliveries "+
    "(request_id,recipient_uid,fake_token,state) "+
    "SELECT ?,? ,?,'queued' WHERE EXISTS "+
    "(SELECT 1 FROM qa_bcast_jobs WHERE request_id=? "+
    "AND actor_uid='qa-batch-00' AND revision='qa-revision-cloud-v1')"
  ).bind(id,UIDS[i],'qa-fcm-fixture-'+String(i).padStart(2,'0'),id));
  const result=await db.batch(inserts);
  if(!Array.isArray(result)||result.length!==9||
      result.some(x=>x?.success!==true))deny();
  // Read back only the bounded synthetic fixture.
  const j=await db.prepare(
    'SELECT state FROM qa_bcast_jobs WHERE request_id=?'
  ).bind(id).first();
  if(!j)deny();
  const count=await db.prepare(
    'SELECT COUNT(*) AS total FROM qa_bcast_deliveries WHERE request_id=?'
  ).bind(id).first();
  if(count?.total!==8)deny();
  return {status:result[0]?.meta?.changes===1?'qa_planned':'qa_duplicate_plan',
    queued:8,productionReady:false};
}
async function one(db,id,uid){
  return db.prepare(
    "UPDATE qa_bcast_deliveries SET state='inflight' "+
    "WHERE request_id=? AND recipient_uid=? AND state='queued' "+
    "AND EXISTS (SELECT 1 FROM qa_bcast_accounts a "+
      "WHERE a.uid=recipient_uid AND a.state='active') "+
    "AND EXISTS (SELECT 1 FROM qa_bcast_jobs j "+
      "JOIN qa_bcast_accounts a ON a.uid=j.actor_uid "+
      "WHERE j.request_id=qa_bcast_deliveries.request_id AND a.state='active') "+
    "RETURNING recipient_uid"
  ).bind(id,uid).first();
}
async function process(db,id,mode){
  const lease=await db.prepare(
    "UPDATE qa_bcast_jobs SET state='processing' "+
    "WHERE request_id=? AND state='ready' "+
    "AND NOT EXISTS (SELECT 1 FROM qa_bcast_deliveries "+
      "WHERE request_id=? AND state IN ('ambiguous','inflight')) "+
    "RETURNING request_id"
  ).bind(id,id).first();
  if(!lease)return {status:'qa_batch_not_admitted',productionReady:false};
  let attempted=0;
  const q=await db.prepare(
    "SELECT recipient_uid FROM qa_bcast_deliveries "+
    "WHERE request_id=? AND state='queued' ORDER BY recipient_uid LIMIT 3"
  ).bind(id).all();
  if(q?.success!==true||!Array.isArray(q.results))deny();
  for(const item of q.results){
    const claimed=await one(db,id,item.recipient_uid);
    if(!claimed){
      await db.prepare("UPDATE qa_bcast_jobs SET state='halted' "+
        "WHERE request_id=? AND state='processing'").bind(id).run();
      return {status:'qa_batch_frozen_or_denied',attempted,productionReady:false};
    }
    attempted++;
    const uncertain=mode==='qa-ambiguous-at-2'&&attempted===2;
    const marked=await db.prepare(
      "UPDATE qa_bcast_deliveries SET state=? "+
      "WHERE request_id=? AND recipient_uid=? AND state='inflight'"
    ).bind(uncertain?'ambiguous':'acked',id,item.recipient_uid).run();
    if(marked?.success!==true||marked.meta?.changes!==1)deny();
    if(uncertain){
      await db.prepare("UPDATE qa_bcast_jobs SET state='halted' "+
        "WHERE request_id=? AND state='processing'").bind(id).run();
      return {status:'qa_batch_ambiguous_pending_review',
        attempted,productionReady:false};
    }
  }
  const released=await db.prepare("UPDATE qa_bcast_jobs SET state='ready' "+
    "WHERE request_id=? AND state='processing'").bind(id).run();
  if(released?.success!==true||released.meta?.changes!==1)deny();
  return {status:attempted?'qa_batch_accepted_pending_review':'qa_batch_no_new_recipients',
    attempted,productionReady:false};
}
async function reconcile(db,{requestId,recipientUid,fixtureEvidence}){
  const current=await db.prepare(
    'SELECT state FROM qa_bcast_deliveries WHERE request_id=? AND recipient_uid=?'
  ).bind(requestId,recipientUid).first();
  const allowed=fixtureEvidence==='qa-reviewed-synthetic-effect'
    ? ['acked','ambiguous']:['queued'];
  if(!allowed.includes(current?.state))deny();
  const done=await db.prepare(
    "UPDATE qa_bcast_deliveries SET state='reconciled' "+
    "WHERE request_id=? AND recipient_uid=? AND state=?"
  ).bind(requestId,recipientUid,current.state).run();
  if(done?.success!==true||done.meta?.changes!==1)deny();
  return {status:'qa_independently_reconciled',productionReady:false};
}
async function release(db,id){
  const r=await db.prepare(
    "UPDATE qa_bcast_jobs SET state='ready' "+
    // Never unlock a PROCESSING job: the original worker might still be alive
    // between two individual claims (there is no fencing epoch/heartbeat).
    // Even with no inflight row, releasing it can admit a second worker.
    "WHERE request_id=? AND state='halted' "+
    "AND NOT EXISTS(SELECT 1 FROM qa_bcast_deliveries "+
    "WHERE request_id=? AND state IN ('inflight','ambiguous')) "+
    "RETURNING request_id"
  ).bind(id,id).first();
  if(!r)deny();
  return {status:'qa_reviewed_lease_released',productionReady:false};
}
async function freeze(db,uid,final=false){
  const sql=final
    ?"UPDATE qa_bcast_accounts SET state='frozen' "+
      "WHERE uid=? AND state='draining' "+
      "AND NOT EXISTS (SELECT 1 FROM qa_bcast_deliveries d "+
       "JOIN qa_bcast_jobs j ON j.request_id=d.request_id "+
       "WHERE (d.recipient_uid=? OR j.actor_uid=?) AND d.state!='reconciled') "+
      "RETURNING uid"
    :"UPDATE qa_bcast_accounts SET state='draining' "+
      "WHERE uid=? AND state='active' RETURNING uid";
  const result=final
    ?await db.prepare(sql).bind(uid,uid,uid).first()
    :await db.prepare(sql).bind(uid).first();
  if(!result)deny();
  return {status:final?'qa_frozen':'qa_draining',productionReady:false};
}
async function status(db,uid){
  const account=await db.prepare(
    'SELECT state FROM qa_bcast_accounts WHERE uid=?'
  ).bind(uid).first();
  if(!account)deny();
  const c=await db.prepare(
    'SELECT COUNT(*) AS pending FROM qa_bcast_deliveries d '+
    'JOIN qa_bcast_jobs j ON j.request_id=d.request_id '+
    "WHERE (d.recipient_uid=? OR j.actor_uid=?) AND d.state!='reconciled'"
  ).bind(uid,uid).first();
  if(!Number.isSafeInteger(c?.pending))deny();
  return {status:'qa_account_status',state:account.state,
    inFlight:c.pending,productionReady:false};
}
export default {
  async fetch(request,env){
    try{
      const url=new URL(request.url);
      if(url.origin!==QA_STAGE_HOST||url.search||request.method!=='POST'||
        !Object.hasOwn(ROLES,url.pathname)||!envOK(env))deny();
      const {raw,object}=await bounded(request);
      if(!scopeOK(url.pathname,object))deny();
      const {nonce:token,moment}=await authenticate(
        request,env,url.pathname,raw
      );
      const db=env.QA_BATCH_STAGE_DB;
      await nonce(db,token,moment);
      if(url.pathname==='/v1/plan')return json(200,await plan(db,object.requestId));
      if(url.pathname==='/v1/process')return json(200,await process(db,object.requestId,object.mode));
      if(url.pathname==='/v1/reconcile')return json(200,await reconcile(db,object));
      if(url.pathname==='/v1/release')return json(200,await release(db,object.requestId));
      if(url.pathname==='/v1/drain')return json(200,await freeze(db,object.uid));
      if(url.pathname==='/v1/finalize')return json(200,await freeze(db,object.uid,true));
      return json(200,await status(db,object.uid));
    }catch{return json(403,{status:'qa_cloud_stage_denied'});}
  }
};
export const QA_CLOUD_STAGE_READINESS=Object.freeze({
  productionIntegrated:false,deployed:false,realUsersAllowed:false,
  FcmEnabled:false,externalNetworkAllowed:false,openPublicRoutes:false
});