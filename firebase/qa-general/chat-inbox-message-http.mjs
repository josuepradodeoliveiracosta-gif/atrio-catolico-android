/** Candidato de escrita de texto em QA, sem montagem remota. */
import {createHash} from 'node:crypto';
import {
  authenticateInboxCaller,InboxAccessDenied,inboxConfigValid,validInboxAge
} from './chat-inbox-discovery-server.mjs';
import {
  INBOX_DISCOVERY_CONTROL,INBOX_WRITE_BOUNDARY,existingPeerInboxViews,inboxAgePath,
  inboxBlockPath,inboxProjectionReady,peerInboxEntries,preparePeerInbox
} from './chat-inbox-peer-index.mjs';

const REQUEST=/^\/v1\/qa\/conversations\/requests\/([A-Za-z0-9_-]{1,128})$/;
const MESSAGE=/^\/v1\/qa\/conversations\/chats\/([A-Za-z0-9_-]{1,260})\/messages$/;
const KEY=/^[A-Za-z0-9_-]{16,128}$/;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const FIRST_LINK=/(https?:\/\/|www\.)/i;
const MAX_BYTES=20*1024;
const DAY_MS=86_400_000;
const SEND_INTERVAL_MS=3000;
const fail=(status,error)=>({status,body:{error}});
const denied=()=>fail(403,'conversation_unavailable');
const unavailable=()=>fail(503,'conversation_unavailable');

function response({status,body,headers}) {
  return new Response(JSON.stringify(body),{status,headers:{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
    'Pragma':'no-cache',...headers
  }});
}

async function readPayload(request,first) {
  if(!request.body||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i
    .test(request.headers.get('content-type')??''))return null;
  const stream=request.body.getReader();
  const chunks=[];
  let size=0;
  try{
    while(true) {
      const {done,value}=await stream.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES) {
        await stream.cancel();
        return null;
      }
      chunks.push(value);
    }
    const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    if(!input||typeof input!=='object'||Array.isArray(input)||
       Object.keys(input).some(key=>key!=='text'&&(first||key!=='replyToId'))||
       typeof input.text!=='string')return null;
    const text=input.text.trim();
    if(!text||[...text].length>1500||Buffer.from(text).toString()!==text||
       (first&&FIRST_LINK.test(text)))return null;
    if(Object.hasOwn(input,'replyToId')&&
       (typeof input.replyToId!=='string'||!ID.test(input.replyToId)))return null;
    return {text,replyToId:input.replyToId??null};
  }catch{return null;}
  finally{stream.releaseLock();}
}

function success(chatId,messageId,replayed) {
  return {status:200,body:{committed:true,replayed,chatId,messageId}};
}

async function contactOrigin(db,tx,{chat,chatId,actor,peer,now,messageId,text}) {
  const reverse=[peer,actor].sort().reverse().join('__');
  const quotaRef=db.doc('users/'+actor+'/chatLimits/requests');
  const refs=[db.doc('users/'+peer+'/chatSettings/privacy'),quotaRef];
  if(reverse!==chatId)refs.push(db.doc('chats/'+reverse));
  const [privacy,quota,alternate]=await tx.getAll(...refs);
  if(privacy.data()?.requests!=='all')return denied();
  if(chat.exists||alternate?.exists){
    const snapshots=[chat,alternate].filter(snap=>snap?.exists);
    return snapshots.every(snap=>existingPeerInboxViews(snap).some(view=>
      view.data.ownerUid===actor&&view.data.peerUid===peer))
      ? fail(409,'conversation_exists') : denied();
  }
  const timestamp=quota.data()?.windowStart;
  const lastCount=quota.data()?.count;
  if(quota.exists&&(!Number.isFinite(timestamp?.toMillis?.())||
     !Number.isInteger(lastCount)||lastCount<1||lastCount>5||
     timestamp.toMillis()>now.toMillis()))return unavailable();
  const newWindow=!quota.exists||now.toMillis()-timestamp.toMillis()>=DAY_MS;
  const count=newWindow?1:lastCount+1;
  if(count>5)return fail(429,'contact_quota_exceeded');
  const origin={
    participants:[actor,peer],requesterUid:actor,recipientUid:peer,status:'pending',
    initialId:messageId,lastMessageId:messageId,lastPreview:text,lastSenderUid:actor,
    createdAt:now,updatedAt:now,unreadRequester:0,unreadRecipient:1
  };
  return {origin,write:()=>{
    tx.create(chat.ref,origin);
    tx.set(quotaRef,{count,windowStart:newWindow?now:timestamp,updatedAt:now,lastChatId:chatId});
  }};
}

