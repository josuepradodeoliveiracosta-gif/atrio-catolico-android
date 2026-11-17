import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {after, before, test} from 'node:test';
import {assertFails, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where, writeBatch} from 'firebase/firestore';
import {accounts, documents} from '../../firebase/qa-geral-celular/fixtures.mjs';

const projectId = 'demo-atrio-v11';
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: '127.0.0.1', port: 8089,
    rules: readFileSync(new URL('../../firebase/qa-geral-celular/firestore.rules', import.meta.url), 'utf8')
  }
});
const [alice, bob] = accounts;
const postPath = 'posts/qa-nav-bob-profile';
const configPath = 'app_config/conversations';

function session(account, overrides = {}) {
  return env.authenticatedContext(account.uid, {
    email: account.email, email_verified: true, ...overrides
  }).firestore();
}
const a = session(alice);
const b = session(bob);
const outsider = env.authenticatedContext('estranho', {
  email: alice.email, email_verified: true, admin: true
}).firestore();
const withoutLogin = env.unauthenticatedContext().firestore();
const invalidSessions = [outsider, withoutLogin, session(alice, {email_verified: false}),
  session(alice, {email: bob.email})];

function publication(author) {
  return {
    uid: author.uid, authorName: author.name, title: 'Discussão fictícia do QA',
    body: 'Texto fictício da publicação.', category: 'Vida espiritual', createdAt: serverTimestamp()
  };
}

function reply(author) {
  return {uid: author.uid, authorName: author.name, body: 'Resposta fictícia.', createdAt: serverTimestamp()};
}

function notice(author, postId, replyId) {
  return {
    postId, replyId, actorUid: author.uid, actorName: author.name,
    read: false, createdAt: serverTimestamp()
  };
}

function replyWithNotice(db, author, postId, replyId, recipientUid, overrides = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'posts', postId, 'replies', replyId), reply(author));
  batch.set(doc(db, 'users', recipientUid, 'notifications', replyId), {
    ...notice(author, postId, replyId), ...overrides
  });
  return batch.commit();
}

before(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all(documents(new Date('2026-11-16T10:00:00Z'))
      .map(([path, fields]) => setDoc(doc(db, path), fields)));
  });
});
after(() => env.cleanup());

test('as contas de QA leem apenas o próprio perfil privado', async () => {
  assert.equal((await getDoc(doc(a, 'profiles/' + alice.uid))).get('displayName'), 'Alice QA');
  assert.equal((await getDoc(doc(b, 'profiles/' + bob.uid))).get('displayName'), 'Bob QA');
  await assertFails(getDoc(doc(a, 'profiles/' + bob.uid)));
  await assertFails(getDocs(collection(a, 'profiles')));
});

test('Alice encontra a publicação e reconhece Bob no perfil público', async () => {
  const feed = await getDocs(query(collection(a, 'posts'), orderBy('createdAt', 'desc'), limit(21)));
  assert.deepEqual(feed.docs.map(item => item.id), ['qa-nav-bob-profile']);
  const owner = feed.docs[0].get('uid');
  const profile = await getDoc(doc(a, 'public_profiles/' + owner));
  assert.equal(profile.get('displayName'), 'Bob QA');
  const posts = await getDocs(query(collection(a, 'posts'), where('uid', '==', owner),
    orderBy('createdAt', 'desc'), limit(20)));
  assert.deepEqual(posts.docs.map(item => item.id), ['qa-nav-bob-profile']);
});

test('as flags de Conversas estão desligadas no roteiro de preparação', async () => {
  const config = await getDoc(doc(a, configPath));
  assert.equal(config.get('enabled'), false);
  assert.equal(config.get('minorPolicyApproved'), false);
  await assertFails(updateDoc(doc(a, configPath), {enabled: true, minorPolicyApproved: true}));
});

test('Alice pode consultar a inbox de que participa, que começa vazia', async () => {
  const mine = await getDocs(query(collection(a, 'chats'),
    where('participants', 'array-contains', alice.uid), limit(100)));
  assert.equal(mine.empty, true);
  await assertFails(getDocs(query(collection(a, 'chats'),
    where('participants', 'array-contains', bob.uid), limit(100))));
  await assertFails(getDocs(collection(a, 'chats')));
});

test('somente os dois UIDs verificados e e-mails correspondentes leem as fixtures', async () => {
  for (const db of invalidSessions) {
    await assertFails(getDoc(doc(db, postPath)));
    await assertFails(getDoc(doc(db, configPath)));
  }
});

