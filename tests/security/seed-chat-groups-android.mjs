import {readFileSync} from 'node:fs';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,serverTimestamp,Timestamp} from 'firebase/firestore';

const project = 'demo-atrio-v11';
const auth = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const navigationFixtures = process.argv.includes('--navegacao-perfis');
const reverseRequest = process.argv.includes('--pedido-inverso');
if (navigationFixtures && reverseRequest) throw new Error('Use uma única fixture por execução.');
const rules = readFileSync('qa-parity.generated.rules', 'utf8');
if (!rules.includes('BEGIN QA PARITY ADDITIVE')) {
  throw new Error('As regras compostas são obrigatórias.');
}

async function authRequest(path, body, headers = {}) {
  const response = await fetch(auth + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Auth Emulator recusou a fixture: HTTP ' + response.status);
  return response.json();
}

const accounts = reverseRequest ? [
  {email: 'pedido.inverso.miguel@qa.invalid', name: 'Miguel QA', requests: 'all'},
  {email: 'pedido.inverso.clara@qa.invalid', name: 'Clara QA', requests: 'all'},
  {email: 'pedido.inverso.lucia@qa.invalid', name: 'Lúcia QA', requests: 'all'}
] : [
  {email: 'conversas.alice@qa.invalid', name: 'Alice QA', requests: 'none'},
  {email: 'conversas.bob@qa.invalid', name: 'Bob QA', requests: 'all'},
  ...(navigationFixtures ? [{email: 'conversas.lucia@qa.invalid', name: 'Lúcia QA', requests: 'all'}] : [])
];
for (const account of accounts) {
  const {localId} = await authRequest('/accounts:signUp?key=local-emulator-test', {
    email: account.email, password: 'GrupoQa2026!Emulador', returnSecureToken: false
  });
  const verified = await authRequest('/projects/' + project + '/accounts:update',
    {localId, emailVerified: true}, {Authorization: 'Bearer owner'});
  if (verified.localId !== localId || verified.emailVerified !== true) {
    throw new Error('Auth Emulator não confirmou o e-mail da fixture.');
  }
  account.uid = localId;
}

const env = await initializeTestEnvironment({
  projectId: project, firestore: {host: '127.0.0.1', port: 8089, rules}
});
try {
  const expiration = Timestamp.fromMillis(Date.now() + 86_400_000);
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'app_config/conversations'), {
      enabled: true, version: '2026-11-v1', minorPolicyApproved: true,
      safetyReviewVersion: '2026-11-safety-v1'
    });
    await setDoc(doc(db, 'app_config/chat_groups'), {
      enabled: true, version: '2026-11-groups-v1', minorPolicyApproved: true
    });
    for (const {uid, name, requests} of accounts) {
      await setDoc(doc(db, 'users', uid, 'chatAgeEligibility', 'current'), {
        status: 'eligible', minimumAge: 18, policyVersion: '2026-11-18plus-qa-v1',
        reviewExpiresAt: expiration
      });
      await setDoc(doc(db, 'users', uid, 'chatGroupAccess', 'eligibility'), {
        status: 'approved', policyVersion: '2026-11-group-safety-v1',
        reviewExpiresAt: expiration
      });
      await setDoc(doc(db, 'public_profiles', uid), {
        uid, displayName: name, createdAt: serverTimestamp(),
        ...(navigationFixtures && name === 'Bob QA'
          ? {bio: 'Apresentação fictícia da navegação QA.'} : {})
      });
      if (navigationFixtures) {
        await setDoc(doc(db, 'profiles', uid), {displayName: name, createdAt: serverTimestamp()});
      }
      await setDoc(doc(db, 'users', uid, 'chatSettings', 'privacy'), {
        requests, readReceipts: false, showPushPreview: false, updatedAt: serverTimestamp()
      });
    }
    if (navigationFixtures) {
      const bob = accounts[1];
      await setDoc(doc(db, 'posts', 'qa-nav-bob-profile'), {
        uid: bob.uid, authorName: bob.name,
        title: 'Discussão fictícia para navegação QA',
        body: 'Publicação sintética para abrir o perfil público no emulador.',
        category: 'Vida espiritual', createdAt: serverTimestamp()
      });
      // Conversa privada de controle entre Alice e Lúcia. Bob existe, mas
      // não participa: depois da troca de conta não pode ver nem consultar.
      const alice = accounts[0], lucia = accounts[2];
      const id = [alice.uid, lucia.uid].sort().join('__');
      const privateText = 'Mensagem privada de Alice para Lúcia, somente no emulador.';
      await setDoc(doc(db, 'chats', id), {
        participants: [alice.uid, lucia.uid],
        requesterUid: alice.uid, recipientUid: lucia.uid,
        status: 'accepted', initialId: 'qa-privacidade',
        lastMessageId: 'qa-privacidade', lastPreview: privateText,
        lastSenderUid: alice.uid, createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(), unreadRequester: 0, unreadRecipient: 1
      });
      await setDoc(doc(db, 'chats', id, 'messages', 'qa-privacidade'), {
        uid: alice.uid, text: privateText, kind: 'text',
        createdAt: serverTimestamp()
      });
      // Só nesta fixture com Rules desativadas no Emulator; os clientes
      // permanecem proibidos de materializar índices de outros usuários.
      for (const [owner, peer] of [[alice, lucia], [lucia, alice]]) {
        await setDoc(doc(db, 'users', owner.uid, 'chatInboxByPeer', peer.uid,
          'entries', id), {
          ownerUid: owner.uid, peerUid: peer.uid, chatId: id,
          status: 'accepted', lastPreview: privateText,
          updatedAt: serverTimestamp()
        });
      }
      await setDoc(doc(db, 'posts', 'qa-nav-lucia-profile'), {
        uid: lucia.uid, authorName: lucia.name,
        title: 'Publicação fictícia de Lúcia para teste de conversas',
        body: 'Perfil sintético de Lúcia para verificar troca de conta.',
        category: 'Vida espiritual', createdAt: serverTimestamp()
      });
    }
  });
  console.log('Conversas QA: regras compostas e ' + accounts.length + ' contas fictícias verificadas no emulador local.');
} finally {
  await env.cleanup();
}
