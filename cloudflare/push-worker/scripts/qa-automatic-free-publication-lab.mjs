// Laboratory only. No default transport, credentials, cron, or deployed route.
// The trusted snapshot adapter must read every authorization document and
// the bounded device query using this exact transaction. No caller snapshots.
import {planAutomaticNotice,AUTO_CHAT} from '../../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
const project=identity.projectId,db=identity.databaseId;
const root='projects/'+project+'/databases/'+db+'/documents/';
const endpoint='https://firestore.googleapis.com/v1/projects/'+project+'/databases/'+db+'/documents:';
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const time=x=>Number.isSafeInteger(x)&&x>0;
const stamp=x=>Number.isSafeInteger(x?.seconds)&&x.seconds>0&&
 Number.isInteger(x.nanoseconds)&&x.nanoseconds>=0&&x.nanoseconds<1e9;
const millis=x=>x.seconds*1000+Math.floor(x.nanoseconds/1e6);
const exactStamp=(a,b)=>stamp(a)&&stamp(b)&&a.seconds===b.seconds&&a.nanoseconds===b.nanoseconds;
const str=stringValue=>({stringValue});
const date=d=>({timestampValue:d.toISOString()});
const num=n=>({integerValue:String(n)});
const enc=new TextEncoder();
const deny=reason=>({status:'ignored',reason});
const tokenValid=x=>typeof x==='string'&&x.length>0&&x.length<=4096&&/^[A-Za-z0-9+/=_-]+$/.test(x);

// Candidate conservative reservation, not a measurement of actual billing.
// A future durable budget adapter must reserve atomically across invocations,
// include failed attempts and never refund ambiguous operations.
export const FREE_PUBLICATION_RESERVATION=Object.freeze({reads:24,writes:3,requests:8});
export const FREE_PUBLICATION_DAILY_ATTEMPTS=100;

async function eventKey(event){
 const data=enc.encode(JSON.stringify([identity.roundId,event.chatId,event.messageId]));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
}
function encodeWrites(n,key,creation,pendingVersion){
 const user='users/'+n.recipientUid;
 const pending=root+user+'/chatPushPending/current';
 const receipt=root+user+'/chatPushPublicationReceipts/'+key;
 const outbox=root+'qaPushAutomaticOutbox/'+key;
 const shared={roundId:str(identity.roundId),senderGeneration:str(n.expectedSenderGeneration),
  recipientGeneration:str(n.expectedRecipientGeneration),expiresAt:date(n.expiresAt)};
 const base={...shared,conversationId:str(n.conversationId),messageId:str(n.messageId),senderUid:str(n.senderUid)};
 const create=(name,fields)=>({update:{name,fields},currentDocument:{exists:false},
  updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]});
 return [
  {update:{name:pending,fields:{...base,kind:str('chat_message'),unread:{booleanValue:true}}},
   currentDocument:pendingVersion===null?{exists:false}:{updateTime:pendingVersion}},
  create(receipt,{...shared,operatorUid:str('qa-auto-emulator-only')}),
  create(outbox,{...base,recipientUid:str(n.recipientUid),state:str('pending_transport'),
   messageCreateTime:{mapValue:{fields:{seconds:num(creation.seconds),nanoseconds:num(creation.nanoseconds)}}}})
 ];
}

// The adapters are internal lab dependencies, not HTTP input. They still
// require a real REST implementation and emulator integration before deploy.
export function createFreePublicationLab({transport,readSnapshot,reserveBudget}={}){
 if([transport,readSnapshot,reserveBudget].some(x=>typeof x!=='function'))throw Error('missing_lab_dependency');
 return async function publish({enabled=false,candidate}={}){
  if(enabled!==true)return deny('automation_disabled');
  const e=candidate?.event,limit=candidate?.deadline;
  if(candidate?.status!=='candidate'||e?.type!=='created'||e.projectId!==project||e.databaseId!==db||
     e.chatId!==AUTO_CHAT||!validId(e.messageId)||!stamp(e.expectedCreateTime)||!time(limit)||
     limit>millis(e.expectedCreateTime)+120000)return deny('invalid_candidate');
  let reserved;
  try{reserved=await reserveBudget(FREE_PUBLICATION_RESERVATION)}catch{return deny('budget_unavailable')}
  if(reserved!==true)return deny('budget_unavailable');
  let transaction=null,commitAttempted=false;
  const call=(method,body)=>transport({url:endpoint+method,method:'POST',redirect:'error',body});
  try{
   const begin=await call('beginTransaction',{options:{readWrite:{}}});
   if(begin?.status!==200||!tokenValid(begin.body?.transaction))return deny('transaction_unavailable');
   transaction=begin.body.transaction;
   const key=await eventKey(e);
   const state=await readSnapshot({transaction,event:e,eventKey:key});
   if(state?.transaction!==transaction||!exactStamp(state.creation,e.expectedCreateTime)||
      !time(state.now)||millis(state.creation)>state.now||limit-state.now<10000||
      state.outbox!==null||state.retry!==null)
    return deny('snapshot_or_existing_work');
   const snapshot=state.snapshot;
   if(snapshot?.pending===null?state.pendingVersion!==null:
      typeof state.pendingVersion!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(state.pendingVersion))
     return deny('invalid_pending_version');
   const decision=planAutomaticNotice({enabled:true,event:e,snapshot,now:state.now});
   if(decision.status!=='candidate')return decision;
   const n={...decision.notice,expiresAt:new Date(Math.min(decision.notice.expiresAt.getTime(),limit))};
   if(n.expiresAt.getTime()-state.now<10000)return deny('notice_window_too_short');
   const writes=encodeWrites(n,key,state.creation,state.pendingVersion);
   commitAttempted=true;
   const committed=await call('commit',{transaction,writes});
   if(committed?.status!==200||!Array.isArray(committed.body?.writeResults)||
      committed.body.writeResults.length!==3||typeof committed.body.commitTime!=='string')
     return {status:'publication_unknown_lab'};
   return {status:'published_lab',eventKey:key};
  }catch{return commitAttempted?{status:'publication_unknown_lab'}:deny('transaction_unavailable')}
  finally{
   // Do not retry or roll back an ambiguous commit; it may already exist.
   if(transaction&&!commitAttempted)try{await call('rollback',{transaction})}catch{}
  }
 };
}
