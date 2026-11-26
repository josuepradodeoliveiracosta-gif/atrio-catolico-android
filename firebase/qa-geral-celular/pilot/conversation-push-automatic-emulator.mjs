// Laboratory only. No deployed trigger, no HTTP route, no FCM, no credentials.
// The real adapter and its IAM identity must be reviewed separately.
import {createHash,randomUUID} from 'node:crypto';
import {planAutomaticNotice,AUTO_CHAT} from './conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from './conversation-push-policy.mjs';

const DEMO='demo-atrio-v11';
const uids=Object.keys(identity.accounts);
const ms=t=>typeof t?.toMillis==='function'?Math.floor(t.toMillis()):NaN;
const nullableMs=t=>t===null?null:ms(t);
const key=(chat,message)=>createHash('sha256').update(JSON.stringify([identity.roundId,chat,message])).digest('hex');
const allowedId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
const row=s=>s.exists?s.data():null;

export function createAutomaticPushEmulator({db,auth,serverTimestamp,enabled=false}={}) {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'') ||
      !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST??'') ||
      process.env.GCLOUD_PROJECT!==DEMO || db?.projectId!==DEMO ||
      auth?.app?.options?.projectId!==DEMO || typeof serverTimestamp!=='function')
    throw Error('automatic_push_emulator_only');
  const doc=path=>db.doc(path);
  async function currentAccounts(){
    // Auth is external to Firestore's transaction. The future Worker must
    // recheck current accounts after commit and before any send.
    try {
      return Object.fromEntries(await Promise.all(uids.map(async uid=>{
        const a=await auth.getUser(uid);
        return [uid,{uid:a.uid,email:a.email,emailVerified:a.emailVerified,disabled:a.disabled}];
      })));
    } catch { return null; }
  }
  async function readState(tx,event,accounts){
    const chat=event.chatId,messageId=event.messageId,eventKey=key(chat,messageId);
      const [config,room,message,writeBoundary,pagination,...others]=await Promise.all([
        tx.get(doc('app_config/conversations')),tx.get(doc('chats/'+chat)),
        tx.get(doc('chats/'+chat+'/messages/'+messageId)),
        tx.get(doc('serverInboxControl/writeBoundary')),tx.get(doc('serverInboxControl/pagination')),
        ...uids.flatMap(uid=>[
          tx.get(doc('users/'+uid+'/chatPushAdmission/current')),
          tx.get(doc('users/'+uid+'/chatAgeEligibility/current')),
          tx.get(doc('users/'+uid+'/blockedMembers/'+uids.find(x=>x!==uid))),
        ])
      ]);
      // A delayed creation event must not authorize a newly recreated document.
      if(event.expectedCreateTime!==undefined&&
          (message.createTime?.seconds!==event.expectedCreateTime?.seconds||
           message.createTime?.nanoseconds!==event.expectedCreateTime?.nanoseconds))
        return null;
      const rawMessage=row(message);
      if (!rawMessage||!uids.includes(rawMessage.uid))
        return null;
      const sender=rawMessage.uid,recipient=uids.find(x=>x!==sender);
      const user='users/'+recipient;
      const receiptRef=doc(user+'/chatPushPublicationReceipts/'+eventKey);
      const pendingRef=doc(user+'/chatPushPending/current');
      const outboxRef=doc('qaPushAutomaticOutbox/'+eventKey);
      const [mute,devices,receipt,pending,outbox]=await Promise.all([
        tx.get(doc(user+'/chatBox/'+chat)),
        tx.get(db.collection(user+'/pushDevices').limit(5)),
        tx.get(receiptRef),tx.get(pendingRef),tx.get(outboxRef)
      ]);
      const now=ms(config.readTime);
      const c=row(config),p=row(pending);
      const admissions={},eligibility={},blocked={};
      for(const [i,uid] of uids.entries()){
        const a=row(others[i*3]), proof=row(others[i*3+1]);
        admissions[uid]=a&&{...a,admittedAt:ms(a.admittedAt),expiresAt:nullableMs(a.expiresAt)};
        eligibility[uid]=proof&&Object.keys(proof).sort().join('|')==='minimumAge|policyVersion|reviewExpiresAt|status'
          ? {...proof,reviewExpiresAt:ms(proof.reviewExpiresAt),updatedAt:ms(others[i*3+1].updateTime)}:null;
        blocked[uid]=others[i*3+2].exists;
      }
      const snapshot={
        projectId:identity.projectId,databaseId:identity.databaseId,chatId:chat,messageId,
        managedBoundary:writeBoundary.exists||pagination.exists,
        config:c&&{...c,pushPilot:c.pushPilot&&{...c.pushPilot,expiresAt:nullableMs(c.pushPilot.expiresAt)}},
        room:row(room),message:{...rawMessage,createdAt:ms(rawMessage.createdAt)},
        accounts,admissions,eligibility,blocked,
        muted:mute.exists?row(mute)?.muted!==false:false,
        // Preliminary candidate check only. Real Worker device policy remains mandatory.
        deviceEligible:devices.docs.some(d=>typeof d.data()?.token==='string'&&
          d.data().token.length>0&&Number.isFinite(ms(d.data().updatedAt))),
        receipt:row(receipt),pending:p&&{...p,expiresAt:ms(p.expiresAt)}
      };
    return {snapshot,now,chat,messageId,eventKey,sender,recipient,pendingRef,receiptRef,outboxRef,outbox};
  }
  return Object.freeze({async handle(event){
    if (enabled!==true) return {status:'ignored',reason:'automation_disabled'};
    if (event?.type!=='created'||event.projectId!==identity.projectId||
        event.databaseId!==identity.databaseId||event.chatId!==AUTO_CHAT||!allowedId(event.messageId))
      return {status:'ignored',reason:'invalid_event'};
    const accounts=await currentAccounts();
    if(!accounts)return {status:'ignored',reason:'auth_unavailable'};
    return db.runTransaction(async tx=>{
      const state=await readState(tx,event,accounts);
      if(!state)return {status:'ignored',reason:'invalid_or_expired_message'};
      const {snapshot,now,chat,messageId,eventKey,sender,recipient,pendingRef,receiptRef,outboxRef,outbox}=state;
      const decision=planAutomaticNotice({enabled:true,event,snapshot,now});
      if (decision.status!=='candidate') return decision;
      if(outbox.exists) return {status:'ignored',reason:'outbox_exists_or_unknown'};
      const n=decision.notice;
      const record={kind:'chat_message',conversationId:chat,messageId,senderUid:sender,unread:true,
        roundId:identity.roundId,expiresAt:n.expiresAt,senderGeneration:n.expectedSenderGeneration,
        recipientGeneration:n.expectedRecipientGeneration};
      // Same publication receipt key/shape as the manual service. Atomic with outbox.
      // This is an emulator-only experiment, not a new production authority.
      tx.set(pendingRef,record);
      tx.create(receiptRef,{roundId:identity.roundId,senderGeneration:record.senderGeneration,
        recipientGeneration:record.recipientGeneration,operatorUid:'qa-auto-emulator-only',
        expiresAt:n.expiresAt,createdAt:serverTimestamp()});
      tx.create(outboxRef,{state:'pending_transport',roundId:identity.roundId,conversationId:chat,
        messageId,senderUid:sender,recipientUid:recipient,senderGeneration:record.senderGeneration,
        recipientGeneration:record.recipientGeneration,expiresAt:n.expiresAt,createdAt:serverTimestamp()});
      return {status:'published_lab',eventKey};
    });

  },
  // One-shot claim: no automatic reclaim after a crash or uncertain send.
  // A real Worker must still revalidate and reserve in D1 before transport.
  async claim(eventKey){
    if(enabled!==true)return {status:'ignored',reason:'automation_disabled'};
    if(typeof eventKey!=='string'||!/^[a-f0-9]{64}$/.test(eventKey))
      return {status:'ignored',reason:'invalid_event_key'};
    const accounts=await currentAccounts();
    if(!accounts)return {status:'ignored',reason:'auth_unavailable'};
    return db.runTransaction(async tx=>{
      const ref=doc('qaPushAutomaticOutbox/'+eventKey);
      const entry=await tx.get(ref),o=row(entry),now=ms(entry.readTime);
      if(!o||o.state!=='pending_transport')return {status:'ignored',reason:'not_pending'};
      if(o.roundId!==identity.roundId||o.conversationId!==AUTO_CHAT||!allowedId(o.messageId)||
          key(o.conversationId,o.messageId)!==eventKey||!Number.isSafeInteger(now))
        return {status:'ignored',reason:'invalid_outbox'};
      const event={type:'created',projectId:identity.projectId,databaseId:identity.databaseId,
        chatId:o.conversationId,messageId:o.messageId};
      const state=await readState(tx,event,accounts);
      if(!state)return {status:'ignored',reason:'canonical_missing'};
      const {snapshot,sender,recipient}=state,p=snapshot.pending,r=snapshot.receipt;
      const expiry=ms(o.expiresAt);
      const bound=p&&r&&p.kind==='chat_message'&&p.unread===true&&
        p.roundId===o.roundId&&r.roundId===o.roundId&&p.conversationId===o.conversationId&&
        p.messageId===o.messageId&&p.senderUid===sender&&o.senderUid===sender&&
        o.recipientUid===recipient&&p.senderGeneration===o.senderGeneration&&
        p.recipientGeneration===o.recipientGeneration&&r.senderGeneration===o.senderGeneration&&
        r.recipientGeneration===o.recipientGeneration&&r.operatorUid==='qa-auto-emulator-only'&&
        p.expiresAt===expiry&&ms(r.expiresAt)===expiry;
      if(!bound||!Number.isSafeInteger(expiry)||expiry-state.now<10_000)
        return {status:'ignored',reason:'binding_or_expiry_invalid'};
      // These two existing records were checked above; only suppress them
      // for the pure revalidation of the original intent, never republish.
      const check=planAutomaticNotice({enabled:true,event,now:state.now,
        snapshot:{...snapshot,receipt:null,pending:null}});
      if(check.status!=='candidate'||check.notice.expectedSenderGeneration!==o.senderGeneration||
          check.notice.expectedRecipientGeneration!==o.recipientGeneration||
          check.notice.expiresAt.getTime()<expiry)
        return {status:'ignored',reason:'authorization_changed'};
      const claimId=randomUUID();
      tx.update(ref,{state:'claimed_lab',claimId,claimedAt:serverTimestamp()});
      return {status:'claimed_lab',eventKey,claimId};
    });
  },
  // Laboratory outcomes only. No external I/O and no real FCM acceptance.
  // Unknown is terminal: do not recycle a potentially transmitted event.
  async finish({eventKey,claimId,outcome}={}){
    if(enabled!==true)return {status:'ignored',reason:'automation_disabled'};
    if(typeof eventKey!=='string'||!/^[a-f0-9]{64}$/.test(eventKey)||
        typeof claimId!=='string'||!/^[0-9a-f-]{36}$/.test(claimId)||
        !['accepted_simulated','rejected_simulated','unknown'].includes(outcome))
      return {status:'ignored',reason:'invalid_result'};
    return db.runTransaction(async tx=>{
      const ref=doc('qaPushAutomaticOutbox/'+eventKey),snap=await tx.get(ref),o=row(snap);
      if(o?.state!=='claimed_lab'||o.claimId!==claimId)return {status:'ignored',reason:'claim_mismatch'};
      const state=ms(o.expiresAt)>ms(snap.readTime)?outcome:'unknown';
      tx.update(ref,{state,finishedAt:serverTimestamp()});
      return {status:state};
    });
  },
  async expireClaim(eventKey){
    if(enabled!==true)return {status:'ignored',reason:'automation_disabled'};
    if(typeof eventKey!=='string'||!/^[a-f0-9]{64}$/.test(eventKey))
      return {status:'ignored',reason:'invalid_event_key'};
    return db.runTransaction(async tx=>{
      const ref=doc('qaPushAutomaticOutbox/'+eventKey),snap=await tx.get(ref),o=row(snap);
      const now=ms(snap.readTime),expiry=ms(o?.expiresAt);
      if(o?.state!=='claimed_lab'||!Number.isSafeInteger(now)||!Number.isSafeInteger(expiry)||expiry>now)
        return {status:'ignored',reason:'not_expired_claim'};
      tx.update(ref,{state:'unknown',finishedAt:serverTimestamp()});
      return {status:'unknown'};
    });
  }});
}
