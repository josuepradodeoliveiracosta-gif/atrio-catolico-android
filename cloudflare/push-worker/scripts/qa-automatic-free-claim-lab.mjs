// Private REST claim/finish experiment. No credentials, default transport,
// scheduling or public route. The caller must reserve transport budget first.
import {planAutomaticNotice,AUTO_CHAT} from '../../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
const {projectId,databaseId,roundId}=identity;
const root='projects/'+projectId+'/databases/'+databaseId+'/documents';
const endpoint='https://firestore.googleapis.com/v1/'+root+':';
const uids=Object.keys(identity.accounts);
const key=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9+/=_-]{1,4096}$/.test(x);
const integer=v=>typeof v?.integerValue==='string'&&/^\d{1,15}$/.test(v.integerValue)?Number(v.integerValue):NaN;
const stamp=x=>Number.isSafeInteger(x?.seconds)&&x.seconds>0&&Number.isInteger(x.nanoseconds)&&x.nanoseconds>=0&&x.nanoseconds<1e9;
const same=(a,b)=>stamp(a)&&stamp(b)&&a.seconds===b.seconds&&a.nanoseconds===b.nanoseconds;
const millis=x=>x.seconds*1000+Math.floor(x.nanoseconds/1e6);
const text=v=>v?.stringValue;
const str=stringValue=>({stringValue});
const ignored=reason=>({status:'ignored',reason});
function ms(x){
 const m=typeof x==='string'&&/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(x);
 if(!m)return NaN;
 const t=Date.parse(m[1]+'Z');
 return Number.isSafeInteger(t)&&t>0&&new Date(t).toISOString().slice(0,19)===m[1]
  ?t+Number((m[2]??'').padEnd(3,'0').slice(0,3)):NaN;
}
async function eventKeyFor(messageId){
 const bytes=new TextEncoder().encode(JSON.stringify([roundId,AUTO_CHAT,messageId]));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
export function createFreeClaimLab({enabled=false,transport,readSnapshot}={}){
 if(typeof transport!=='function'||typeof readSnapshot!=='function')throw Error('missing_lab_dependency');
 const call=(method,body)=>transport({url:endpoint+method,method:'POST',redirect:'error',body});
 async function transact(eventKey,work,unknownStatus){
  if(enabled!==true)return ignored('automation_disabled');
  if(!key(eventKey))return ignored('invalid_event_key');
  let transaction=null,commitAttempted=false;
  try{
   const begin=await call('beginTransaction',{options:{readWrite:{}}});
   if(begin?.status!==200||!token(begin.body?.transaction))return ignored('transaction_unavailable');
   transaction=begin.body.transaction;
   const name=root+'/qaPushAutomaticOutbox/'+eventKey;
   const response=await call('batchGet',{documents:[name],transaction});
   if(response?.status!==200||!Array.isArray(response.body)||response.body.length!==1)return ignored('outbox_unavailable');
   const row=response.body[0],now=ms(row?.readTime),doc=row?.found;
   if(row?.missing===name&&!doc)return ignored('not_pending');
   if(doc?.name!==name||Object.hasOwn(row,'missing')||!Number.isSafeInteger(now)||
      !Number.isSafeInteger(ms(doc.updateTime))||!doc.fields||typeof doc.fields!=='object')
    return ignored('invalid_outbox');
   const f=doc.fields,creation=f.messageCreateTime?.mapValue?.fields;
   const o={state:text(f.state),roundId:text(f.roundId),conversationId:text(f.conversationId),
    messageId:text(f.messageId),senderUid:text(f.senderUid),recipientUid:text(f.recipientUid),
    senderGeneration:text(f.senderGeneration),recipientGeneration:text(f.recipientGeneration),
    creation:{seconds:integer(creation?.seconds),nanoseconds:integer(creation?.nanoseconds)},
    expiry:ms(f.expiresAt?.timestampValue),created:ms(f.createdAt?.timestampValue)};
   if(o.roundId!==roundId||o.conversationId!==AUTO_CHAT||!id(o.messageId)||
      await eventKeyFor(o.messageId)!==eventKey||!uids.includes(o.senderUid)||
      !uids.includes(o.recipientUid)||o.senderUid===o.recipientUid||!uuid(o.senderGeneration)||
      !uuid(o.recipientGeneration)||!stamp(o.creation)||!Number.isSafeInteger(o.expiry)||
      !Number.isSafeInteger(o.created)||o.created<millis(o.creation)||o.created>now||
      o.expiry>millis(o.creation)+120000)return ignored('invalid_outbox');
   const decision=await work({o,f,now,transaction,version:doc.updateTime});
   if(!decision?.write)return decision??ignored('invalid_decision');
   const {fields,transforms,result}=decision.write;
   commitAttempted=true;
   const c=await call('commit',{transaction,writes:[{update:{name,fields},
    updateMask:{fieldPaths:Object.keys(fields)},currentDocument:{updateTime:doc.updateTime},
    updateTransforms:transforms}]});
   if(c?.status!==200||c.body?.writeResults?.length!==1||!Number.isSafeInteger(ms(c.body.commitTime)))
    return {status:unknownStatus};
   return result;
  }catch{return commitAttempted?{status:unknownStatus}:ignored('transaction_unavailable')}
  finally{if(transaction&&!commitAttempted)try{await call('rollback',{transaction})}catch{}}
 }
 const terminal=({state})=>({write:{fields:{state:str(state)},transforms:[{fieldPath:'finishedAt',setToServerValue:'REQUEST_TIME'}],result:{status:state}}});
 return Object.freeze({
  async claim(eventKey){
   return transact(eventKey,async({o,f,now,transaction,version})=>{
    if(o.state!=='pending_transport'||['claimId','claimedAt','finishedAt','supersededBy'].some(k=>Object.hasOwn(f,k)))
     return ignored('not_pending');
    if(o.expiry-now<10000)return ignored('binding_or_expiry_invalid');
    const event={type:'created',projectId,databaseId,chatId:AUTO_CHAT,messageId:o.messageId,expectedCreateTime:o.creation};
    const state=await readSnapshot({transaction,event,eventKey});
    const snap=state?.snapshot,p=snap?.pending,r=snap?.receipt,b=state?.outbox;
    if(state?.transaction!==transaction||!same(state.creation,o.creation)||
       state.outboxVersion!==version||!Number.isSafeInteger(state.now)||state.now<now||
       !b||b.state!==o.state||b.expiresAt!==o.expiry||!same(b.messageCreateTime,o.creation)||
       b.messageId!==o.messageId||b.senderUid!==o.senderUid||b.recipientUid!==o.recipientUid||
       b.senderGeneration!==o.senderGeneration||b.recipientGeneration!==o.recipientGeneration||
       o.expiry-state.now<10000||!p||!r||p.kind!=='chat_message'||p.unread!==true||
       p.roundId!==roundId||r.roundId!==roundId||p.conversationId!==AUTO_CHAT||
       p.messageId!==o.messageId||p.senderUid!==o.senderUid||p.expiresAt!==o.expiry||r.expiresAt!==o.expiry||
       p.senderGeneration!==o.senderGeneration||p.recipientGeneration!==o.recipientGeneration||
       r.senderGeneration!==o.senderGeneration||r.recipientGeneration!==o.recipientGeneration||
       r.operatorUid!=='qa-auto-emulator-only')return ignored('binding_or_expiry_invalid');
    const check=planAutomaticNotice({enabled:true,event,now:state.now,snapshot:{...snap,receipt:null,pending:null}});
    if(check.status!=='candidate'||check.notice.senderUid!==o.senderUid||check.notice.recipientUid!==o.recipientUid||
       check.notice.expectedSenderGeneration!==o.senderGeneration||check.notice.expectedRecipientGeneration!==o.recipientGeneration||
       check.notice.expiresAt.getTime()<o.expiry)return ignored('authorization_changed');
    const claimId=crypto.randomUUID();
    return {write:{fields:{state:str('claimed_lab'),claimId:str(claimId)},
     transforms:[{fieldPath:'claimedAt',setToServerValue:'REQUEST_TIME'}],
     result:{status:'claimed_lab',eventKey,claimId}}};
   },'claim_unknown_lab');
  },
  async finish({eventKey,claimId,outcome}={}){
   if(!uuid(claimId)||!['accepted_simulated','rejected_simulated','unknown'].includes(outcome))return ignored('invalid_result');
   return transact(eventKey,({o,f,now})=>{
    if(o.state!=='claimed_lab'||text(f.claimId)!==claimId||!Number.isSafeInteger(ms(f.claimedAt?.timestampValue))||
       Object.hasOwn(f,'finishedAt'))return ignored('claim_mismatch');
    return terminal({state:o.expiry>now?outcome:'unknown'});
   },'finish_unknown_lab');
  },
  async expireClaim(eventKey){
   return transact(eventKey,({o,f,now})=>{
    if(o.state!=='claimed_lab'||!uuid(text(f.claimId))||!Number.isSafeInteger(ms(f.claimedAt?.timestampValue))||
       Object.hasOwn(f,'finishedAt')||o.expiry>now)return ignored('not_expired_claim');
    return terminal({state:'unknown'});
   },'finish_unknown_lab');
  }
 });
}
