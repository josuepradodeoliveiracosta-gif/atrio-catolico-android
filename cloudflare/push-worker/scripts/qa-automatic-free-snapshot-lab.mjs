// Laboratory snapshot adapter. No network defaults or credentials.
// All document reads use the supplied transaction; Auth is separately rechecked
// by the transport boundary before sending. No data is logged.
import {AUTO_CHAT} from '../../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
const {projectId,databaseId}=identity;
const uids=Object.keys(identity.accounts);
const root='projects/'+projectId+'/databases/'+databaseId+'/documents';
const url='https://firestore.googleapis.com/v1/'+root;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const key=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9+/=_-]{1,4096}$/.test(x);
function stamp(v){
 const m=typeof v==='string'&&/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(v);
 if(!m)return null;
 const base=Date.parse(m[1]+'Z');
 if(!Number.isSafeInteger(base)||base<=0||new Date(base).toISOString().slice(0,19)!==m[1])return null;
 return {seconds:base/1000,nanoseconds:Number((m[2]??'').padEnd(9,'0'))};
}
const ms=s=>{const t=stamp(s);return t?t.seconds*1000+Math.floor(t.nanoseconds/1e6):NaN};
const fail=()=>{throw Error('invalid_lab_snapshot')};
// Firestore integerValue and timestampValue must never become interchangeable
// authorization values just because both normalize to a JavaScript number.
const timestamps=new Set(['createdAt','updatedAt','admittedAt','reviewExpiresAt','expiresAt','claimedAt','finishedAt']);
const integers=new Set(['minimumAge','unreadRequester','unreadRecipient','seconds','nanoseconds']);
const booleans=new Set(['enabled','qaSimpleDirectEnabled','minorPolicyApproved','muted','unread']);
const strings=new Set(['uid','kind','status','lastMessageId','lastSenderUid','requesterUid','recipientUid',
 'version','safetyReviewVersion','projectId','databaseId','roundId','ageMode','email','generation',
 'policyVersion','token','state','conversationId','messageId','senderUid','recipientUid',
 'senderGeneration','recipientGeneration','operatorUid','claimId','supersededBy']);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const scalar=(v,k)=>object(v)&&Object.keys(v).length===1&&Object.hasOwn(v,k);
function fields(f){
 if(!object(f))fail();
 return Object.fromEntries(Object.entries(f).map(([k,v])=>[k,value(v,k)]));
}
function value(v,k){
 if(timestamps.has(k)){
  if(k==='expiresAt'&&scalar(v,'nullValue')&&v.nullValue===null)return null;
  if(!scalar(v,'timestampValue')||!Number.isSafeInteger(ms(v.timestampValue)))fail();
  return ms(v.timestampValue);
 }
 if(integers.has(k)){
  if(!scalar(v,'integerValue')||typeof v.integerValue!=='string'||
     !/^-?\d+$/.test(v.integerValue)||!Number.isSafeInteger(Number(v.integerValue)))fail();
  return Number(v.integerValue);
 }
 if(booleans.has(k)){
  if(!scalar(v,'booleanValue')||typeof v.booleanValue!=='boolean')fail();
  return v.booleanValue;
 }
 if(strings.has(k)){
  if(!scalar(v,'stringValue')||typeof v.stringValue!=='string')fail();
  return v.stringValue;
 }
 if(k==='pushPilot'||k==='messageCreateTime'){
  if(!scalar(v,'mapValue')||!object(v.mapValue)||!object(v.mapValue.fields))fail();
  return fields(v.mapValue.fields);
 }
 if(k==='participants'){
  if(!scalar(v,'arrayValue')||!Array.isArray(v.arrayValue?.values))fail();
  return v.arrayValue.values.map(x=>{
   if(!scalar(x,'stringValue')||typeof x.stringValue!=='string')fail();
   return x.stringValue;
  });
 }
 // Preserve presence, including deletedForAll and extra eligibility fields,
 // without traversing unused content or coercing unknown values.
 return undefined;
}
// Decode only fields used by the pure decision for large room/message docs.
const selected=(doc,keys)=>doc?fields(Object.fromEntries(keys.filter(k=>Object.hasOwn(doc.fields??{},k))
 .map(k=>[k,doc.fields[k]]))):null;
