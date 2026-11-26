// Defense in depth for private laboratory writes, NOT a Firestore IAM boundary.
import {AUTO_CHAT} from '../../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
const root='projects/'+identity.projectId+'/databases/'+identity.databaseId+'/documents/';
const uids=Object.keys(identity.accounts);
const stop=()=>{throw Error('qa_write_guard_rejected')};
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const scalar=(x,k,v)=>exact(x,[k])&&x[k]===v;
const str=(x,v)=>scalar(x,'stringValue',v);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const key=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function timestamp(x){
 const m=typeof x==='string'&&/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(x);
 if(!m)return false;
 const t=Date.parse(m[1]+'Z');
 return Number.isSafeInteger(t)&&t>0&&new Date(t).toISOString().slice(0,19)===m[1];
}
const createOnly=x=>exact(x,['exists'])&&x.exists===false;
const version=(x,v)=>timestamp(v)&&exact(x,['updateTime'])&&x.updateTime===v;
const transform=(x,k)=>Array.isArray(x)&&x.length===1&&exact(x[0],['fieldPath','setToServerValue'])&&x[0].fieldPath===k&&x[0].setToServerValue==='REQUEST_TIME';
const update=(w,name,keys)=>exact(w.update,['name','fields'])&&w.update.name===name&&exact(w.update.fields,keys);
const shared=['roundId','senderGeneration','recipientGeneration','expiresAt'];
const base=[...shared,'conversationId','messageId','senderUid'];
function sharedMatch(f,n){
 return str(f.roundId,identity.roundId)&&str(f.senderGeneration,n.expectedSenderGeneration)&&
  str(f.recipientGeneration,n.expectedRecipientGeneration)&&scalar(f.expiresAt,'timestampValue',n.expiresAt.toISOString());
}
const baseMatch=(f,n)=>sharedMatch(f,n)&&str(f.conversationId,AUTO_CHAT)&&str(f.messageId,n.messageId)&&str(f.senderUid,n.senderUid);
export function assertQaPublicationWrites(body,{transaction,eventKey,notice:n,creation,pendingVersion}={}){
 if(!exact(body,['transaction','writes'])||typeof transaction!=='string'||!transaction||body.transaction!==transaction||
  !key(eventKey)||!n||!uids.includes(n.senderUid)||!uids.includes(n.recipientUid)||n.senderUid===n.recipientUid||
  n.conversationId!==AUTO_CHAT||!id(n.messageId)||!uuid(n.expectedSenderGeneration)||!uuid(n.expectedRecipientGeneration)||
  !(n.expiresAt instanceof Date)||!Number.isSafeInteger(n.expiresAt.getTime())||
  !Number.isSafeInteger(creation?.seconds)||creation.seconds<=0||!Number.isInteger(creation.nanoseconds)||
  creation.nanoseconds<0||creation.nanoseconds>=1e9||
  n.expiresAt.getTime()>creation.seconds*1000+Math.floor(creation.nanoseconds/1e6)+120000||
  !Array.isArray(body.writes)||body.writes.length!==3)stop();
 const [p,r,o]=body.writes,user=root+'users/'+n.recipientUid;
 if(!exact(p,['update','currentDocument'])||!update(p,user+'/chatPushPending/current',[...base,'kind','unread'])||
  !(pendingVersion===null?createOnly(p.currentDocument):version(p.currentDocument,pendingVersion))||
  !baseMatch(p.update.fields,n)||!str(p.update.fields.kind,'chat_message')||!scalar(p.update.fields.unread,'booleanValue',true))stop();
 if(!exact(r,['update','currentDocument','updateTransforms'])||
  !update(r,user+'/chatPushPublicationReceipts/'+eventKey,[...shared,'operatorUid'])||
  !createOnly(r.currentDocument)||!transform(r.updateTransforms,'createdAt')||
  !sharedMatch(r.update.fields,n)||!str(r.update.fields.operatorUid,'qa-auto-emulator-only'))stop();
 if(!exact(o,['update','currentDocument','updateTransforms'])||
  !update(o,root+'qaPushAutomaticOutbox/'+eventKey,[...base,'recipientUid','state','messageCreateTime'])||
  !createOnly(o.currentDocument)||!transform(o.updateTransforms,'createdAt')||!baseMatch(o.update.fields,n)||
  !str(o.update.fields.recipientUid,n.recipientUid)||!str(o.update.fields.state,'pending_transport'))stop();
 const m=o.update.fields.messageCreateTime;
 if(!exact(m,['mapValue'])||!exact(m.mapValue,['fields'])||!exact(m.mapValue.fields,['seconds','nanoseconds'])||
  !scalar(m.mapValue.fields.seconds,'integerValue',String(creation.seconds))||
  !scalar(m.mapValue.fields.nanoseconds,'integerValue',String(creation.nanoseconds)))stop();
}
export function assertQaTransitionWrite(body,{transaction,eventKey,updateTime,previousState,claimId,outcome}={}){
 if(!exact(body,['transaction','writes'])||typeof transaction!=='string'||!transaction||body.transaction!==transaction||
  !key(eventKey)||!Array.isArray(body.writes)||body.writes.length!==1)stop();
 const w=body.writes[0],claim=previousState==='pending_transport';
 const fields=claim?['state','claimId']:['state'];
 if(!claim&&previousState!=='claimed_lab')stop();
 if(!uuid(claimId)||!exact(w,['update','updateMask','currentDocument','updateTransforms'])||
  !update(w,root+'qaPushAutomaticOutbox/'+eventKey,fields)||!version(w.currentDocument,updateTime)||
  !exact(w.updateMask,['fieldPaths'])||!Array.isArray(w.updateMask.fieldPaths)||
  w.updateMask.fieldPaths.length!==fields.length||!fields.every((k,i)=>w.updateMask.fieldPaths[i]===k)||
  !transform(w.updateTransforms,claim?'claimedAt':'finishedAt'))stop();
 if(claim){if(outcome!=='claimed_lab'||!str(w.update.fields.state,outcome)||!str(w.update.fields.claimId,claimId))stop()}
 else if(!['accepted_simulated','rejected_simulated','unknown'].includes(outcome)||!str(w.update.fields.state,outcome))stop();
}
