import {randomUUID} from 'node:crypto';

import {conversationPushIdentity} from './conversation-push-identity.mjs';
export {conversationPushIdentity} from './conversation-push-identity.mjs';

// Usar em cada concessão administrativa, inclusive na readmissão da mesma rodada.
export function createConversationPushAdmission(uid, admittedAt, expiresAt) {
  const {accounts, roundId} = conversationPushIdentity;
  if (!Object.hasOwn(accounts, uid) || !(admittedAt instanceof Date) ||
      !(expiresAt instanceof Date) || !(admittedAt < expiresAt)) {
    throw new Error('Concessão de push QA inválida');
  }
  return {
    roundId,
    status: 'active',
    email: accounts[uid],
    generation: randomUUID(),
    admittedAt,
    expiresAt,
  };
}
