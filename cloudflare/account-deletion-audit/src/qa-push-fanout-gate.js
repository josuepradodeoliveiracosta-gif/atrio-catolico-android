/**
 * QA ONLY: execute the REAL Push Worker writeThreadNotices helper with one
 * atomic SQLite ticket covering actor AND EVERY recipient.
 *
 * No real Worker imports this module. No production network / deploy.
 * A caller-supplied scope is intentionally forbidden: identity comes from
 * the exact event passed to the writer, preventing omitted recipients.
 */
import {writeThreadNotices} from '../../push-worker/src/index.js';
import {runQaPrivilegedOperation} from './qa-privileged-write-barrier.js';

const QA_UIDS=Object.freeze(['qa-freeze-alice','qa-freeze-bob']);
const BATCH='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents:batchWrite';
let transportBusy=false;
function deny(code){throw Error('qa_fanout_'+code);}
function guard(){
  if(process.env.ATRIO_PRIVILEGED_QA_ONLY!=='true' ||
     (process.env.FIRESTORE_EMULATOR_HOST &&
      process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089') ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    deny('unsafe_environment');
}
function eventRecipients(event){
  if(!event || typeof event!=='object' || Array.isArray(event) ||
     event.topic!=='atrio_thread_qa_post' ||
     !event.notice || typeof event.notice!=='object' ||
     event.notice.postId!=='qa_post' ||
     event.notice.replyId!=='qa_reply' ||
     !QA_UIDS.includes(event.notice.actorUid) ||
     !Array.isArray(event.recipients) ||
     event.recipients.length<1 || event.recipients.length>2 ||
     event.recipients.some(uid=>!QA_UIDS.includes(uid)) ||
     new Set(event.recipients).size!==event.recipients.length)
    deny('invalid_event');
  // The call to the Worker below uses the same frozen recipient list.
  return Object.freeze([...event.recipients]);
}
export async function runQaPushFanout(barrier,event,{transport,verifyRecipients}={}){
  guard();
  if(typeof transport!=='function'||typeof verifyRecipients!=='function')
    deny('missing_mock_transport_or_verification');
  const recipients=eventRecipients(event);
  const frozenEvent=Object.freeze({
    topic:event.topic,
    recipients,
    notice:Object.freeze({
      postId:event.notice.postId,replyId:event.notice.replyId,
      actorUid:event.notice.actorUid,actorName:'Usuário QA',
      createdAt:'2026-10-31T12:00:00Z'
    })
  });
  // Begin happens BEFORE any network call. A frozen recipient or actor blocks
  // all recipients in one SQLite INSERT SELECT; no partial ticket.
  return runQaPrivilegedOperation(barrier,'push_thread_notice',{
    actorUid:frozenEvent.notice.actorUid,recipientUids:recipients
  },{
    effect:async()=>{
      if(transportBusy)deny('overlapping_fetch_interception');
      transportBusy=true;
      const previous=globalThis.fetch;
      // Refuse all network destinations; the injected transport is a fake.
      globalThis.fetch=async(url,init)=>{
        if(String(url)!==BATCH || init?.method!=='POST' ||
           !String(init?.headers?.Authorization||'').startsWith('Bearer qa-fanout-mock-token'))
          deny('unexpected_network_destination');
        const payload=JSON.parse(init.body);
        const paths=payload?.writes?.map(w=>w?.update?.name);
        const expected=recipients.map(uid=>
          'projects/atrio-catolico/databases/(default)/documents/users/'+uid+
          '/notifications/qa_reply');
        if(!Array.isArray(paths) ||
           paths.length!==expected.length ||
           paths.some((p,i)=>p!==expected[i]))
          deny('write_recipient_mismatch');
        return transport(url,init);
      };
      try{await writeThreadNotices('qa-fanout-mock-token',frozenEvent);}
      finally{globalThis.fetch=previous;transportBusy=false;}
    },
    verify:async()=>{
      const confirmation=await verifyRecipients(recipients);
      // The fake remote must independently prove every recipient received
      // the mock write; a bare boolean cannot claim full fanout success.
      return Array.isArray(confirmation) &&
        confirmation.length===recipients.length &&
        recipients.every(uid=>confirmation.includes(uid)) &&
        new Set(confirmation).size===confirmation.length;
    }
  });
}