export function createFreeSnapshotLab({transport,lookupAccounts}={}){
 if(typeof transport!=='function'||typeof lookupAccounts!=='function')throw Error('missing_lab_dependency');
 return async function readSnapshot({transaction,event,eventKey}={}){
  if(!token(transaction)||!key(eventKey)||event?.projectId!==projectId||event.databaseId!==databaseId||
     event.chatId!==AUTO_CHAT||event.type!=='created'||!id(event.messageId))fail();
  let reads=0,requests=0,now=0;
  const call=async (suffix,body)=>{
   if(++requests>3)fail();
   const r=await transport({url:url+suffix,method:'POST',redirect:'error',body:{...body,transaction}});
   if(r?.status!==200||!Array.isArray(r.body))fail();
   return r.body;
  };
  function readTime(row){
   const t=ms(row?.readTime);
   if(!Number.isSafeInteger(t))fail();
   now=Math.max(now,t);
  }
  async function batch(paths){
   reads+=paths.length;if(reads>24)fail();
   const names=paths.map(p=>root+'/'+p);
   const rows=await call(':batchGet',{documents:names});
   if(rows.length!==names.length)fail();
   const result=new Map();
   for(const row of rows){
    readTime(row);
    const found=Object.hasOwn(row,'found'),missing=Object.hasOwn(row,'missing');
    if(found===missing||Object.hasOwn(row,'error'))fail();
    const name=found?row.found?.name:row.missing;
    if(!names.includes(name)||result.has(name))fail();
    const doc=found?row.found:null;
    if(doc&&(!stamp(doc.createTime)||!stamp(doc.updateTime)))fail();
    result.set(name,doc);
   }
   return paths.map(p=>result.get(root+'/'+p));
  }
  const chat='chats/'+AUTO_CHAT;
  const [configDoc,roomDoc,messageDoc,writeBoundary,pagination,...others]=await batch([
   'app_config/conversations',chat,chat+'/messages/'+event.messageId,
   'serverInboxControl/writeBoundary','serverInboxControl/pagination',
   ...uids.flatMap(uid=>['users/'+uid+'/chatPushAdmission/current',
    'users/'+uid+'/chatAgeEligibility/current','users/'+uid+'/blockedMembers/'+uids.find(x=>x!==uid)])
  ]);
  const row=d=>d?fields(d.fields??{}):null;
  const message=selected(messageDoc,['uid','kind','createdAt','deletedForAll']);
  const room=selected(roomDoc,['status','lastMessageId','lastSenderUid','participants','requesterUid','recipientUid','unreadRequester','unreadRecipient']);
  const config=row(configDoc);
  // Negative-only gates: none authorizes or replaces the full plan.
  // Avoid downstream work for clearly impossible candidates.
  if(writeBoundary||pagination||config?.enabled!==true||config?.qaSimpleDirectEnabled!==true||
     config?.minorPolicyApproved!==true||config?.pushPilot?.enabled!==true||
     !uids.includes(message?.uid)||!['text','post'].includes(message?.kind)||
     Object.hasOwn(message??{},'deletedForAll')||!Number.isSafeInteger(message?.createdAt)||
     message.createdAt>now||message.createdAt+120000-now<10000||
     room?.status!=='accepted'||room.lastMessageId!==event.messageId||room.lastSenderUid!==message.uid)
   fail();
  const sender=message.uid,recipient=uids.find(x=>x!==sender),user='users/'+recipient;
  const [mute,receipt,pending,outbox,retry]=await batch([
   user+'/chatBox/'+AUTO_CHAT,user+'/chatPushPublicationReceipts/'+eventKey,
   user+'/chatPushPending/current','qaPushAutomaticOutbox/'+eventKey,'qaPushAutomaticRetries/'+eventKey
  ]);
  const admissions={},eligibility={},blocked={};
  for(const [i,uid] of uids.entries()){
   const a=row(others[i*3]),proof=row(others[i*3+1]);
   admissions[uid]=a;
   eligibility[uid]=proof&&Object.keys(proof).sort().join('|')==='minimumAge|policyVersion|reviewExpiresAt|status'
    ?{...proof,updatedAt:ms(others[i*3+1].updateTime)}:null;
   blocked[uid]=others[i*3+2]!==null;
  }
  const muted=mute!==null&&row(mute)?.muted!==false;
  if(muted||uids.some(uid=>blocked[uid]||admissions[uid]?.status!=='active'||
     eligibility[uid]?.status!=='eligible'))fail();
  // At most five returned device documents; count empty query as one reserved read.
  reads+=5;if(reads>24)fail();
  const devices=await call('/'+user+':runQuery',{structuredQuery:{
   select:{fields:[{fieldPath:'token'},{fieldPath:'updatedAt'}]},
   from:[{collectionId:'pushDevices'}],limit:5}});
  if(devices.length>6)fail();
  let count=0,deviceEligible=false;
  const seen=new Set();
  for(const r of devices){
   readTime(r);
   if(Object.hasOwn(r,'error'))fail();
   if(!r.document)continue;
   const name=r.document.name,prefix=root+'/'+user+'/pushDevices/';
   if(typeof name!=='string'||!name.startsWith(prefix)||!id(name.slice(prefix.length))||seen.has(name)||++count>5)fail();
   seen.add(name);
   const f=row(r.document);
   if(typeof f.token==='string'&&f.token.length>0&&Number.isSafeInteger(f.updatedAt))deviceEligible=true;
  }
  if(!deviceEligible)fail();
  const accounts=await lookupAccounts([...uids]);
  return {transaction,creation:stamp(messageDoc.createTime),now,outbox:row(outbox),retry:row(retry),
   pendingVersion:pending?.updateTime??null,outboxVersion:outbox?.updateTime??null,snapshot:{projectId,databaseId,chatId:AUTO_CHAT,messageId:event.messageId,
    managedBoundary:writeBoundary!==null||pagination!==null,config,
    room,message,accounts,admissions,eligibility,blocked,
    muted,deviceEligible,receipt:row(receipt),pending:row(pending)}};
 };
}