test('clientes não podem abrir Conversas e Grupos ou mudar regras de acesso', async () => {
  const chatId = alice.uid + '__' + bob.uid;
  await assertFails(setDoc(doc(a, 'chats/' + chatId), {participants: [alice.uid, bob.uid]}));
  await assertFails(setDoc(doc(a, 'chats/' + chatId + '/messages/1'), {text: 'teste'}));
  await assertFails(setDoc(doc(a, 'app_config/chat_groups'), {enabled: true}));
  await assertFails(getDoc(doc(a, 'app_config/chat_groups')));
  await assertFails(setDoc(doc(a, 'chat_groups/1'), {participants: [alice.uid]}));
  await assertFails(updateDoc(doc(a, postPath), {likes: arrayUnion(alice.uid)}));
  await assertFails(deleteDoc(doc(a, 'profiles/' + alice.uid)));
  await assertFails(setDoc(doc(a, 'admins/' + alice.uid), {enabled: true}));
  await assertFails(getDoc(doc(a, 'chat_groups/1')));
});

test('Bob publica e edita a própria discussão, que Alice encontra no fórum', async () => {
  const path = 'posts/qa-forum-bob';
  const own = doc(b, path);
  const newTitle = 'Título revisado no ensaio de QA';
  await setDoc(own, publication(bob));
  await updateDoc(own, {title: newTitle, updatedAt: serverTimestamp()});
  assert.equal((await getDoc(doc(a, path))).get('title'), newTitle);
  await assertFails(updateDoc(doc(a, path), {title: 'Edição alheia', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(own, {category: 'Santos', updatedAt: serverTimestamp()}));
  await assertFails(updateDoc(own, {title: 'Edição sem horário'}));
  await assertFails(deleteDoc(doc(a, path)));
  await deleteDoc(own);
  assert.equal((await getDoc(own)).exists(), false);
});

test('publicação exige conta autorizada, autoria, formato e horário do servidor', async () => {
  const path = 'posts/qa-forum-denied';
  for (const db of invalidSessions) {
    await assertFails(setDoc(doc(db, path), publication(alice)));
  }
  for (const fields of [{uid: bob.uid}, {authorName: bob.name}, {category: 'Outra categoria'},
    {title: 'a'}, {body: 'x'.repeat(1201)}, {createdAt: new Date(0)}, {extra: true}]) {
    await assertFails(setDoc(doc(a, path), {...publication(alice), ...fields}));
  }
  assert.equal((await getDoc(doc(a, path))).exists(), false);
});

test('a política comunitária ativa exige aceite antes de publicar ou responder', async () => {
  const rulesConfig = 'app_config/community_rules';
  const postId = 'qa-nav-bob-profile';
  const consent = 'community_consents/' + alice.uid;
  const publicationRef = doc(a, 'posts/qa-forum-consent');
  await env.withSecurityRulesDisabled(context =>
    setDoc(doc(context.firestore(), rulesConfig), {enabled: true, version: '2026-11-v1'}));
  try {
    await assertFails(setDoc(publicationRef, publication(alice)));
    await assertFails(replyWithNotice(a, alice, postId, 'qa-consent-denied', bob.uid));
    await env.withSecurityRulesDisabled(context =>
      setDoc(doc(context.firestore(), consent), {version: '2026-11-v1'}));
    await setDoc(publicationRef, publication(alice));
    await replyWithNotice(a, alice, postId, 'qa-consent-allowed', bob.uid);
  } finally {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const batch = writeBatch(db);
      batch.set(doc(db, rulesConfig), {enabled: false});
      batch.delete(doc(db, consent));
      batch.delete(doc(db, 'users', bob.uid, 'notifications', 'qa-consent-allowed'));
      batch.delete(doc(db, 'posts', postId, 'replies', 'qa-consent-allowed'));
      batch.delete(doc(db, publicationRef.path));
      await batch.commit();
    });
  }
});

