// Private laboratory recovery. One exact outbox read, no collection scan.
// Only a confirmed, never-claimed publication is eligible. Claim must still
// transactionally validate the receipt, pending slot, message and authorization.
const projectId='atrio-catolico-qa-general',databaseId='(default)';
const chatId='qa-nav-alice__qa-nav-bob',roundId='qa-199-push-isolado';
const root='projects/'+projectId+'/databases/'+databaseId+'/documents';
const ids=new Set(['qa-nav-alice','qa-nav-bob']);
const time=x=>Number.isSafeInteger(x)&&x>0;
const stamp=x=>Number.isSafeInteger(x?.seconds)&&x.seconds>0&&
 Number.isInteger(x.nanoseconds)&&x.nanoseconds>=0&&x.nanoseconds<1e9;
const millis=x=>x.seconds*1000+Math.floor(x.nanoseconds/1e6);
const gen=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const s=v=>v?.stringValue;
const integer=v=>typeof v?.integerValue==='string'&&/^\d{1,15}$/.test(v.integerValue)?Number(v.integerValue):NaN;
function timestamp(x){
 const m=typeof x==='string'&&/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(x);
 if(!m)return NaN;
 const t=Date.parse(m[1]+'Z');
 if(!time(t)||new Date(t).toISOString().slice(0,19)!==m[1])return NaN;
 return t+Number((m[2]??'').padEnd(3,'0').slice(0,3));
}
const stop=reason=>({status:'ignored',reason});
async function hash(e){
 const bytes=new TextEncoder().encode(JSON.stringify([roundId,chatId,e.messageId]));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
export function createFreeRecoveryLab({transport,reserveRecovery}={}){
 if(typeof transport!=='function'||typeof reserveRecovery!=='function')throw Error('missing_lab_dependency');
 return async function recover({enabled=false,candidate,activatedAt}={}){
  if(enabled!==true)return stop('automation_disabled');
  const e=candidate?.event,deadline=candidate?.deadline;
  if(candidate?.status!=='candidate'||e?.type!=='created'||e.projectId!==projectId||
     e.databaseId!==databaseId||e.chatId!==chatId||
     typeof e.messageId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(e.messageId)||
     !stamp(e.expectedCreateTime)||!time(activatedAt)||!time(deadline)||
     millis(e.expectedCreateTime)<=activatedAt||deadline>millis(e.expectedCreateTime)+120000)
    return stop('invalid_candidate');
  try{
   if(await reserveRecovery()!==true)return stop('recovery_budget_unavailable');
   const eventKey=await hash(e),name=root+'/qaPushAutomaticOutbox/'+eventKey;
   const reply=await transport({url:'https://firestore.googleapis.com/v1/'+root+':batchGet',
    method:'POST',redirect:'error',body:{documents:[name]}});
   if(reply?.status!==200||!Array.isArray(reply.body)||reply.body.length!==1)
    return stop('recovery_unavailable');
   const row=reply.body[0],now=timestamp(row?.readTime);
   if(!time(now)||now<activatedAt||millis(e.expectedCreateTime)>now||deadline-now<10000)
    return stop('recovery_expired');
   if(row.missing===name&&!Object.hasOwn(row,'found'))return {status:'absent_lab'};
   if(row.found?.name!==name||Object.hasOwn(row,'missing'))return stop('invalid_outbox');
   const f=row.found.fields;
   if(!f||s(f.state)!=='pending_transport'||Object.hasOwn(f,'claimId')||
      Object.hasOwn(f,'claimedAt')||Object.hasOwn(f,'finishedAt')||Object.hasOwn(f,'supersededBy'))
    return stop('not_recoverable');
   const creation=f.messageCreateTime?.mapValue?.fields;
   const expiry=timestamp(f.expiresAt?.timestampValue),created=timestamp(f.createdAt?.timestampValue);
   if(s(f.roundId)!==roundId||s(f.conversationId)!==chatId||s(f.messageId)!==e.messageId||
      !ids.has(s(f.senderUid))||!ids.has(s(f.recipientUid))||s(f.senderUid)===s(f.recipientUid)||
      !gen(s(f.senderGeneration))||!gen(s(f.recipientGeneration))||
      integer(creation?.seconds)!==e.expectedCreateTime.seconds||
      integer(creation?.nanoseconds)!==e.expectedCreateTime.nanoseconds||
      !time(created)||created<=activatedAt||created<millis(e.expectedCreateTime)||created>now||
      !time(expiry)||expiry>deadline||expiry-now<10000)
    return stop('invalid_or_expired_outbox');
   return {status:'published_lab',eventKey};
  }catch{return stop('recovery_unavailable')}
 };
}
