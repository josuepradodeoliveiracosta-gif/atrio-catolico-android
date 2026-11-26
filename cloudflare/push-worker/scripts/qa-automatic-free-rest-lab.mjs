// Laboratory REST discovery only; no default fetch, token, deployment or cron.
// An injected transport must be trusted and enforce no redirects. No writes.
import {discoverFreeCandidate} from './qa-automatic-free-discovery.mjs';
const project='atrio-catolico-qa-general',databaseId='(default)';
const root='projects/'+project+'/databases/'+databaseId+'/documents/';
const endpoint='https://firestore.googleapis.com/v1/projects/'+project+'/databases/'+databaseId+'/documents:batchGet';
const roomPath='chats/qa-nav-alice__qa-nav-bob';
const roomFields=['status','lastMessageId','lastSenderUid','participants','requesterUid','recipientUid','unreadRequester','unreadRecipient'];
const messageFields=['uid','kind','createdAt','deletedForAll'];
const ids=new Set(['qa-nav-alice','qa-nav-bob']);
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const time=x=>Number.isSafeInteger(x)&&x>0;
const integer=v=>typeof v?.integerValue==='string'&&/^\d{1,15}$/.test(v.integerValue)?Number(v.integerValue):NaN;
const string=v=>typeof v?.stringValue==='string'?v.stringValue:undefined;
function stamp(v){
 const m=typeof v==='string'&&/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(v);
 if(!m)return null;
 const base=Date.parse(m[1]+'Z');
 if(!Number.isSafeInteger(base)||base<=0||new Date(base).toISOString().slice(0,19)!==m[1])return null;
 return {seconds:base/1000,nanoseconds:Number((m[2]??'').padEnd(9,'0'))};
}
const millis=v=>v?v.seconds*1000+Math.floor(v.nanoseconds/1e6):NaN;
const stop=(reason,reads)=>({status:'ignored',reason,reads});
export function createFreeRestDiscoveryLab({transport}={}){
 if(typeof transport!=='function')throw Error('missing_lab_transport');
 return async function tick({enabled=false,projectId,activatedAt}={}){
  let reads=0;
  if(enabled!==true)return stop('automation_disabled',reads);
  if(projectId!==project||!time(activatedAt))return stop('invalid_environment',reads);
  async function read(path,fieldPaths){
   if(reads>=2)throw Error('read_budget');
   reads++;
   const name=root+path;
   const reply=await transport({url:endpoint,method:'POST',redirect:'error',
    body:{documents:[name],mask:{fieldPaths}}});
   if(reply?.status!==200)throw Error('rest_unavailable');
   const rows=reply.body;
   if(!Array.isArray(rows)||rows.length!==1)throw Error('invalid_response');
   const row=rows[0],readTime=millis(stamp(row?.readTime));
   if(!time(readTime))throw Error('invalid_read_time');
   if(row.missing===name&&!Object.hasOwn(row,'found'))return {missing:true,readTime};
   if(row.found?.name!==name||Object.hasOwn(row,'missing')||!row.found.fields||
      typeof row.found.fields!=='object'||Array.isArray(row.found.fields))
    throw Error('invalid_document');
   return {doc:row.found,readTime};
  }
  try{
   const r=await read(roomPath,roomFields);
   if(r.missing)return stop('room_missing',reads);
   if(activatedAt>r.readTime)return stop('invalid_environment',reads);
   const f=r.doc.fields;
   const room={path:roomPath,status:string(f.status),lastMessageId:string(f.lastMessageId),
    lastSenderUid:string(f.lastSenderUid),requesterUid:string(f.requesterUid),
    recipientUid:string(f.recipientUid),unreadRequester:integer(f.unreadRequester),
    unreadRecipient:integer(f.unreadRecipient),participants:f.participants?.arrayValue?.values?.map(string)};
   if(room.status!=='accepted'||!validId(room.lastMessageId)||!ids.has(room.lastSenderUid)||
      !ids.has(room.requesterUid)||!ids.has(room.recipientUid)||room.requesterUid===room.recipientUid||
      !Array.isArray(room.participants)||room.participants.length!==2||
      new Set(room.participants).size!==2||!room.participants.every(x=>ids.has(x)))
     return stop('invalid_room',reads);
   const unread=room.lastSenderUid===room.requesterUid?room.unreadRecipient:room.unreadRequester;
   if(!Number.isSafeInteger(unread)||unread<=0)return stop('no_unread_message',reads);
   const messagePath=roomPath+'/messages/'+room.lastMessageId;
   const m=await read(messagePath,messageFields);
   if(m.missing)return stop('message_missing',reads);
   if(m.readTime<r.readTime)return stop('inconsistent_read_time',reads);
   const g=m.doc.fields;
   const message={path:messagePath,uid:string(g.uid),kind:string(g.kind),
    createdAt:millis(stamp(g.createdAt?.timestampValue)),createTime:stamp(m.doc.createTime)};
   if(Object.hasOwn(g,'deletedForAll'))message.deletedForAll=true;
   return {...discoverFreeCandidate({enabled:true,projectId,databaseId,activatedAt,
     readTime:m.readTime,room,message}),reads};
  }catch{return stop('rest_or_response_unavailable',reads)}
 };
}
