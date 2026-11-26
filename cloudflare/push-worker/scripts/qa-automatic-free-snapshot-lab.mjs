// Laboratory snapshot adapter. No network defaults or credentials.
// All document reads use the supplied transaction; Auth is separately rechecked
// by the transport boundary before sending. No data is logged.
import {AUTO_CHAT} from '../../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
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
function fields(f){
 if(!f||typeof f!=='object'||Array.isArray(f))fail();
 return Object.fromEntries(Object.entries(f).map(([k,v])=>[k,value(v)]));
}
function value(v){
 if(!v||typeof v!=='object'||Object.keys(v).length!==1)fail();
 if(Object.hasOwn(v,'nullValue')&&v.nullValue===null)return null;
 if(typeof v.stringValue==='string')return v.stringValue;
 if(typeof v.booleanValue==='boolean')return v.booleanValue;
 if(typeof v.integerValue==='string'&&/^-?\d+$/.test(v.integerValue)&&Number.isSafeInteger(Number(v.integerValue)))return Number(v.integerValue);
 if(typeof v.timestampValue==='string'&&Number.isSafeInteger(ms(v.timestampValue)))return ms(v.timestampValue);
 if(v.mapValue)return fields(v.mapValue.fields??{});
 if(v.arrayValue)return (v.arrayValue.values??[]).map(value);
 // Unused field types must not turn into an authorization value.
 return undefined;
}
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(x,k)).map(k=>[k,x[k]]));
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
    if(found===missing)fail();
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
  const message=messageDoc?pick(row(messageDoc),['uid','kind','createdAt','deletedForAll']):null;
  if(!uids.includes(message?.uid))fail();
  const sender=message.uid,recipient=uids.find(x=>x!==sender),user='users/'+recipient;
  const [mute,receipt,pending,outbox,retry]=await batch([
   user+'/chatBox/'+AUTO_CHAT,user+'/chatPushPublicationReceipts/'+eventKey,
   user+'/chatPushPending/current','qaPushAutomaticOutbox/'+eventKey,'qaPushAutomaticRetries/'+eventKey
  ]);
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
   if(!r.document)continue;
   const name=r.document.name,prefix=root+'/'+user+'/pushDevices/';
   if(typeof name!=='string'||!name.startsWith(prefix)||!id(name.slice(prefix.length))||seen.has(name)||++count>5)fail();
   seen.add(name);
   const f=row(r.document);
   if(typeof f.token==='string'&&f.token.length>0&&Number.isSafeInteger(f.updatedAt))deviceEligible=true;
  }
  const accounts=await lookupAccounts([...uids]);
  const admissions={},eligibility={},blocked={};
  for(const [i,uid] of uids.entries()){
   const a=row(others[i*3]),proof=row(others[i*3+1]);
   admissions[uid]=a;
   eligibility[uid]=proof&&Object.keys(proof).sort().join('|')==='minimumAge|policyVersion|reviewExpiresAt|status'
    ?{...proof,updatedAt:ms(others[i*3+1].updateTime)}:null;
   blocked[uid]=others[i*3+2]!==null;
  }
  return {transaction,creation:stamp(messageDoc.createTime),now,outbox:row(outbox),retry:row(retry),
   pendingVersion:pending?.updateTime??null,outboxVersion:outbox?.updateTime??null,snapshot:{projectId,databaseId,chatId:AUTO_CHAT,messageId:event.messageId,
    managedBoundary:writeBoundary!==null||pagination!==null,config:row(configDoc),
    room:row(roomDoc),message,accounts,admissions,eligibility,blocked,
    muted:mute!==null&&row(mute)?.muted!==false,deviceEligible,receipt:row(receipt),pending:row(pending)}};
 };
}
