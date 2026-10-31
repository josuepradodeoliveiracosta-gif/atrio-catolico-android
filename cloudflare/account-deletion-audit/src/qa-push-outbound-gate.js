/**
 * QA-ONLY boundary for selected outbound mutations of the ACTUAL Push Worker.
 * This module is NOT imported by the live Worker or bound to any real service.
 *
 * This is a deliberately narrow transport adapter, NOT an authorization layer:
 * - a single thread notification, with explicit actor and recipient;
 * - one direct FCM token send to a fixed fake device;
 * - one conditional stale-device cleanup.
 * Fan-out batches, topic sends, D1, moderation, queue and retries are denied.
 * The original Worker can still bypass this adapter in production.
 */
const A='qa-freeze-alice',B='qa-freeze-bob';
const QA_UIDS=new Set([A,B]);
const FIRESTORE='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents';
const FCM='https://fcm.googleapis.com/v1/projects/atrio-catolico/messages:send';
const NAME_PREFIX='projects/atrio-catolico/databases/(default)/documents/';
const IDENT=/^[A-Za-z0-9_-]{1,128}$/;
const TOKENS=new Map([['qa-fixture-device-alice',A],['qa-fixture-device-bob',B]]);
function fail(){throw Error('qa_push_uncovered_outbound');}
function checkUid(value){if(!QA_UIDS.has(value))fail();return value;}
function checkName(value){if(!IDENT.test(value||''))fail();return value;}
function parseJson(body){
  if(typeof body!=='string'||Buffer.byteLength(body,'utf8')>16384)fail();
  try{return JSON.parse(body);}catch{fail();}
}
function classify(input,init){
  if(typeof input!=='string'||!init||typeof init!=='object')fail();
  let url;
  try{url=new URL(input);}catch{fail();}
  const method=init.method;
  if(url.origin==='https://firestore.googleapis.com' &&
    url.pathname===new URL(FIRESTORE).pathname+':batchWrite' &&
    !url.search && method==='POST'){
    const payload=parseJson(init.body);
    if(!Array.isArray(payload.writes)||payload.writes.length!==1)fail();
    const w=payload.writes[0];
    if(!w?.update || w?.currentDocument?.exists!==false)fail();
    const parts=w.update.name?.split('/');
    if(w.update.name?.startsWith(NAME_PREFIX)!==true)fail();
    const path=w.update.name.slice(NAME_PREFIX.length).split('/');
    if(path.length!==4||path[0]!=='users'||path[2]!=='notifications')fail();
    const recipientUid=checkUid(path[1]);
    checkName(path[3]);
    const fields=w.update.fields;
    const actorUid=checkUid(fields?.actorUid?.stringValue);
    if(fields?.replyId?.stringValue!==path[3])fail();
    if(typeof fields?.postId?.stringValue!=='string'||
      !IDENT.test(fields.postId.stringValue))fail();
    if(w.updateMask || w.delete || w.transform || w.verify)fail();
    return {kind:'push_thread_notice',scope:{actorUid,recipientUid},batch:true};
  }
  if(url.origin==='https://fcm.googleapis.com' &&
    url.pathname===new URL(FCM).pathname &&
    !url.search && method==='POST'){
    const payload=parseJson(init.body);
    const msg=payload?.message;
    if(!msg || msg.topic || msg.condition || !TOKENS.has(msg.token))fail();
    const recipientUid=checkUid(msg.data?.uid);
    if(TOKENS.get(msg.token)!==recipientUid)fail();
    return {kind:'push_fcm_send',scope:{recipientUid}};
  }
  if(url.origin==='https://firestore.googleapis.com' &&
    method==='DELETE' &&
    url.pathname.startsWith(new URL(FIRESTORE).pathname+'/users/')){
    const path=url.pathname.slice((new URL(FIRESTORE).pathname+'/').length).split('/');
    if(path.length!==4||path[0]!=='users'||path[2]!=='pushDevices')fail();
    const ownerUid=checkUid(path[1]);
    checkName(path[3]);
    if(!url.searchParams.has('currentDocument.updateTime') ||
       [...url.searchParams.keys()].length!==1 ||
       !Number.isFinite(Date.parse(url.searchParams.get('currentDocument.updateTime'))))fail();
    return {kind:'push_cleanup_device',scope:{ownerUid}};
  }
  fail();
}

export function createQaPushOutboundGate({barrier,deliver,verifyEffect}={}){
  if(typeof barrier?.begin!=='function'||typeof barrier?.complete!=='function'||
    typeof deliver!=='function'||typeof verifyEffect!=='function')
    throw Error('qa_push_missing_dependency');
  return async function qaFetch(input,init){
    const item=classify(input,init);
    const ticket=await barrier.begin(item.kind,item.scope);
    // Unknown/partial effects, rejection and verification failure leave ticket OPEN.
    const response=await deliver(input,init);
    if(!(response instanceof Response)||!response.ok)
      throw Error('qa_push_outbound_ambiguous');
    if(item.batch){
      let payload;
      try{payload=await response.clone().json();}catch{throw Error('qa_push_batch_unverified');}
      if(!Array.isArray(payload?.status)||payload.status.length!==1||
        payload.status[0]?.code)throw Error('qa_push_batch_unverified');
    }
    if(await verifyEffect({kind:item.kind,scope:item.scope,
      httpStatus:response.status})!==true)
      throw Error('qa_push_effect_unverified');
    await barrier.complete(ticket,{verified:async()=>true});
    return response;
  };
}
export const QA_PUSH_OUTBOUND_READINESS=Object.freeze({
  productionIntegrated:false,allWorkerWritesCovered:false,
  topicAndFanoutCovered:false,serviceIdentityVerified:false
});
