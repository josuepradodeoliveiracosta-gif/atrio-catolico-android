/**
 * Executable Push Worker — strictly offline, fixture-only per-account
 * deletion-freeze protocol. NOT wired to Firebase, FCM, or production D1.
 *
 * The normal Worker never imports a QA ledger or acquires a per-UID permit.
 * This opt-in exercise helps validate how a future backend would atomically
 * fence BOTH author and recipient across a D1 marker and outbound delivery.
 *
 * No network calls, deployed secrets, delete APIs, arbitrary IDs or topics.
 */
const QA_UIDS=new Set(['qa-freeze-alice','qa-freeze-bob']);
const SQL='INSERT OR IGNORE INTO delivered (event_key,created_at) VALUES (?,?)';
const SECRET_FIELDS=Object.freeze([
  'FIREBASE_SERVICE_ACCOUNT_JSON','FIREBASE_WEB_API_KEY','PUSH_DB',
  'AI','CLOUDINARY_API_SECRET','GOOGLE_APPLICATION_CREDENTIALS'
]);
const FAIL='qa_scoped_privacy_denied';
const deny=()=>{throw Error(FAIL);};

export const QA_SCOPED_PUSH_MODE='ATRIO_PRIVACY_QA_SCOPED_FENCE';
export function qaPushScopedMode(env){
  const value=env?.[QA_SCOPED_PUSH_MODE];
  // Unknown/misspelled nonempty values close normal routes, not reopen them.
  return value!==undefined&&value!==null&&value!==false&&
    value!==''&&value!=='false';
}
function safeOfflineContext(request,env){
  if(!request||!env||typeof env!=='object')deny();
  if(env[QA_SCOPED_PUSH_MODE]!=='true' ||
     env.ATRIO_QA_PRIVACY_FIXTURE!=='demo-atrio-v11' ||
     request.url!=='https://qa-only.invalid/__qa/privacy/reply' ||
     request.method!=='POST')deny();
  // Existence checks do not evaluate any secret getter. A real Worker with
  // credentials or real D1 must be rejected BEFORE reading request contents.
  if(SECRET_FIELDS.some(key=>key in env))deny();
  if(typeof env.ATRIO_QA_PRIVACY_BARRIER?.begin!=='function' ||
     typeof env.ATRIO_QA_PRIVACY_BARRIER?.complete!=='function' ||
     typeof env.ATRIO_QA_PRIVACY_DB?.prepare!=='function' ||
     typeof env.ATRIO_QA_PRIVACY_FAKE_FCM!=='function' ||
     typeof env.ATRIO_QA_PRIVACY_VERIFY!=='function')deny();
}
function validateFixture(event){
  if(!event||typeof event!=='object'||Array.isArray(event)||
     Object.keys(event).sort().join(',')!=='actorUid,postId,recipientUid,replyId' ||
     !QA_UIDS.has(event.actorUid)||!QA_UIDS.has(event.recipientUid)||
     event.actorUid===event.recipientUid||
     event.postId!=='qa_post'||event.replyId!=='qa_reply')deny();
}
/**
 * Takes one atomic author+recipient ticket BEFORE D1 and holds it until
 * independent fake-FCM verification. Unknown results are never acknowledged:
 * the ticket remains in the fixture ledger and blocks freeze finalization.
 */
export async function executeQaScopedPushReply(request,env){
  safeOfflineContext(request,env);
  const size=Number(request.headers.get('content-length')||'0');
  if(!Number.isFinite(size)||size>256)deny();
  // A fixed-size, streaming bounded reader from the same Worker is invoked
  // by the HTTP dispatcher, so we do not accept unbounded request.text().
  let bytes=0,raw='';
  const reader=request.body?.getReader();
  if(!reader)deny();
  try{
    const decoder=new TextDecoder('utf-8',{fatal:true});
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>256)deny();
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }finally{reader.releaseLock();}
  let event;
  try{event=JSON.parse(raw);}catch{deny();}
  validateFixture(event);
  const {actorUid,recipientUid}=event;
  const barrier=env.ATRIO_QA_PRIVACY_BARRIER;
  const ticket=await barrier.begin('push_fcm_send',{actorUid,recipientUid});
  const marker='reply:qa_post:qa_reply:'+recipientUid;
  // The literal SQL matches the real Push Worker marker but this binding is
  // supplied ONLY by isolated tests. No Cloudflare D1 binding is accepted.
  const stamp=Date.now();
  const inserted=await env.ATRIO_QA_PRIVACY_DB.prepare(SQL)
    .bind(marker,stamp).run();
  const changes=inserted?.meta?.changes;
  if(changes!==0&&changes!==1)deny();
  if(changes===0){
    await barrier.complete(ticket,{verified:async()=>true});
    return Object.freeze({status:'qa_duplicate_no_send',productionReady:false});
  }
  const outcome=await env.ATRIO_QA_PRIVACY_FAKE_FCM(
    Object.freeze({actorUid,recipientUid,postId:'qa_post',
      replyId:'qa_reply',fixtureOnly:true})
  );
  if(outcome!==true)deny();
  const verified=await env.ATRIO_QA_PRIVACY_VERIFY(
    Object.freeze({actorUid,recipientUid,marker,fixtureOnly:true})
  );
  if(verified!==true)deny();
  await barrier.complete(ticket,{verified:async()=>true});
  return Object.freeze({status:'qa_fixture_verified',productionReady:false});
}
export const QA_SCOPED_PUSH_READINESS=Object.freeze({
  productionIntegrated:false,
  accountScopedFixtureOnly:true,
  protectsDeployedWorkers:false,
  remoteD1OrFcm:false,
  topicDeliveryAllowed:false,
  realAccountDeletionAllowed:false
});
