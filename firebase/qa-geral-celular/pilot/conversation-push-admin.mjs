// Serviço administrativo injetável. Não contém credenciais, deploy ou acesso cliente.
// Usar somente com Firestore Admin SDK (ou adaptador privilegiado no Emulator).
import {randomUUID} from 'node:crypto';
import {conversationPushIdentity} from './conversation-push-policy.mjs';

const operationId = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value))
    throw new Error('invalid_operation_id');
  return value;
};
const uidAllowed = (identity, uid) => {
  if (!Object.hasOwn(identity.accounts,uid)) throw new Error('uid_not_allowed');
};
const millis = value => value?.toMillis?.() ??
  (value instanceof Date ? value.getTime() : NaN);
const live = (record,identity,uid,at) =>
  record?.status === 'active' && record.roundId === identity.roundId &&
  record.email === identity.accounts[uid] &&
  typeof record.generation === 'string' &&
  Number.isFinite(millis(record.admittedAt)) &&
  millis(record.admittedAt) <= at &&
  millis(record.expiresAt) > at;

export function createConversationPushAdminService({
  db, serverTimestamp, identity=conversationPushIdentity,
  uuid=randomUUID, now=()=>Date.now(),
}) {
  if (!db?.runTransaction || typeof serverTimestamp !== 'function')
    throw new Error('admin_firestore_required');
  const admission = uid => db.doc('users/'+uid+'/chatPushAdmission/current');
  const operation = (uid,id) => db.doc('users/'+uid+'/chatPushAdminOperations/'+operationId(id));
  const pending = uid => db.doc('users/'+uid+'/chatPushPending/current');

  // Uma chave de operação corresponde a uma única intenção. Retentativas não
  // podem ressuscitar a geração antiga após revogação concorrente.
  async function change({uid,operationKey,action,expiresAt}) {
    uidAllowed(identity,uid);
    if (!['admit','revoke'].includes(action)) throw new Error('invalid_action');
    if (action==='admit' && (!(expiresAt instanceof Date) ||
      !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now()))
      throw new Error('invalid_expiry');
    const op=operation(uid,operationKey), ref=admission(uid);
    return db.runTransaction(async tx => {
      const [oldOp,oldAdmission]=await Promise.all([tx.get(op),tx.get(ref)]);
      if (oldOp.exists) {
        const previous=oldOp.data();
        if (previous.action!==action || previous.roundId!==identity.roundId)
          throw new Error('operation_key_reused');
        if (action==='admit' && millis(previous.expiresAt)!==expiresAt.getTime())
          throw new Error('operation_key_reused');
        return {generation:previous.generation, replay:true};
      }
      const previous=oldAdmission.exists ? oldAdmission.data() : null;
      if (action==='revoke') {
        const generation=previous?.generation ?? null;
        if (oldAdmission.exists) tx.update(ref,{status:'revoked'});
        tx.create(op,{action,roundId:identity.roundId,generation,createdAt:serverTimestamp()});
        return {generation,replay:false};
      }
      const generation=uuid();
      const record={
        roundId:identity.roundId,status:'active',email:identity.accounts[uid],
        generation,admittedAt:serverTimestamp(),expiresAt,
      };
      tx.set(ref,record);
      tx.create(op,{action,roundId:identity.roundId,generation,expiresAt,
        createdAt:serverTimestamp()});
      return {generation,replay:false};
    });
  }

  // Só publica a pendência para uma mensagem canônica POSTERIOR à última
  // readmissão das duas pontas. Uma reescrita de pendência antiga falha fechada.
  async function publish({senderUid,recipientUid,conversationId,messageId,expiresAt}) {
    uidAllowed(identity,senderUid); uidAllowed(identity,recipientUid);
    if (senderUid===recipientUid || !/^[A-Za-z0-9_-]{1,160}$/.test(conversationId) ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(messageId) ||
      !(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime()))
      throw new Error('invalid_notice');
    const from=admission(senderUid),to=admission(recipientUid);
    const room=db.doc('chats/'+conversationId);
    const message=db.doc('chats/'+conversationId+'/messages/'+messageId);
    return db.runTransaction(async tx=>{
      const [a,b,r,m]=await Promise.all([tx.get(from),tx.get(to),tx.get(room),tx.get(message)]);
      const time=now(), left=a.data(),right=b.data(),chat=r.data(),event=m.data();
      if (!a.exists || !b.exists || !r.exists || !m.exists ||
          !live(left,identity,senderUid,time) || !live(right,identity,recipientUid,time) ||
          expiresAt.getTime() <= time ||
          expiresAt.getTime() > Math.min(millis(left.expiresAt),millis(right.expiresAt)) ||
          event?.uid!==senderUid || event?.deletedForAll!==undefined ||
          !Number.isFinite(millis(event?.createdAt)) ||
          millis(event.createdAt)<=millis(left.admittedAt) ||
          millis(event.createdAt)<=millis(right.admittedAt) ||
          chat?.status!=='accepted' ||
          chat?.lastMessageId!==messageId || chat?.lastSenderUid!==senderUid ||
          !Array.isArray(chat.participants) ||
          chat.participants.length!==2 ||
          !chat.participants.includes(senderUid) || !chat.participants.includes(recipientUid))
        throw new Error('notice_not_authorized');
      const record={
        kind:'chat_message',conversationId,messageId,senderUid,unread:true,
        roundId:identity.roundId,expiresAt,
        senderGeneration:left.generation,recipientGeneration:right.generation,
      };
      tx.set(pending(recipientUid),record);
      return {senderGeneration:left.generation,recipientGeneration:right.generation};
    });
  }
  return {
    admit: ({uid,operationKey,expiresAt})=>change({uid,operationKey,action:'admit',expiresAt}),
    revoke: ({uid,operationKey})=>change({uid,operationKey,action:'revoke'}),
    publish,
  };
}
