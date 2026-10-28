import {createHash} from 'node:crypto';

export const LIMITS = Object.freeze({
  lookbackHours: 4,
  queryLimit: 200,
  maxEvents: 120,
  maxAdmins: 30,
  maxTokensPerMember: 5,
  maxAttempts: 3,
  tokenMaxAgeDays: 60,
  leaseMinutes: 10,
});

export function safeTimestamp(value) {
  if (!value || typeof value.toMillis !== 'function') return 0;
  const millis = value.toMillis();
  return Number.isSafeInteger(millis) && millis > 0 ? millis : 0;
}

export function notificationRecipient(snapshot) {
  const ref = snapshot?.ref;
  if (!ref || ref.parent?.id !== 'notifications'
      || ref.parent.parent?.parent?.id !== 'users') return null;
  return ref.parent.parent.id;
}

export function replyEvent(snapshot) {
  const recipient = notificationRecipient(snapshot);
  const timestamp = safeTimestamp(snapshot.get('createdAt'));
  const actor = snapshot.get('actorUid');
  if (!recipient || !timestamp || snapshot.get('read') === true
      || typeof actor !== 'string' || actor === recipient) return null;
  return {
    key: 'reply:' + recipient + ':' + snapshot.id,
    kind: 'reply', recipient, timestamp,
    check: {collection: 'reply', ref: snapshot.ref},
  };
}

export function reviewEvent(snapshot) {
  const timestamp = safeTimestamp(snapshot.get('reviewedAt'));
  if (!timestamp || !['approved', 'rejected'].includes(snapshot.get('status'))
      || !['padre', 'diacono'].includes(snapshot.get('kind'))) return null;
  return {
    key: 'review:' + snapshot.id + ':' + timestamp,
    kind: 'review', recipient: snapshot.id, timestamp,
    check: {collection: 'review', ref: snapshot.ref, reviewedAt: timestamp},
  };
}

export function pendingAdminEvents(snapshot, kind, admins) {
  const timestamp = safeTimestamp(snapshot.get('createdAt'));
  if (!timestamp || kind !== 'request' && kind !== 'report') return [];
  if ((snapshot.get('status') ?? 'pending') !== 'pending') return [];
  const exclusion = kind === 'request' ? snapshot.id : snapshot.get('reporterUid');
  return admins.filter(uid => uid !== exclusion).map(recipient => ({
    key: 'admin:' + kind + ':' + snapshot.id + ':' + timestamp + ':' + recipient,
    kind: 'admin', recipient, timestamp,
    check: {collection: kind, ref: snapshot.ref, createdAt: timestamp},
  }));
}

export function eventMarkerId(event) {
  if (!event || typeof event.key !== 'string') throw Error('Missing event key');
  return createHash('sha256').update(event.key).digest('hex');
}

export function eligibleDevices(docs, now = Date.now(), opts = LIMITS) {
  const oldest = now - opts.tokenMaxAgeDays * 86400000;
  const unique = new Set();
  for (const snapshot of docs) {
    const token = snapshot.get('token');
    const timestamp = safeTimestamp(snapshot.get('updatedAt'));
    if (typeof token === 'string' && token.length >= 20 && token.length <= 4096
        && timestamp >= oldest && timestamp <= now + 60000) unique.add(token);
    if (unique.size >= opts.maxTokensPerMember) break;
  }
  return [...unique];
}

export function validateRecipient(uid) {
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 128
    && !uid.includes('/');
}
