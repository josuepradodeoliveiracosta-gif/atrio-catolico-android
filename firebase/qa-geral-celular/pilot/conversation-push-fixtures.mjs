// Apenas fixtures da prova offline. Nenhum inicializador de produção importa este módulo.
import {alice, bob, pilotDocuments, pilotFlags} from './fixtures.mjs';
import {conversationPushIdentity, createConversationPushAdmission} from './conversation-push-policy.mjs';

export const conversationPushPilot = Object.freeze({
  ...conversationPushIdentity,
  conversationId: alice.uid + '__' + bob.uid,
  messageId: 'qa-199-mensagem',
  senderUid: alice.uid,
  recipientUid: bob.uid,
});

export function conversationPushPilotDocuments(now = new Date()) {
  const pilot = conversationPushPilot;
  const deadline = new Date(now.getTime() + 4 * 60_000);
  const room = 'chats/' + pilot.conversationId;
  const rows = new Map([...pilotDocuments(now), ...pilotFlags(true)]);
  rows.set('app_config/conversations', {
    ...rows.get('app_config/conversations'),
    pushPilot: {
      enabled: true,
      projectId: pilot.projectId,
      databaseId: pilot.databaseId,
      roundId: pilot.roundId,
      ageMode: pilot.ageMode,
      expiresAt: deadline,
    },
  });
  rows.set(room, {
    participants: [alice.uid, bob.uid], requesterUid: alice.uid, recipientUid: bob.uid,
    status: 'accepted', initialId: pilot.messageId, lastMessageId: pilot.messageId,
    lastSenderUid: alice.uid, unreadRequester: 0, unreadRecipient: 1,
    lastPreview: 'Mensagem fictícia do teste 08–09',
    createdAt: now, updatedAt: now,
  });
  rows.set(room + '/messages/' + pilot.messageId, {
    uid: alice.uid, kind: 'text', text: 'Mensagem fictícia do teste 08–09', createdAt: now,
  });
  const admittedAt = new Date(now.getTime() - 60_000);
  const from = createConversationPushAdmission(alice.uid, admittedAt, deadline);
  const to = createConversationPushAdmission(bob.uid, admittedAt, deadline);
  rows.set('users/' + alice.uid + '/chatPushAdmission/current', from);
  rows.set('users/' + bob.uid + '/chatPushAdmission/current', to);
  rows.set('users/' + bob.uid + '/chatPushPending/current', {
    kind: 'chat_message', conversationId: pilot.conversationId,
    messageId: pilot.messageId, senderUid: alice.uid, unread: true,
    roundId: pilot.roundId, expiresAt: deadline,
    senderGeneration: from.generation, recipientGeneration: to.generation,
  });
  return [...rows];
}
