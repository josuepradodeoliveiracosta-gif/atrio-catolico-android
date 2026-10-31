/**
 * QA ONLY — coordinate the Push Worker's exact D1 delivered marker and
 * a simulated single-recipient FCM reply under ONE durable fixture ticket.
 *
 * No live Worker imports this adapter. No Firebase, D1 binding, token,
 * Cloudflare deployment, deletion, or production credentials are used here.
 * TOPIC sends deliberately FAIL CLOSED: subscribers are not known by UID.
 *
 * The original Push Worker does NOT yet acquire a distributed ticket around
 * both its D1 marker and FCM send; this adapter is a regression experiment.
 */
import {createQaPushOutboundGate} from './qa-push-outbound-gate.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const UIDS=new Set([A,B]);
const TOKENS=Object.freeze({
  [A]:'qa-fixture-device-alice',
  [B]:'qa-fixture-device-bob'
});
const FCM='https://fcm.googleapis.com/v1/projects/atrio-catolico/messages:send';
// Deliberately identical to the Push Worker statement at /event.
const MARKER_SQL='INSERT OR IGNORE INTO delivered (event_key,created_at) VALUES (?,?)';
const fail=code=>{throw Error('qa_push_d1_'+code);};
function environmentSafe(){
  if(process.env.GOOGLE_APPLICATION_CREDENTIALS||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON||
     process.env.CLOUDINARY_API_SECRET||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED ||
     (process.env.FIRESTORE_EMULATOR_HOST &&
       process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'))
    fail('unsafe_environment');
}
export function createQaPushD1DeliveryGate({
  db,barrier,deliver,verifyOutbound,verifyDelivery,now=Date.now
}={}){
  if(typeof db?.prepare!=='function' ||
     typeof barrier?.begin!=='function' ||
     typeof barrier?.complete!=='function' ||
     typeof deliver!=='function' ||
     typeof verifyOutbound!=='function' ||
     typeof verifyDelivery!=='function' ||
     typeof now!=='function')
    fail('missing_qa_adapter');
  const qaFetch=createQaPushOutboundGate({
    barrier,deliver,verifyEffect:verifyOutbound
  });
  return Object.freeze({
    async reply({actorUid,recipientUid,topic=null,postId='qa_post',
      replyId='qa_reply'}={}){
      environmentSafe();
      if(!UIDS.has(actorUid)||!UIDS.has(recipientUid) ||
         actorUid===recipientUid ||
         topic!==null || postId!=='qa_post' || replyId!=='qa_reply')
        fail('unscoped_or_topic');
      const time=now();
      if(!Number.isSafeInteger(time)||time<=0)fail('invalid_clock');
      const marker='reply:qa_post:qa_reply:'+recipientUid;
      // Begin BEFORE the D1 marker and hold the SAME admission until after
      // outbound verification. A freeze can never finalize in that interval.
      const ticket=await barrier.begin('push_fcm_send',{actorUid,recipientUid});
      const result=await db.prepare(MARKER_SQL).bind(marker,time).run();
      const changes=result?.meta?.changes;
      if(changes!==0 && changes!==1)
        fail('marker_ambiguous');
      if(changes===0){
        // No new external effect. An earlier ambiguous ticket, if any, is
        // still held and remains a separate blocker for freeze finalization.
        await barrier.complete(ticket,{verified:async()=>true});
        return Object.freeze({status:'qa_duplicate_no_send',
          productionReady:false});
      }
      // The nested QA outbound gate also validates the exact fixed recipient
      // device and BOTH identities at the FCM transport boundary.
      const outgoing=await qaFetch(FCM,{
        method:'POST',
        body:JSON.stringify({message:{
          token:TOKENS[recipientUid],
          data:{uid:recipientUid,kind:'reply',actorUid,
            postId:'qa_post',replyId:'qa_reply'}
        }})
      });
      if(!(outgoing instanceof Response)||!outgoing.ok)
        fail('outbound_unverified');
      const approved=await verifyDelivery({actorUid,recipientUid,marker,
        markerInserted:changes===1,transportStatus:outgoing.status});
      if(approved!==true)fail('delivery_unverified');
      await barrier.complete(ticket,{verified:async()=>true});
      return Object.freeze({status:'qa_delivery_verified',
        productionReady:false});
    }
  });
}
export const QA_PUSH_D1_DELIVERY_READINESS=Object.freeze({
  productionIntegrated:false,
  actualWorkerModified:false,
  topicSupported:false,
  markerAndFcmAtomicFixtureTicket:true,
  remoteD1OrFcmSupported:false
});
