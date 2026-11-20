// Rules compostas em memória para o Firestore Emulator. Sem destino de deploy.
import {renderClosedPilotRules} from './rules.mjs';
import {conversationPushIdentity as identity} from './conversation-push-policy.mjs';

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw Error('qa_push_rules_anchor_changed');
  return source.replace(anchor, () => replacement);
}

const emailByUid = Object.entries(identity.accounts)
  .map(([uid, email]) => `uid == '${uid}' ? '${email}' : `).join('');
const pushRules = `
    function qaPushEmail(uid) {
      return ${emailByUid}'';
    }

    function qaPushAdmission(uid, roundId) {
      let admission = get(/databases/$(database)/documents/users/$(uid)/chatPushAdmission/current).data;
      return qaPushEmail(uid) != '' && admission.email == qaPushEmail(uid)
        && admission.roundId == roundId && admission.status == 'active'
        && admission.expiresAt is timestamp && admission.expiresAt > request.time
        && qaChatAge18Eligible(uid);
    }

    function qaPushRound(roundId) {
      let pilot = get(/databases/$(database)/documents/app_config/conversations).data.pushPilot;
      return database == '${identity.databaseId}' && chatEnabled()
        && pilot.enabled == true && pilot.projectId == '${identity.projectId}'
        && pilot.databaseId == database && pilot.ageMode == '${identity.ageMode}'
        && pilot.roundId == '${identity.roundId}' && pilot.roundId == roundId
        && pilot.expiresAt is timestamp && pilot.expiresAt > request.time;
    }

    function qaPushId(id) {
      return id is string && id.matches('^[A-Za-z0-9_-]{1,128}$');
    }

    function qaPushPendingMessage(uid, pending) {
      let room = get(/databases/$(database)/documents/chats/$(pending.conversationId)).data;
      let message = get(/databases/$(database)/documents/chats/$(pending.conversationId)/messages/$(pending.messageId)).data;
      let mute = /databases/$(database)/documents/users/$(uid)/chatBox/$(pending.conversationId);
      return room.status == 'accepted' && room.lastMessageId == pending.messageId
        && room.lastSenderUid == pending.senderUid
        && room.participants.size() == 2
        && room.participants.hasAll([uid, pending.senderUid])
        && ((room.requesterUid == uid && room.recipientUid == pending.senderUid
              && room.unreadRequester is int && room.unreadRequester > 0)
          || (room.recipientUid == uid && room.requesterUid == pending.senderUid
              && room.unreadRecipient is int && room.unreadRecipient > 0))
        && message.uid == pending.senderUid && message.kind in ['text', 'post']
        && !message.keys().hasAny(['deletedForAll'])
        && message.createdAt is timestamp
        && message.createdAt > request.time - duration.value(5, 'm')
        && message.createdAt < request.time + duration.value(1, 'm')
        && (!exists(mute) || get(mute).data.get('muted', false) == false);
    }

    match /users/{uid}/chatPushPending/current {
      allow get: if qaOwner(uid)
        && resource.data.keys().hasOnly(['kind','conversationId','messageId','senderUid',
          'unread','roundId','expiresAt'])
        && resource.data.kind == 'chat_message'
        && resource.data.unread == true && resource.data.senderUid != uid
        && qaPushId(resource.data.conversationId) && qaPushId(resource.data.messageId)
        && resource.data.expiresAt is timestamp && resource.data.expiresAt > request.time
        && qaPushRound(resource.data.roundId)
        && qaPushAdmission(uid, resource.data.roundId)
        && qaPushAdmission(resource.data.senderUid, resource.data.roundId)
        && chatNoBlock(uid, resource.data.senderUid)
        && qaPushPendingMessage(uid, resource.data);
      allow list, create, update, delete: if false;
    }

    match /users/{uid}/chatPushAdmission/current {
      allow read, write: if false;
    }

`;

export function renderConversationPushPilotRules() {
  let rules = renderClosedPilotRules();
  const legacyList = `allow list: if pilotDirectEnabled() && signedIn()
              && qaInboxLegacySourceWrites()
              && request.query.limit != null && request.query.limit <= 100
              && request.auth.uid in resource.data.participants;`;
  // Restaura a fronteira #355 que o compositor histórico flexibiliza no piloto antigo.
  rules = replaceOnce(rules, legacyList.split('\n').map((line, index) =>
    index === 0 ? line : '        ' + line.trim()).join('\n'), 'allow list: if false;');
  rules = replaceOnce(rules, "&& proof.get('minimumAge',0) == 18",
    "&& proof.get('minimumAge',0) is int\n        && proof.get('minimumAge',0) == 18");
  const deny = '    match /{document=**} {';
  return replaceOnce(rules, deny, pushRules + deny);
}