test('resposta de Alice confirma o aviso de Bob no mesmo lote, com leitura privada', async () => {
  const postId = 'qa-nav-bob-profile';
  const replyId = 'qa-reply-atomic';
  const replyPath = `${postPath}/replies/${replyId}`;
  const inboxPath = 'users/' + bob.uid + '/notifications';
  const noticePath = inboxPath + '/' + replyId;
  await replyWithNotice(a, alice, postId, replyId, bob.uid);
  const savedReply = await getDoc(doc(b, replyPath));
  const savedNotice = await getDoc(doc(b, noticePath));
  assert.equal(savedReply.get('uid'), alice.uid);
  assert.equal(savedNotice.get('actorUid'), alice.uid);
  assert.equal(savedNotice.get('replyId'), savedReply.id);
  assert.equal(savedNotice.get('read'), false);
  assert.ok(savedNotice.get('createdAt').isEqual(savedReply.get('createdAt')));
  const ownInbox = await getDocs(query(collection(b, inboxPath), orderBy('createdAt', 'desc'), limit(21)));
  assert.ok(ownInbox.docs.some(item => item.id === replyId));
  const replies = await getDocs(query(collection(b, postPath, 'replies'), orderBy('createdAt')));
  assert.ok(replies.docs.some(item => item.id === replyId));
  await assertFails(getDoc(doc(a, noticePath)));
  await assertFails(getDocs(collection(a, inboxPath)));
  await assertFails(getDoc(doc(outsider, noticePath)));
  await assertFails(updateDoc(doc(a, noticePath), {read: true}));
  await assertFails(deleteDoc(doc(a, noticePath)));
  await assertFails(updateDoc(doc(b, noticePath), {read: true, actorName: bob.name}));
  await updateDoc(doc(b, noticePath), {read: true});
  assert.equal((await getDoc(doc(b, noticePath))).get('read'), true);
  await assertFails(updateDoc(doc(b, noticePath), {read: false}));
  await deleteDoc(doc(b, noticePath));
  assert.equal((await getDoc(doc(b, noticePath))).exists(), false);
  assert.equal((await getDoc(doc(b, replyPath))).exists(), true);
  await assertFails(setDoc(doc(a, noticePath), notice(alice, postId, replyId)));
});

test('Bob responde à publicação de Alice e o aviso fica na caixa dela', async () => {
  const postId = 'qa-thread-alice';
  const replyId = 'qa-reply-from-bob';
  const noticePath = 'users/' + alice.uid + '/notifications/' + replyId;
  await setDoc(doc(a, 'posts', postId), publication(alice));
  await replyWithNotice(b, bob, postId, replyId, alice.uid);
  assert.equal((await getDoc(doc(a, noticePath))).get('actorUid'), bob.uid);
  await assertFails(getDoc(doc(b, noticePath)));
});

test('a Central consulta revisão de selo somente pelo ID do próprio titular', async () => {
  const alicePath = 'badge_requests/' + alice.uid;
  const bobPath = 'badge_requests/' + bob.uid;
  await env.withSecurityRulesDisabled(context =>
    setDoc(doc(context.firestore(), bobPath), {status: 'approved', kind: 'lay'}));
  assert.equal((await getDoc(doc(a, alicePath))).exists(), false);
  assert.equal((await getDoc(doc(b, bobPath))).get('status'), 'approved');
  await assertFails(getDoc(doc(a, bobPath)));
  await assertFails(getDoc(doc(b, alicePath)));
  await assertFails(getDocs(collection(b, 'badge_requests')));
  await assertFails(updateDoc(doc(b, bobPath), {status: 'pending'}));
});

test('responder ao próprio post dispensa aviso e mantém a resposta sob autoria de Bob', async () => {
  const own = doc(b, postPath, 'replies', 'qa-reply-own');
  await setDoc(own, reply(bob));
  assert.equal((await getDoc(doc(a, own.path))).get('uid'), bob.uid);
  assert.equal((await getDoc(doc(b, 'users', bob.uid, 'notifications', own.id))).exists(), false);
  await assertFails(updateDoc(own, {body: 'Resposta alterada'}));
  await assertFails(deleteDoc(doc(a, own.path)));
  await deleteDoc(own);
  assert.equal((await getDoc(own)).exists(), false);
});

test('resposta cruzada sem aviso e aviso sem resposta são recusados', async () => {
  const postId = 'qa-nav-bob-profile';
  const replyId = 'qa-missing-companion';
  const replyRef = doc(a, postPath, 'replies', replyId);
  const noticeRef = doc(b, 'users', bob.uid, 'notifications', replyId);
  await assertFails(setDoc(replyRef, reply(alice)));
  await assertFails(setDoc(doc(a, noticeRef.path), notice(alice, postId, replyId)));
  assert.equal((await getDoc(replyRef)).exists(), false);
  assert.equal((await getDoc(noticeRef)).exists(), false);
});

test('o lote inteiro é recusado se destinatário, ID ou dados do aviso não conferirem', async () => {
  const postId = 'qa-nav-bob-profile';
  const replyId = 'qa-invalid-notice';
  await assertFails(replyWithNotice(a, alice, postId, replyId, alice.uid));
  for (const fields of [{replyId: 'outro-id'}, {postId: 'outro-post'}, {actorUid: bob.uid},
    {actorName: bob.name}, {read: true}, {createdAt: new Date(0)}, {extra: true}]) {
    await assertFails(replyWithNotice(a, alice, postId, replyId, bob.uid, fields));
  }
  assert.equal((await getDoc(doc(a, postPath, 'replies', replyId))).exists(), false);
  assert.equal((await getDoc(doc(b, 'users', bob.uid, 'notifications', replyId))).exists(), false);
});

