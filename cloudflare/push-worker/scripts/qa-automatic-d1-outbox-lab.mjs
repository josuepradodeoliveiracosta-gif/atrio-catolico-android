// Private D1/SQLite experiment. No migration, network, default binding, scheduler,
// public route or Firestore write. Authorization remains an injected trusted read.
import {AUTO_CHAT,planAutomaticNotice} from '../../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
import {continuousActiveSql} from './qa-automatic-continuous-gate.mjs';
const {projectId,databaseId,roundId}=identity;
const uids=Object.keys(identity.accounts);
const clock="CAST(unixepoch('subsec')*1000 AS INTEGER)";
export const D1_OUTBOX_LAB_SCHEMA=`CREATE TABLE IF NOT EXISTS qa_auto_d1_activation_lab (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 activated_at INTEGER NOT NULL CHECK(activated_at>0),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS qa_auto_d1_outbox_lab (
 event_key TEXT PRIMARY KEY CHECK(length(event_key)=64),
 activated_at INTEGER NOT NULL,
 sender_uid TEXT NOT NULL CHECK(sender_uid IN ('qa-nav-alice','qa-nav-bob')),
 recipient_uid TEXT NOT NULL CHECK(recipient_uid IN ('qa-nav-alice','qa-nav-bob') AND recipient_uid<>sender_uid),
 message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 128),
 sender_generation TEXT NOT NULL CHECK(length(sender_generation)=36),
 recipient_generation TEXT NOT NULL CHECK(length(recipient_generation)=36),
 creation_seconds INTEGER NOT NULL CHECK(creation_seconds>0),
 creation_nanos INTEGER NOT NULL CHECK(creation_nanos BETWEEN 0 AND 999999999),
 expires_at INTEGER NOT NULL CHECK(expires_at<=creation_seconds*1000+CAST(creation_nanos/1000000 AS INTEGER)+120000),
 state TEXT NOT NULL CHECK(state IN ('pending_transport','claimed_lab','accepted_simulated','rejected_simulated','unknown')),
 claim_id TEXT UNIQUE,
 claimed_at INTEGER,
 finished_at INTEGER,
 CHECK((state='pending_transport' AND claim_id IS NULL AND claimed_at IS NULL AND finished_at IS NULL) OR
 (state='claimed_lab' AND claim_id IS NOT NULL AND claimed_at IS NOT NULL AND finished_at IS NULL) OR
 (state IN ('accepted_simulated','rejected_simulated','unknown') AND claim_id IS NOT NULL AND claimed_at IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS qa_auto_d1_outbox_recipient_lab ON qa_auto_d1_outbox_lab(recipient_uid,expires_at);
`;

const time=x=>Number.isSafeInteger(x)&&x>0;
const key=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const stamp=x=>time(x?.seconds)&&Number.isInteger(x.nanoseconds)&&x.nanoseconds>=0&&x.nanoseconds<1e9&&time(x.seconds*1000+Math.floor(x.nanoseconds/1e6));
const ms=x=>x.seconds*1000+Math.floor(x.nanoseconds/1e6);
const same=(a,b)=>stamp(a)&&stamp(b)&&a.seconds===b.seconds&&a.nanoseconds===b.nanoseconds;
const deny=reason=>({status:'ignored',reason});
const trialActive="EXISTS (SELECT 1 FROM qa_auto_d1_activation_lab a WHERE a.singleton=1 AND a.enabled=1 AND a.activated_at=?)";
const fresh="? BETWEEN "+clock+"-5000 AND "+clock+"+1000";
const margin=clock+"+10000";
function statements(continuous){
const active=continuous===true?continuousActiveSql():trialActive;
const insert="INSERT INTO qa_auto_d1_outbox_lab(event_key,activated_at,sender_uid,recipient_uid,message_id,sender_generation,recipient_generation,creation_seconds,creation_nanos,expires_at,state) "+
 "SELECT ?,?,?,?,?,?,?,?,?,?,'pending_transport' WHERE "+active+" AND "+fresh+" AND ?>="+margin+
 " AND NOT EXISTS (SELECT 1 FROM qa_auto_d1_outbox_lab WHERE recipient_uid=? AND expires_at>"+clock+")"+
 " ON CONFLICT(event_key) DO NOTHING";
const select="SELECT * FROM qa_auto_d1_outbox_lab WHERE event_key=? AND activated_at=? AND "+active;
const claimSql="UPDATE qa_auto_d1_outbox_lab SET state='claimed_lab',claim_id=?,claimed_at="+clock+
 " WHERE event_key=? AND activated_at=? AND state='pending_transport' AND expires_at>="+margin+" AND "+active+" AND "+fresh;
const finishSql="UPDATE qa_auto_d1_outbox_lab SET state=CASE WHEN expires_at>"+clock+" AND "+active+" THEN ? ELSE 'unknown' END,finished_at="+clock+
 " WHERE event_key=? AND activated_at=? AND state='claimed_lab' AND claim_id=?";
return {active,insert,select,claimSql,finishSql};
}
const expireSql="UPDATE qa_auto_d1_outbox_lab SET state='unknown',finished_at="+clock+
 " WHERE event_key=? AND activated_at=? AND state='claimed_lab' AND expires_at<="+clock;
