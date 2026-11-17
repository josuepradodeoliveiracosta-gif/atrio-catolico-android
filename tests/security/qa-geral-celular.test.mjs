import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {after, before, test} from 'node:test';
import {assertFails, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where} from 'firebase/firestore';
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
  for (const db of [outsider, withoutLogin, session(alice, {email_verified: false}),
    session(alice, {email: bob.email})]) {
    await assertFails(getDoc(doc(db, postPath)));
    await assertFails(getDoc(doc(db, configPath)));
  }
});

test('clientes não podem criar mensagens, contatos, publicações ou regras de acesso', async () => {
  const chatId = alice.uid + '__' + bob.uid;
  await assertFails(setDoc(doc(a, 'chats/' + chatId), {participants: [alice.uid, bob.uid]}));
  await assertFails(setDoc(doc(a, 'chats/' + chatId + '/messages/1'), {text: 'teste'}));
  await assertFails(setDoc(doc(a, 'chat_groups/1'), {participants: [alice.uid]}));
  await assertFails(updateDoc(doc(a, postPath), {likes: arrayUnion(alice.uid)}));
  await assertFails(deleteDoc(doc(a, 'profiles/' + alice.uid)));
  await assertFails(setDoc(doc(a, 'admins/' + alice.uid), {enabled: true}));
  await assertFails(getDoc(doc(a, 'chat_groups/1')));
});

test('os clientes ainda não geram respostas nem avisos no projeto de homologação', async () => {
  const replyId = 'qa-reply-denied';
  await assertFails(setDoc(doc(a, postPath, 'replies', replyId), {
    uid: alice.uid, authorName: 'Alice QA', body: 'Resposta fictícia do ensaio.', createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(a, 'users', bob.uid, 'notifications', replyId), {
    postId: postPath.split('/')[1], replyId, actorUid: alice.uid, actorName: 'Alice QA',
    read: false, createdAt: serverTimestamp()
  }));
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