async function sendOrigin(tx,{chat,actor,now,messageId,text,replyToId}) {
  const current=chat.data();
  if(current.status!=='accepted')return fail(409,'conversation_not_accepted');
  if(current.lastMessageId!==current.initialId&&current.lastSenderUid===actor&&
     now.toMillis()-current.updatedAt.toMillis()<SEND_INTERVAL_MS)
    return {...fail(429,'message_rate_limited'),headers:{'Retry-After':'3'}};
  if(replyToId&&!(await tx.get(chat.ref.collection('messages').doc(replyToId))).exists)
    return fail(400,'invalid_reply');
  const counter=current.requesterUid===actor?'unreadRecipient':'unreadRequester';
  const count=current[counter];
  if(!Number.isInteger(count)||count<0||count>99)return unavailable();
  const fields={
    lastMessageId:messageId,lastPreview:text,lastSenderUid:actor,updatedAt:now,
    [counter]:Math.min(count+1,99)
  };
  return {origin:{...current,...fields},write:()=>tx.update(chat.ref,fields)};
}

async function execute(db,{actor,target,first,key,payload}) {
  const operation=createHash('sha256').update(JSON.stringify([actor,key])).digest('hex');
  const messageId='m-'+operation;
  const chatId=first?[actor,target].sort().join('__'):target;
  const chatRef=db.doc('chats/'+chatId);
  const receiptRef=db.doc('serverInboxMessageRequests/'+operation);
  const fingerprint=createHash('sha256')
    .update(JSON.stringify([first,target,payload.text,payload.replyToId])).digest('hex');
  return db.runTransaction(async tx=>{
    const [cfg,age,control,boundary,chat,receipt]=await tx.getAll(
      db.doc('app_config/conversations'),db.doc(inboxAgePath(actor)),
      db.doc(INBOX_DISCOVERY_CONTROL),db.doc(INBOX_WRITE_BOUNDARY),chatRef,receiptRef
    );
    const now=cfg.readTime;
    if(!inboxConfigValid(cfg.data())||!validInboxAge(age.data(),undefined,now.toMillis()))
      return denied();
    if(!inboxProjectionReady(control.data(),boundary.data()))return unavailable();
    const own=existingPeerInboxViews(chat).find(view=>view.data.ownerUid===actor);
    const peer=first?target:own?.data.peerUid;
    if(!peer||(chat.exists&&own?.data.peerUid!==peer))return denied();
    const [peerAge,forward,reverse]=await tx.getAll(
      db.doc(inboxAgePath(peer)),db.doc(inboxBlockPath(actor,peer)),db.doc(inboxBlockPath(peer,actor))
    );
    if(forward.exists||reverse.exists||!validInboxAge(peerAge.data(),undefined,now.toMillis()))
      return denied();
    if(receipt.exists) {
      if(receipt.get('fingerprint')!==fingerprint)return fail(409,'message_operation_conflict');
      return chat.exists?success(chatId,messageId,true):denied();
    }
    const input={chat,chatId,actor,peer,now,messageId,...payload};
    const plan=first?await contactOrigin(db,tx,input):await sendOrigin(tx,input);
    if(!plan.origin)return plan;
    const project=await preparePeerInbox(db,tx,peerInboxEntries(chatId,plan.origin));
    const message={uid:actor,text:payload.text,kind:'text',createdAt:now};
    if(payload.replyToId)message.replyToId=payload.replyToId;
    plan.write();
    tx.create(chatRef.collection('messages').doc(messageId),message);
    project();
    tx.create(receiptRef,{fingerprint});
    return success(chatId,messageId,false);
  });
}

/** verifyIdToken deve vir do Firebase Admin Auth vinculado ao projeto QA. */
export function createInboxMessageHttpHandler({db,verifyIdToken,enabled=false}={}) {
  if(typeof db?.doc!=='function'||typeof db?.runTransaction!=='function'||
     typeof verifyIdToken!=='function')throw Error('inbox_message_http_not_configured');
  return async request=>{
    if(enabled!==true)return response(fail(503,'inbox_closed'));
    let url;
    try{url=new URL(request?.url);}catch{return response(fail(400,'invalid_request'));}
    const first=url.pathname.match(REQUEST)?.[1];
    const target=first??url.pathname.match(MESSAGE)?.[1];
    if(!target||url.search)return response(fail(400,'invalid_request'));
    if(request.method!=='POST')return response({
      ...fail(405,'method_not_allowed'),headers:{Allow:'POST'}
    });
    const auth=request.headers.get('authorization')??'';
    if(!/^Bearer \S{1,8192}$/.test(auth))return response(denied());
    const key=request.headers.get('idempotency-key')??'';
    if(!KEY.test(key))return response(fail(400,'invalid_request'));
    try{
      const actor=await authenticateInboxCaller(verifyIdToken,auth.slice(7));
      if(first&&actor===target)return response(fail(400,'invalid_request'));
      const payload=await readPayload(request,Boolean(first));
      if(!payload)return response(fail(400,'invalid_request'));
      return response(await execute(db,{actor,target,first:Boolean(first),key,payload}));
    }catch(error){
      return response(error instanceof InboxAccessDenied?denied():unavailable());
    }
  };
}
