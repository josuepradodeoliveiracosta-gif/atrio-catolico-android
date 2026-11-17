// Composição em memória para o Firestore Emulator. Nenhum firebase.json usa este módulo.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {renderParity} from '../../qa-general/compose-parity-rules.mjs';

const dedicatedSha = '1730b34761b2a7d1c159845cee5e4ff6e2f2428935baf6aa36436ecfaf67b462';
const denyAll = '    match /{document=**} {\n      allow read, write: if false;\n    }';
const begin = '    // BEGIN QA PARITY ADDITIVE: SOMENTE FIREBASE EMULATOR, SEM DEPLOY\n';
const end = '    // END QA PARITY ADDITIVE: politicas ainda pendentes (#200)';

function replaceChecked(source, expected, replacement, count = 1) {
  const pieces = source.split(expected);
  if (pieces.length !== count + 1) throw Error('Estrutura das regras do piloto mudou');
  return pieces.join(replacement);
}

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

export function renderClosedPilotRules() {
  let base = source('../firestore.rules');
  if (createHash('sha256').update(base).digest('hex') !== dedicatedSha) {
    throw Error('Rules dedicadas divergiram da versão revisada para o piloto');
  }

  const parity = renderParity(source('../../../firestore.rules'),
    source('../../atrio-conversas-v1.rules.fragment'), source('../../atrio-grupos-v1.rules.fragment'));
  const sections = parity.split(begin);
  if (sections.length !== 2 || sections[1].split(end).length !== 2) {
    throw Error('Fragmentos de paridade indisponíveis');
  }
  let fragments = sections[1].split(end)[0];
  fragments = replaceChecked(fragments,
    "return proof.keys().hasAll(['status','minimumAge','policyVersion','reviewExpiresAt'])",
    "return qaMemberUid(uid) && proof.keys().hasAll(['status','minimumAge','policyVersion','reviewExpiresAt'])");
  fragments = replaceChecked(fragments, 'allow get: if chatEnabled() && chatMember(resource.data);',
    'allow get: if pilotDirectEnabled() && chatMember(resource.data);');
  fragments = replaceChecked(fragments, 'allow list: if chatEnabled() && signedIn()',
    'allow list: if pilotDirectEnabled() && signedIn()');
  fragments = replaceChecked(fragments, 'allow get, list: if chatEnabled()\n          && exists(/databases/$(database)/documents/chats/$(chatId))',
    'allow get, list: if pilotDirectEnabled()\n          && exists(/databases/$(database)/documents/chats/$(chatId))');
  const reportMatch = '    match /chat_reports/{reportId} {';
  const [beforeReports, fromReports, ...extra] = fragments.split(reportMatch);
  if (!fromReports || extra.length) throw Error('Regras de denúncia direta indisponíveis');
  fragments = beforeReports + reportMatch + replaceChecked(fromReports,
    'allow create: if chatEnabled()', 'allow create: if pilotDirectEnabled()');
  // Nos convites do piloto, aplicar bloqueio bilateral já na emissão e no reconvite.
  fragments = replaceChecked(fragments,
    '!exists(/databases/$(database)/documents/users/$(inviteeUid)/blockedMembers/$(request.auth.uid))',
    'chatNoBlock(request.auth.uid, inviteeUid)', 2);
  fragments = replaceChecked(fragments,
    '          // O destinatário nunca recebe convite de quem bloqueou.\n'
    + '          // O bloqueio inverso é revalidado no ACEITE, para economizar\n'
    + '          // leituras de regras na simples criação de convite.\n', '');

  // A permissão de leitura da caixa legada e os matches sobrepostos seriam
  // avaliados em OR pelo Firestore. Removê-los só da composição local.
  base = replaceChecked(base, "        'chatBox', 'likedPosts', 'savedPosts', 'blockedMembers'",
    "        'likedPosts', 'savedPosts', 'blockedMembers'");
  base = replaceChecked(base,
    '    match /chats/{chatId} {\n      allow get, list: if qaTester() && request.auth.uid in resource.data.participants;\n    }\n\n', '');
  for (const path of ['chatAgeEligibility/current', 'chatSettings/privacy']) {
    base = replaceChecked(base,
      `    match /users/{uid}/${path} {\n      allow get: if qaOwner(uid);\n    }\n\n`, '');
  }

  const adapters = `
    function signedIn() { return qaTester(); }
    function me(uid) { return qaOwner(uid); }
    function isAdmin() { return qaModerator(); }
    function emailVerificationAllowsCommunityAccess() { return qaTester(); }

    function pilotDirectEnabled() {
      return chatEnabled() && chatNoBlock('qa-nav-alice', 'qa-nav-bob');
    }

    match /users/{uid}/blockedMembers/{peerUid} {
      allow create: if chatEnabled() && qaOwner(uid) && qaMemberUid(peerUid) && uid != peerUid
        && request.resource.data.keys().hasOnly(['createdAt'])
        && request.resource.data.createdAt == request.time;
      allow delete: if qaOwner(uid) && qaMemberUid(peerUid) && uid != peerUid;
    }

`;
  return replaceChecked(base, denyAll, adapters + fragments + denyAll);
}