async function eventKey(e){
 const bytes=new TextEncoder().encode(JSON.stringify([roundId,AUTO_CHAT,e.messageId]));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
const eventFor=r=>({type:'created',projectId,databaseId,chatId:AUTO_CHAT,messageId:r.message_id,
 expectedCreateTime:{seconds:r.creation_seconds,nanoseconds:r.creation_nanos}});
const validEvent=e=>e?.type==='created'&&e.projectId===projectId&&e.databaseId===databaseId&&e.chatId===AUTO_CHAT&&id(e.messageId)&&stamp(e.expectedCreateTime);
const changed=r=>r?.success===true&&r.meta?.changes===1;
const sameRow=(a,b)=>!!a&&!!b&&['event_key','activated_at','sender_uid','recipient_uid','message_id','sender_generation','recipient_generation','creation_seconds','creation_nanos','expires_at','state','claim_id','claimed_at','finished_at'].every(k=>a[k]===b[k]);
export function createD1OutboxLab({db,enabled=false,activatedAt,readAuthorization,continuous=false}={}){
 if(typeof db?.prepare!=='function'||typeof readAuthorization!=='function')throw Error('missing_lab_dependency');
 const open=enabled===true&&time(activatedAt);
 const {active,insert,select,claimSql,finishSql}=statements(continuous);
 const first=(q,...args)=>db.prepare(q).bind(...args).first();
 const run=(q,...args)=>db.prepare(q).bind(...args).run();
 const load=k=>first(select,k,activatedAt,activatedAt);
 async function authorize(e,k){
  if(!validEvent(e)||ms(e.expectedCreateTime)<=activatedAt||await eventKey(e)!==k)return null;
  const a=await readAuthorization({event:e,eventKey:k});
  if(!time(a?.now)||!same(a.creation,e.expectedCreateTime)||ms(a.creation)>a.now)return null;
  const d=planAutomaticNotice({enabled:true,event:e,snapshot:a.snapshot,now:a.now});
  if(d.status!=='candidate')return null;
  return {notice:d.notice,now:a.now};
 }
 function matches(r,a){
  const n=a?.notice;
  return !!n&&n.senderUid===r.sender_uid&&n.recipientUid===r.recipient_uid&&
   n.messageId===r.message_id&&n.expectedSenderGeneration===r.sender_generation&&
   n.expectedRecipientGeneration===r.recipient_generation&&n.expiresAt.getTime()>=r.expires_at&&
   r.expires_at-a.now>=10000;
 }
 // Re-read exact record and SQL clock after authorization. This is not a
 // cross-store transaction; a future transport must still revalidate.
 async function stillCurrent(r,a){
  const again=await first(select+" AND expires_at>="+margin+" AND "+fresh,r.event_key,activatedAt,activatedAt,a.now);
  return sameRow(r,again);
 }
 return Object.freeze({
  async publish(candidate){
   if(!open)return deny('automation_disabled');
   const e=candidate?.event,deadline=candidate?.deadline;
   if(candidate?.status!=='candidate'||!validEvent(e)||!time(deadline)||
      deadline>ms(e.expectedCreateTime)+120000||ms(e.expectedCreateTime)<=activatedAt)return deny('invalid_candidate');
   let attempted=false;
   try{
    const k=await eventKey(e),a=await authorize(e,k);
    if(!a)return deny('authorization_changed');
    const n=a.notice,expiry=Math.min(deadline,n.expiresAt.getTime());
    if(!time(expiry)||expiry-a.now<10000)return deny('notice_window_too_short');
    attempted=true;
    const result=await run(insert,k,activatedAt,n.senderUid,n.recipientUid,n.messageId,
     n.expectedSenderGeneration,n.expectedRecipientGeneration,e.expectedCreateTime.seconds,e.expectedCreateTime.nanoseconds,expiry,
     activatedAt,a.now,expiry,n.recipientUid);
    return changed(result)?{status:'published_lab',eventKey:k}:result?.success===true&&result.meta?.changes===0?
     deny('slot_or_activation_unavailable'):{status:'publication_unknown_lab'};
   }catch{return attempted?{status:'publication_unknown_lab'}:deny('authorization_unavailable')}
  },
  async claim(k){
   if(!open||!key(k))return deny('invalid_or_disabled');
   let attempted=false;
   try{
    const r=await load(k);
    if(r?.state!=='pending_transport')return deny('not_pending');
    const a=await authorize(eventFor(r),k);
    if(!matches(r,a))return deny('authorization_changed');
    const claimId=crypto.randomUUID();
    attempted=true;
    const result=await run(claimSql,claimId,k,activatedAt,activatedAt,a.now);
    return changed(result)?{status:'claimed_lab',eventKey:k,claimId}:result?.success===true&&result.meta?.changes===0?
     deny('claim_unavailable'):{status:'claim_unknown_lab'};
   }catch{return attempted?{status:'claim_unknown_lab'}:deny('authorization_unavailable')}
  },
  async authorizeClaim({eventKey:k,claimId}={}){
   if(!open||!key(k)||!uuid(claimId))return deny('invalid_or_disabled');
   try{
    const r=await load(k);
    if(r?.state!=='claimed_lab'||r.claim_id!==claimId)return deny('claim_mismatch');
    const a=await authorize(eventFor(r),k);
    if(!matches(r,a)||!await stillCurrent(r,a))return deny('authorization_changed');
    return {status:'authorized_lab',eventKey:k,claimId,senderUid:r.sender_uid,recipientUid:r.recipient_uid,
     conversationId:AUTO_CHAT,messageId:r.message_id,expiresAt:r.expires_at};
   }catch{return deny('authorization_unavailable')}
  },
  // Recipient must already have been authenticated by a future real boundary.
  async readNotice(recipient){
   if(!open||!uids.includes(recipient))return deny('invalid_or_disabled');
   try{
    const r=await first("SELECT * FROM qa_auto_d1_outbox_lab WHERE recipient_uid=? AND activated_at=? AND "+active+
     " AND expires_at>="+margin+" AND state IN ('claimed_lab','accepted_simulated') ORDER BY expires_at DESC LIMIT 1",recipient,activatedAt,activatedAt);
    if(!r)return deny('no_notice');
    const a=await authorize(eventFor(r),r.event_key);
    if(!matches(r,a)||!await stillCurrent(r,a))return deny('authorization_changed');
    return {status:'notice_lab',conversationId:AUTO_CHAT,messageId:r.message_id,senderUid:r.sender_uid};
   }catch{return deny('authorization_unavailable')}
  },
  async finish({eventKey:k,claimId,outcome}={}){
   if(!open||!key(k)||!uuid(claimId)||!['accepted_simulated','rejected_simulated','unknown'].includes(outcome))return deny('invalid_result');
   try{
    const r=await run(finishSql,activatedAt,outcome,k,activatedAt,claimId);
    // Do not report the caller's outcome as durable: SQL can force unknown.
    return changed(r)?{status:'terminal_lab'}:r?.success===true&&r.meta?.changes===0?deny('claim_mismatch'):{status:'finish_unknown_lab'};
   }catch{return {status:'finish_unknown_lab'}}
  },
  async expireClaim(k){
   if(!open||!key(k))return deny('invalid_or_disabled');
   try{const r=await run(expireSql,k,activatedAt);
    return changed(r)?{status:'unknown'}:r?.success===true&&r.meta?.changes===0?deny('not_expired_claim'):{status:'finish_unknown_lab'};
   }catch{return {status:'finish_unknown_lab'}}
  }
 });
}
