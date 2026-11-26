// Laboratory only. No deployed trigger, no HTTP route, no FCM, no credentials.
// The real adapter and its IAM identity must be reviewed separately.
import {createHash,randomUUID} from 'node:crypto';
import {planPublicationRetry} from './conversation-push-automatic-retry-plan.mjs';
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
    return {snapshot,now,chat,messageId,eventKey,sender,recipient,pendingRef,receiptRef,outboxRef,outbox,creation:message.createTime};
  }
  const eventValid=event=>event?.type==='created'&&event.projectId===identity.projectId&&
    event.databaseId===identity.databaseId&&event.chatId===AUTO_CHAT&&allowedId(event.messageId);
  const validKey=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  const stampValid=v=>Number.isSafeInteger(v?.seconds)&&v.seconds>0&&
    Number.isInteger(v.nanoseconds)&&v.nanoseconds>=0&&v.nanoseconds<1e9;
  const retryCollection='qaPushAutomaticRetries';

  async function processEvent(initialEvent,retryKey){
    if(enabled!==true)return {status:'ignored',reason:'automation_disabled'};
    if(retryKey===null?!eventValid(initialEvent):!validKey(retryKey))
      return {status:'ignored',reason:'invalid_event'};
    const accounts=await currentAccounts();
    if(!accounts&&retryKey===null)return {status:'ignored',reason:'auth_unavailable'};
    const eventKeyForRetry=retryKey??key(initialEvent.chatId,initialEvent.messageId);
    return db.runTransaction(async tx=>{
      const retryRef=doc(retryCollection+'/'+eventKeyForRetry);
      const retrySnap=await tx.get(retryRef),prior=row(retrySnap);
      const retryNow=ms(retrySnap.readTime);
      let event=initialEvent;
      const stopRetry=reason=>{
        if(retryKey!==null)tx.update(retryRef,{state:'stopped_lab',reason,finishedAt:serverTimestamp()});
        return {status:'ignored',reason};
      };
      if(retryKey===null&&retrySnap.exists)
        return {status:'ignored',reason:'retry_already_recorded'};
      if(retryKey!==null){
        if(prior?.state!=='scheduled_lab')return {status:'ignored',reason:'retry_not_scheduled'};
        if(prior.roundId!==identity.roundId||prior.conversationId!==AUTO_CHAT||
           !allowedId(prior.messageId)||key(prior.conversationId,prior.messageId)!==retryKey||
           !stampValid(prior.messageCreateTime)||!Number.isSafeInteger(prior.attempts)||
           prior.attempts<1||prior.attempts>3||!Number.isSafeInteger(retryNow)||
           !Number.isSafeInteger(ms(prior.deadline))||!Number.isSafeInteger(ms(prior.nextAt)))
          return stopRetry('invalid_retry_record');
        if(ms(prior.deadline)-retryNow<10000)return stopRetry('retry_expired');
        if(ms(prior.nextAt)>retryNow)return {status:'ignored',reason:'retry_not_due'};
        if(!accounts)return stopRetry('auth_unavailable');
        event={type:'created',projectId:identity.projectId,databaseId:identity.databaseId,
          chatId:prior.conversationId,messageId:prior.messageId,expectedCreateTime:prior.messageCreateTime};
      }
      const state=await readState(tx,event,accounts);
      if(!state)return stopRetry('invalid_or_expired_message');
      const {snapshot,now,chat,messageId,eventKey,sender,recipient,pendingRef,receiptRef,outboxRef,outbox,creation}=state;
      if(outbox.exists)return stopRetry('outbox_exists_or_unknown');
      if(retryKey!==null&&(prior.senderUid!==sender||prior.recipientUid!==recipient||
         prior.senderGeneration!==snapshot.admissions[sender]?.generation||
         prior.recipientGeneration!==snapshot.admissions[recipient]?.generation||
         ms(prior.deadline)-now<10000))
        return stopRetry('retry_authorization_changed');
      let decision=planAutomaticNotice({enabled:true,event,snapshot,now});
      let superseded=null;
      if(decision.status==='defer'&&decision.reason==='active_pending'&&!outbox.exists){
        const p=snapshot.pending;
        // Only replace an automatic publication that demonstrably has never
        // acquired a claim. Manual, claimed, terminal and malformed rows stay protected.
        if(p.kind==='chat_message'&&p.roundId===identity.roundId&&p.conversationId===chat&&
           p.senderUid===sender&&allowedId(p.messageId)&&p.messageId!==messageId&&
           p.senderGeneration===snapshot.admissions[sender]?.generation&&
           p.recipientGeneration===snapshot.admissions[recipient]?.generation){
          const oldKey=key(chat,p.messageId);
          const oldRef=doc('qaPushAutomaticOutbox/'+oldKey);
          const [oldOut,oldReceipt,oldMessage]=await Promise.all([
            tx.get(oldRef),tx.get(doc('users/'+recipient+'/chatPushPublicationReceipts/'+oldKey)),
            tx.get(doc('chats/'+chat+'/messages/'+p.messageId))]);
          const o=row(oldOut),r=row(oldReceipt),m=row(oldMessage);
          if(o?.state==='pending_transport'&&!Object.hasOwn(o,'claimId')&&!Object.hasOwn(o,'claimedAt')&&
             o.roundId===identity.roundId&&o.conversationId===chat&&o.messageId===p.messageId&&
             o.senderUid===sender&&o.recipientUid===recipient&&
             o.senderGeneration===p.senderGeneration&&o.recipientGeneration===p.recipientGeneration&&
             r?.operatorUid==='qa-auto-emulator-only'&&r.roundId===identity.roundId&&
             r.senderGeneration===p.senderGeneration&&r.recipientGeneration===p.recipientGeneration&&
             ms(o.expiresAt)===p.expiresAt&&ms(r.expiresAt)===p.expiresAt&&
             m?.uid===sender&&Number.isSafeInteger(ms(m.createdAt))&&
             ms(m.createdAt)<snapshot.message.createdAt&&
             o.messageCreateTime?.seconds===oldMessage.createTime?.seconds&&
             o.messageCreateTime?.nanoseconds===oldMessage.createTime?.nanoseconds){
            const candidate=planAutomaticNotice({enabled:true,event,now,snapshot:{...snapshot,pending:null}});
            if(candidate.status==='candidate'){decision=candidate;superseded=oldRef}
          }
        }
      }
      if(decision.status==='defer'&&decision.reason==='active_pending'){
        const plan=planPublicationRetry({decision,now,attempts:prior?.attempts??0,
          originalDeadline:prior?ms(prior.deadline):decision.retryBefore,
          pendingExpiresAt:snapshot.pending.expiresAt});
        const binding={roundId:identity.roundId,conversationId:chat,messageId,senderUid:sender,
          recipientUid:recipient,senderGeneration:snapshot.admissions[sender].generation,
          recipientGeneration:snapshot.admissions[recipient].generation,
          messageCreateTime:{seconds:creation.seconds,nanoseconds:creation.nanoseconds}};
        if(plan.status==='schedule'){
          const fields={state:'scheduled_lab',attempts:plan.attempt,deadline:new Date(plan.deadline),
            nextAt:new Date(plan.nextAt),updatedAt:serverTimestamp()};
          if(prior)tx.update(retryRef,fields);
          else tx.create(retryRef,{...binding,...fields,createdAt:serverTimestamp()});
          return {...decision,retryStatus:'scheduled_lab',eventKey,attempt:plan.attempt};
        }
        const fields={state:'stopped_lab',reason:plan.reason,finishedAt:serverTimestamp()};
        if(prior)tx.update(retryRef,fields);
        else tx.create(retryRef,{...binding,...fields,attempts:0,
          deadline:new Date(decision.retryBefore),createdAt:serverTimestamp()});
        return {...decision,retryStatus:'stopped_lab',eventKey};
      }
      if(decision.status!=='candidate')return retryKey===null?decision:stopRetry(decision.reason);
      const n={...decision.notice};
      if(prior)n.expiresAt=new Date(Math.min(n.expiresAt.getTime(),ms(prior.deadline)));
      if(n.expiresAt.getTime()-now<10000)return stopRetry('retry_expired');
      const record={kind:'chat_message',conversationId:chat,messageId,senderUid:sender,unread:true,
        roundId:identity.roundId,expiresAt:n.expiresAt,senderGeneration:n.expectedSenderGeneration,
        recipientGeneration:n.expectedRecipientGeneration};
      // Same publication receipt key/shape as the manual service. Atomic with outbox.
      // This is an emulator-only experiment, not a new production authority.
      if(superseded)tx.update(superseded,{state:'superseded_lab',supersededBy:eventKey,finishedAt:serverTimestamp()});
      tx.set(pendingRef,record);
      tx.create(receiptRef,{roundId:identity.roundId,senderGeneration:record.senderGeneration,
        recipientGeneration:record.recipientGeneration,operatorUid:'qa-auto-emulator-only',
        expiresAt:n.expiresAt,createdAt:serverTimestamp()});
      tx.create(outboxRef,{state:'pending_transport',roundId:identity.roundId,conversationId:chat,
        messageId,senderUid:sender,recipientUid:recipient,senderGeneration:record.senderGeneration,
        recipientGeneration:record.recipientGeneration,expiresAt:n.expiresAt,createdAt:serverTimestamp(),
        messageCreateTime:{seconds:creation.seconds,nanoseconds:creation.nanoseconds}});
      if(prior)tx.update(retryRef,{state:'published_lab',finishedAt:serverTimestamp()});
      return {status:'published_lab',eventKey};
    });
  }

  return Object.freeze({
  async handle(event){return processEvent(event,null)},
  async retry(eventKey){
    if(!validKey(eventKey))return {status:'ignored',reason:'invalid_event_key'};
    return processEvent(null,eventKey);
  },
  // Bounded, manually invoked drain in the emulator. The query's local clock
  // is only a selection hint; each transaction uses Firestore readTime.
  async drainDue(){
    if(enabled!==true)return [];
    const due=await db.collection(retryCollection).where('state','==','scheduled_lab')
      .where('nextAt','<=',new Date()).orderBy('nextAt').limit(10).get();
    const results=[];
    for(const entry of due.docs)results.push(await processEvent(null,entry.id));
    return results;
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
          key(o.conversationId,o.messageId)!==eventKey||!Number.isSafeInteger(now)||
          !Number.isSafeInteger(o.messageCreateTime?.seconds)||!Number.isInteger(o.messageCreateTime?.nanoseconds))
        return {status:'ignored',reason:'invalid_outbox'};
      const event={type:'created',projectId:identity.projectId,databaseId:identity.databaseId,
        chatId:o.conversationId,messageId:o.messageId,expectedCreateTime:o.messageCreateTime};
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