test('resposta exige publicação existente, identidade autorizada e conteúdo válido', async () => {
  const postId = 'qa-nav-bob-profile';
  const replyId = 'qa-denied-reply';
  for (const db of invalidSessions) {
    await assertFails(replyWithNotice(db, alice, postId, replyId, bob.uid));
    await assertFails(getDoc(doc(db, postPath, 'replies', replyId)));
  }
  await assertFails(replyWithNotice(a, alice, 'sem-publicacao', replyId, bob.uid));
  const own = doc(b, postPath, 'replies', replyId);
  for (const fields of [{uid: alice.uid}, {authorName: alice.name}, {body: ''},
    {body: 'x'.repeat(601)}, {createdAt: new Date(0)}, {replyToId: 'fora-do-escopo'}]) {
    await assertFails(setDoc(own, {...reply(bob), ...fields}));
  }
});

test('Curtir e Salvar gravam e removem marcadores somente para o próprio titular', async () => {
  const postId = 'qa-nav-bob-profile';
  for (const kind of ['likedPosts', 'savedPosts']) {
    const path = `users/${alice.uid}/${kind}/${postId}`;
    const marker = doc(a, path);
    await setDoc(marker, {createdAt: serverTimestamp()});
    assert.equal((await getDoc(marker)).exists(), true);
    await assertFails(getDoc(doc(b, path)));
    await assertFails(deleteDoc(doc(b, path)));
    await assertFails(updateDoc(marker, {createdAt: serverTimestamp()}));
    await deleteDoc(marker);
    assert.equal((await getDoc(marker)).exists(), false);
  }
});

test('Curtir e Salvar recusam alvo inexistente, payload extra e identidade não verificada', async () => {
  for (const kind of ['likedPosts', 'savedPosts']) {
    const postId = 'qa-nav-bob-profile';
    const ownCollection = `users/${alice.uid}/${kind}/`;
    const ownPath = ownCollection + postId;
    await assertFails(setDoc(doc(a, ownCollection + 'sem-publicacao'), {createdAt: serverTimestamp()}));
    await assertFails(setDoc(doc(a, ownPath), {createdAt: serverTimestamp(), extra: true}));
    await assertFails(setDoc(doc(a, ownPath), {}));
    await assertFails(setDoc(doc(a, ownPath), {createdAt: new Date(0)}));
    await assertFails(setDoc(doc(b, ownPath), {createdAt: serverTimestamp()}));
    await assertFails(setDoc(doc(outsider, ownPath), {createdAt: serverTimestamp()}));
    const unverified = session(alice, {email_verified: false});
    await assertFails(setDoc(doc(unverified, ownPath), {createdAt: serverTimestamp()}));
  }
});

test('o titular cadastra, atualiza e revoga seu próprio dispositivo', async () => {
  const devices = 'users/' + alice.uid + '/pushDevices';
  const path = devices + '/fa892d59-7435-4665-b811-9456e4aa788a';
  const token = 'token-fcm-ficticio-para-o-emulador';
  const own = doc(a, path);
  await setDoc(own, {token, updatedAt: serverTimestamp()});
  assert.equal((await getDoc(own)).get('token'), token);
  await setDoc(own, {token: token + '-novo', updatedAt: serverTimestamp()});
  assert.equal((await getDoc(own)).get('token'), token + '-novo');
  await assertFails(getDocs(collection(a, devices)));
  for (const db of [b, outsider, withoutLogin, session(alice, {email_verified: false}),
    session(alice, {email: bob.email})]) {
    const other = doc(db, path);
    await assertFails(getDoc(other));
    await assertFails(setDoc(other, {token, updatedAt: serverTimestamp()}));
    await assertFails(deleteDoc(other));
  }
  await deleteDoc(own);
  assert.equal((await getDoc(own)).exists(), false);
});

test('o registro FCM recusa campos extras, dispositivo inválido e relógio do cliente', async () => {
  const devices = 'users/' + bob.uid + '/pushDevices';
  const own = doc(b, devices, 'bc55cefc-d6b7-4546-b16d-5660e0326a01');
  const token = 'token-fcm-ficticio-para-o-emulador';
  await assertFails(setDoc(own, {token, updatedAt: new Date(0)}));
  await assertFails(setDoc(own, {token, updatedAt: serverTimestamp(), extra: true}));
  await assertFails(setDoc(own, {token: 'curto', updatedAt: serverTimestamp()}));
  await assertFails(setDoc(own, {token: 'x'.repeat(4097), updatedAt: serverTimestamp()}));
  await assertFails(setDoc(doc(b, devices, 'nao-e-um-uuid'),
    {token, updatedAt: serverTimestamp()}));
});
