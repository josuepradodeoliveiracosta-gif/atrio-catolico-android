// Pure decision contract. No network, SDK, credentials, or privileged operations.
// Only an authenticated server adapter may supply the normalized snapshot.
// This is NOT an authorization endpoint or a replacement for Worker rechecks.
import {conversationPushIdentity as identity} from './conversation-push-identity.mjs';

export const AUTO_CHAT = 'qa-nav-alice__qa-nav-bob';
const MAX_NOTICE_MS = 120_000;
const MIN_WINDOW_MS = 10_000;
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const generation = v => typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const time = v => Number.isSafeInteger(v) && v > 0;
const deadline = v => v === null ? Infinity : time(v) ? v : NaN;
const refuse = reason => ({status:'ignored',reason});
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Snapshot adapter contract: read all documents from the server, never from
// event payload/cache. Convert timestamps to integer milliseconds, rejecting
// missing metadata. Same-millisecond proof/admission ordering fails closed.
export function planAutomaticNotice({enabled=false,event,snapshot,now}={}) {
  if (enabled !== true) return refuse('automation_disabled');
  if (!time(now) || !record(event) || event.type !== 'created' ||
      event.projectId !== identity.projectId || event.databaseId !== identity.databaseId ||
      event.chatId !== AUTO_CHAT || !id(event.messageId))
    return refuse('invalid_event');
  if (!record(snapshot) || snapshot.projectId !== identity.projectId ||
      snapshot.databaseId !== identity.databaseId || snapshot.chatId !== event.chatId ||
      snapshot.messageId !== event.messageId || snapshot.managedBoundary !== false)
    return refuse('invalid_snapshot');
  const {config,room,message,accounts,admissions,eligibility,blocked,muted,deviceEligible,receipt,pending}=snapshot;
  const round=config?.pushPilot;
  if (config?.enabled !== true || config?.qaSimpleDirectEnabled !== true ||
      config?.minorPolicyApproved !== true || config?.version !== '2026-11-v1' ||
      config?.safetyReviewVersion !== '2026-11-safety-v1' ||
      round?.enabled !== true || round?.projectId !== identity.projectId ||
      round?.databaseId !== identity.databaseId || round?.roundId !== identity.roundId ||
      round?.ageMode !== identity.ageMode || !(deadline(round?.expiresAt)>now))
    return refuse('policy_closed');
  if (!record(message) || !Object.hasOwn(identity.accounts,message.uid) ||
      !['text','post'].includes(message.kind) || Object.hasOwn(message,'deletedForAll') ||
      !time(message.createdAt) || message.createdAt>now ||
      message.createdAt+MAX_NOTICE_MS<=now)
    return refuse('invalid_or_expired_message');
  const sender=message.uid, recipient=Object.keys(identity.accounts).find(uid=>uid!==sender);
  const pair=room?.participants;
  const senderRequester=room?.requesterUid===sender && room?.recipientUid===recipient;
  const recipientRequester=room?.requesterUid===recipient && room?.recipientUid===sender;
  const unread=senderRequester ? room?.unreadRecipient : room?.unreadRequester;
  if (room?.status!=='accepted' || room.lastMessageId!==event.messageId ||
      room.lastSenderUid!==sender || !Array.isArray(pair) || pair.length!==2 ||
      !pair.includes(sender) || !pair.includes(recipient) || !(senderRequester||recipientRequester) ||
      !Number.isSafeInteger(unread) || unread<=0)
    return refuse('not_latest_unread_message');
  if (blocked?.[sender]!==false || blocked?.[recipient]!==false ||
      muted!==false || deviceEligible!==true) return refuse('recipient_unavailable');
  let expiry=Math.min(message.createdAt+MAX_NOTICE_MS,deadline(round.expiresAt));
  for (const uid of [sender,recipient]) {
    const a=accounts?.[uid], grant=admissions?.[uid], proof=eligibility?.[uid];
    if (a?.uid!==uid || a.email!==identity.accounts[uid] || a.emailVerified!==true ||
        a.disabled!==false || grant?.status!=='active' ||
        grant.email!==identity.accounts[uid] || grant.roundId!==identity.roundId ||
        !generation(grant.generation) || !time(grant.admittedAt) ||
        grant.admittedAt>=message.createdAt || !(deadline(grant.expiresAt)>now) ||
        proof?.status!=='eligible' || proof.minimumAge!==18 ||
        proof.policyVersion!=='2026-11-18plus-qa-v1' || !time(proof.updatedAt) ||
        proof.updatedAt>=grant.admittedAt || !time(proof.reviewExpiresAt) ||
        proof.reviewExpiresAt<=now)
      return refuse('admission_or_age_invalid');
    expiry=Math.min(expiry,deadline(grant.expiresAt),proof.reviewExpiresAt);
  }
  if (!Number.isSafeInteger(expiry) || expiry-now<MIN_WINDOW_MS)
    return refuse('notice_window_too_short');
  // A receipt is never a reason to recreate a pending notice. Future outbox
  // reconciliation must distinguish confirmed delivery from unknown outcomes.
  if (receipt!==null) return refuse('receipt_exists_or_unknown');
  if (pending!==null) {
    if (!record(pending) || typeof pending.unread!=='boolean' || !time(pending.expiresAt))
      return refuse('invalid_pending');
    if (pending.unread && pending.expiresAt>now) {
      // Preserve the APK 46 publication contract: no overwriting active notices.
      // An eventual retry must re-read canonical state and original expiry.
      return {status:'defer',reason:'active_pending',retryBefore:expiry};
    }
  }
  return {status:'candidate',notice:{
    senderUid:sender,recipientUid:recipient,conversationId:event.chatId,messageId:event.messageId,
    expiresAt:new Date(expiry),
    expectedSenderGeneration:admissions[sender].generation,
    expectedRecipientGeneration:admissions[recipient].generation,
  }};
}
