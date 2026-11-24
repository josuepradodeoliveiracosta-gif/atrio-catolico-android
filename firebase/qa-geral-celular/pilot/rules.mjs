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

function dedicatedBase() {
  const base = source('../firestore.rules');
  if (createHash('sha256').update(base).digest('hex') !== dedicatedSha) {
    throw Error('Rules dedicadas divergiram da versão revisada para o piloto');
  }
  return base;
}

// Permissões de matches sobrepostos são avaliadas em OR pelo Firestore.
function withoutLegacyChatReads(base) {
  const withoutBox = replaceChecked(base, "        'chatBox', 'likedPosts', 'savedPosts', 'blockedMembers'",
    "        'likedPosts', 'savedPosts', 'blockedMembers'");
  return replaceChecked(withoutBox,
    '    match /chats/{chatId} {\n      allow get, list: if qaTester() && request.auth.uid in resource.data.participants;\n    }\n\n', '');
}

// Revisão candidata de encerramento, ensaiada separadamente da abertura.
// Conserva protocolos existentes, com a mesma autorização de leitura do piloto.
export function renderPilotShutdownRules() {
  const evidence = `    // Encerramento do piloto nao amplia acesso a evidencias por papel.
    function pilotEvidenceReadable() {
      return qaTester() && resource.data.reporterUid == request.auth.uid;
    }

    match /chat_reports/{reportId} {
      allow get: if pilotEvidenceReadable();
      allow list: if false;
    }

    match /chat_group_reports/{reportId} {
      allow get: if pilotEvidenceReadable();
      allow list: if false;
    }

`;
  return replaceChecked(withoutLegacyChatReads(dedicatedBase()), denyAll, evidence + denyAll);
}

export function renderClosedPilotRules() {
  let base = withoutLegacyChatReads(dedicatedBase());

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
  fragments = replaceChecked(fragments,
    'allow get: if chatEnabled() && chatMember(resource.data)\n        && chatNoBlock(resource.data.requesterUid, resource.data.recipientUid);',
    'allow get: if pilotDirectEnabled() && chatMember(resource.data)\n        && chatNoBlock(resource.data.requesterUid, resource.data.recipientUid);');
  // Compatibilidade EXCLUSIVA do antigo roteiro sintético Alice/Bob.
  // Nunca implantar: a Rules base nega a listagem global (#355).
  // Este ensaio especial ja revoga o par na propria pilotDirectEnabled().
  fragments = replaceChecked(fragments,
    'allow list: if false;\\n      allow create: if chatEnabled()\\n        && qaInboxLegacySourceWrites()'.replaceAll('\\n','\n'),
    ('allow list: if pilotDirectEnabled() && signedIn()\\n'
      + '        && qaInboxLegacySourceWrites()\\n'
      + '        && request.query.limit != null && request.query.limit <= 100\\n'
      + '        && request.auth.uid in resource.data.participants;\\n'
      + '      allow create: if chatEnabled()\\n        && qaInboxLegacySourceWrites()').replaceAll('\\n','\n'));
  fragments = replaceChecked(fragments, 'allow get, list: if chatEnabled()\n          && exists(/databases/$(database)/documents/chats/$(chatId))',
    'allow get, list: if pilotDirectEnabled()\n          && exists(/databases/$(database)/documents/chats/$(chatId))');
  const reportMatch = '    match /chat_reports/{reportId} {';
  const [beforeReports, fromReports, ...extra] = fragments.split(reportMatch);
  if (!fromReports || extra.length) throw Error('Regras de denúncia direta indisponíveis');
  fragments = beforeReports + reportMatch + replaceChecked(fromReports,
    'allow create: if chatEnabled()', 'allow create: if pilotDirectEnabled()');
  // O fragmento-base agora impõe bloqueio bilateral em convite e reconvite.
  // Falhar fechado se o contrato mudar antes de reutilizá-lo no piloto.
  if (fragments.split('&& chatNoBlock(request.auth.uid, inviteeUid)').length !== 3) {
    throw Error('Bloqueio bilateral ausente das regras de convites');
  }

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
        && qaInboxLegacySourceWrites()
        && request.resource.data.keys().hasOnly(['createdAt'])
        && request.resource.data.createdAt == request.time;
      allow delete: if qaOwner(uid) && qaMemberUid(peerUid) && uid != peerUid
        && qaInboxLegacySourceWrites();
    }

`;
  return replaceChecked(base, denyAll, adapters + fragments + denyAll);
}
