// Rules compostas em memória para o Firestore Emulator. Sem destino de deploy.
import {renderClosedPilotRules} from './rules.mjs';

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw Error('qa_push_rules_anchor_changed');
  return source.replace(anchor, () => replacement);
}

// Auth atual de ambas as contas só pode ser verificado pelo Worker candidato.
const pushRules = `
    match /users/{uid}/chatPushPending/{noticeId} {
      allow read, write: if false;
    }

    match /users/{uid}/chatPushAdmission/{admissionId} {
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
