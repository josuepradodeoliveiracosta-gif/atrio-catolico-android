import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {after, before, test} from 'node:test';
import {assertFails, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, limit, orderBy, query,
  runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch} from 'firebase/firestore';
import {accounts, documents, moderationDocuments, moderator} from '../../firebase/qa-geral-celular/fixtures.mjs';

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
const admin = session(moderator);
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
    const now = new Date('2026-11-16T10:00:00Z');
    await Promise.all([...documents(now), ...moderationDocuments(now)]
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
  await assertFails(getDoc(doc(admin, noticePath)));
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
  assert.equal((await getDoc(doc(a, alicePath))).exists(), false);
  assert.equal((await getDoc(doc(b, bobPath))).get('status'), 'pending');
  await assertFails(getDoc(doc(a, bobPath)));
  await assertFails(getDoc(doc(b, alicePath)));
  await assertFails(getDocs(collection(b, 'badge_requests')));
  await assertFails(updateDoc(doc(b, bobPath), {status: 'approved'}));
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
  for (const db of [b, admin, outsider, withoutLogin, session(alice, {email_verified: false}),
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

test('perfil público e privado são atualizados pela transação do titular', async () => {
  const own = doc(a, 'profiles', alice.uid);
  const projection = doc(a, 'public_profiles', alice.uid);
  const fields = {displayName: 'Alice QA atualizada', bio: 'Apresentação fictícia revisada.'};
  const initial = (await getDoc(projection)).data();
  assert.ok(initial.joinedAt.isEqual((await getDoc(own)).get('createdAt')));
  await assertFails(updateDoc(own, fields));
  await assertFails(updateDoc(doc(b, own.path), fields));
  await assertFails(updateDoc(doc(admin, own.path), fields));
  await assertFails(getDoc(doc(admin, own.path)));
  await assertFails(updateDoc(projection, {bio: fields.bio, updatedAt: serverTimestamp()}));
  await runTransaction(a, async tx => {
    const published = await tx.get(projection);
    tx.update(own, fields);
    tx.set(projection, {...fields, joinedAt: published.get('joinedAt'), updatedAt: serverTimestamp()});
  });
  const visible = (await getDoc(doc(b, projection.path))).data();
  assert.deepEqual([visible.displayName, visible.bio], [fields.displayName, fields.bio]);
  assert.ok(visible.joinedAt.isEqual(initial.joinedAt));
  await assertFails(getDoc(doc(b, own.path)));
  await assertFails(getDocs(collection(admin, 'profiles')));
});

test('a retirada da projeção permite edição privada e novo opt-in explícito', async () => {
  const privateRef = doc(b, 'profiles', bob.uid);
  const publicRef = doc(b, 'public_profiles', bob.uid);
  await assertFails(deleteDoc(doc(a, publicRef.path)));
  await deleteDoc(publicRef);
  await updateDoc(privateRef, {bio: 'Apresentação ainda privada.'});
  assert.equal((await getDoc(doc(a, publicRef.path))).exists(), false);
  const own = (await getDoc(privateRef)).data();
  const fields = {displayName: own.displayName, bio: own.bio,
    joinedAt: own.createdAt, updatedAt: serverTimestamp()};
  await assertFails(setDoc(publicRef, {...fields, joinedAt: new Date(0)}));
  await assertFails(setDoc(publicRef, {...fields, uid: bob.uid}));
  await setDoc(publicRef, fields);
  assert.equal((await getDoc(doc(a, publicRef.path))).get('bio'), own.bio);
  await assertFails(getDocs(collection(a, 'public_profiles')));
});

test('foto publicada tem leitura delimitada e gravação reservada ao serviço', async () => {
  const path = 'profile_photos/' + bob.uid;
  await env.withSecurityRulesDisabled(context =>
    setDoc(doc(context.firestore(), path), {photoUrl: 'https://example.invalid/avatar-qa.png'}));
  assert.equal((await getDoc(doc(a, path))).exists(), true);
  await assertFails(getDoc(doc(outsider, path)));
  await assertFails(getDocs(collection(admin, 'profile_photos')));
  for (const db of [a, b, admin]) {
    await assertFails(setDoc(doc(db, path), {photoUrl: 'https://example.invalid/outro-avatar.png'}));
    await assertFails(deleteDoc(doc(db, path)));
  }
});

test('índice dedicado corresponde à consulta de histórico datado por autor', () => {
  const config = JSON.parse(readFileSync(
    new URL('../../firebase/qa-geral-celular/firestore.indexes.json', import.meta.url), 'utf8'
  ));
  assert.ok(config.indexes.some(index =>
    index.collectionGroup === 'posts' && index.queryScope === 'COLLECTION'
    && index.fields.length === 2 && index.fields[0].fieldPath === 'uid'
    && index.fields[0].order === 'ASCENDING' && index.fields[1].fieldPath === 'createdAt'
    && index.fields[1].order === 'DESCENDING'
  ));
});

test('titulares gerenciam o selo leigo e enviam pedido de verificação privado', async () => {
  const badgePath = 'badges/' + alice.uid;
  const requestPath = 'badge_requests/' + alice.uid;
  await setDoc(doc(a, badgePath), {lay: 'leiga'});
  assert.equal((await getDoc(doc(b, badgePath))).get('lay'), 'leiga');
  await updateDoc(doc(a, badgePath), {lay: ''});
  await assertFails(updateDoc(doc(b, badgePath), {lay: 'leiga'}));
  await assertFails(updateDoc(doc(a, badgePath), {clergy: 'religiosa'}));
  await assertFails(updateDoc(doc(a, badgePath), {moderator: true}));
  const fields = {kind: 'religiosa', status: 'pending', createdAt: serverTimestamp()};
  await assertFails(setDoc(doc(b, requestPath), fields));
  await setDoc(doc(a, requestPath), fields);
  assert.equal((await getDoc(doc(a, requestPath))).get('status'), 'pending');
  await assertFails(getDoc(doc(b, requestPath)));
  await assertFails(getDocs(collection(a, 'badge_requests')));
});

test('o moderador consulta a fila e concede ou revoga selo com decisão e histórico', async () => {
  const requestRef = doc(admin, 'badge_requests', bob.uid);
  const badgeRef = doc(admin, 'badges', bob.uid);
  const pending = await getDocs(query(collection(admin, 'badge_requests'),
    where('status', '==', 'pending'), limit(31)));
  assert.ok(pending.docs.some(item => item.id === bob.uid));
  const reason = 'Justificativa fictícia da moderação QA.';
  const approval = {
    status: 'approved', reviewedBy: moderator.uid, reviewedAt: serverTimestamp(), reviewNote: reason
  };
  const event = decision => ({
    targetUid: bob.uid, kind: 'diacono', decision, actorUid: moderator.uid,
    reason, createdAt: serverTimestamp()
  });
  await assertFails(updateDoc(requestRef, approval));
  await assertFails(setDoc(badgeRef, {clergy: 'diacono'}));
  const grantEvent = doc(admin, 'badge_events', 'qa-selo-concedido');
  const grant = writeBatch(admin);
  grant.update(requestRef, approval);
  grant.set(badgeRef, {clergy: 'diacono'}, {merge: true});
  grant.set(grantEvent, event('approved'));
  await grant.commit();
  assert.equal((await getDoc(doc(a, badgeRef.path))).get('clergy'), 'diacono');
  assert.equal((await getDoc(grantEvent)).get('decision'), 'approved');
  await assertFails(getDoc(doc(b, grantEvent.path)));
  await assertFails(setDoc(doc(admin, 'badge_events', 'qa-decisao-retroativa'), event('approved')));
  await assertFails(deleteDoc(grantEvent));

  const revocation = {
    status: 'revoked', revokedBy: moderator.uid, revokedAt: serverTimestamp(), revokeNote: reason
  };
  await assertFails(updateDoc(requestRef, revocation));
  const revoke = writeBatch(admin);
  revoke.update(requestRef, revocation);
  revoke.update(badgeRef, {clergy: deleteField()});
  revoke.set(doc(admin, 'badge_events', 'qa-selo-revogado'), event('revoked'));
  await revoke.commit();
  assert.equal((await getDoc(doc(b, requestRef.path))).get('status'), 'revoked');
  assert.equal((await getDoc(doc(a, badgeRef.path))).get('clergy'), undefined);
  await setDoc(doc(b, requestRef.path),
    {kind: 'diacono', status: 'pending', createdAt: serverTimestamp()}, {merge: true});
  assert.equal((await getDoc(doc(b, requestRef.path))).get('status'), 'pending');
});

test('denúncia de participante fica privada e só o moderador pode analisá-la', async () => {
  const reportPath = 'user_reports/' + alice.uid + '__' + bob.uid;
  const report = {reporterUid: alice.uid, targetUid: bob.uid,
    reason: 'Denúncia fictícia de participante.', createdAt: serverTimestamp()};
  await setDoc(doc(a, reportPath), report);
  await assertFails(setDoc(doc(a, reportPath), report));
  await assertFails(getDoc(doc(b, reportPath)));
  await assertFails(getDocs(collection(a, 'user_reports')));
  assert.equal((await getDoc(doc(a, reportPath))).get('reporterUid'), alice.uid);

  const reviewed = {status: 'reviewed', reviewedBy: moderator.uid, reviewedAt: serverTimestamp()};
  await assertFails(updateDoc(doc(a, reportPath), reviewed));
  await assertFails(updateDoc(doc(admin, reportPath), {...reviewed, reason: 'Razão diferente'}));
  const queue = await getDocs(query(collection(admin, 'user_reports'), orderBy('createdAt', 'desc'), limit(30)));
  assert.ok(queue.docs.some(item => item.id === reportPath.split('/')[1]));
  await updateDoc(doc(admin, reportPath), reviewed);
  assert.equal((await getDoc(doc(a, reportPath))).get('status'), 'reviewed');
  await assertFails(updateDoc(doc(admin, reportPath), reviewed));
});

function reportReview(status, reviewTarget) {
  return {status, reviewedBy: moderator.uid, reviewedAt: serverTimestamp(),
    reviewNote: 'Resultado fictício da análise QA.', reviewTarget};
}

test('denúncia de publicação só é listada pelo moderador e pode ser encerrada', async () => {
  const postId = 'qa-nav-bob-profile';
  const path = 'reports/' + alice.uid + '_post_' + postId;
  const fields = {postId, reporterUid: alice.uid,
    reason: 'Denúncia fictícia da publicação.', createdAt: serverTimestamp()};
  await assertFails(setDoc(doc(a, 'reports', 'id-divergente'), fields));
  await setDoc(doc(a, path), fields);
  await assertFails(setDoc(doc(a, path), fields));
  await assertFails(getDoc(doc(a, path)));
  await assertFails(getDoc(doc(b, path)));
  const queue = await getDocs(query(collection(admin, 'reports'), orderBy('createdAt', 'desc'), limit(31)));
  assert.ok(queue.docs.some(item => item.id === path.split('/')[1]));
  await assertFails(updateDoc(doc(a, path), reportReview('dismissed', 'post')));
  await updateDoc(doc(admin, path), reportReview('dismissed', 'post'));
  assert.equal((await getDoc(doc(admin, path))).get('status'), 'dismissed');
  assert.equal((await getDoc(doc(b, 'posts', postId))).exists(), true);
  await assertFails(deleteDoc(doc(admin, path)));
  await assertFails(updateDoc(doc(admin, 'reports', 'qa-guardiao-retido'), reportReview('dismissed', 'post')));
});

test('remoção de resposta pelo moderador exige análise atômica e preserva a publicação', async () => {
  const postId = 'qa-nav-bob-profile';
  const replyId = 'qa-reply-atomic';
  const reportId = bob.uid + '_reply_' + postId + '_' + replyId;
  const target = doc(admin, 'posts', postId, 'replies', replyId);
  const reportRef = doc(admin, 'reports', reportId);
  await setDoc(doc(b, reportRef.path), {postId, replyId, reporterUid: bob.uid,
    reason: 'Denúncia fictícia da resposta.', createdAt: serverTimestamp()});
  await assertFails(deleteDoc(target));
  await assertFails(updateDoc(reportRef, reportReview('removed', 'reply')));
  await runTransaction(admin, async tx => {
    const content = await tx.get(target);
    assert.ok(content.exists());
    tx.delete(target);
    tx.update(reportRef, reportReview('removed', 'reply'));
  });
  assert.equal((await getDoc(target)).exists(), false);
  assert.equal((await getDoc(doc(admin, 'posts', postId))).exists(), true);
});

test('remoção de publicação também exige denúncia e decisão no mesmo lote', async () => {
  const postId = 'qa-thread-alice';
  const reportPath = 'reports/' + bob.uid + '_post_' + postId;
  const postRef = doc(admin, 'posts', postId);
  await setDoc(doc(b, reportPath), {postId, reporterUid: bob.uid,
    reason: 'Denúncia fictícia para remoção.', createdAt: serverTimestamp()});
  await assertFails(deleteDoc(postRef));
  const remove = writeBatch(admin);
  remove.delete(postRef);
  remove.update(doc(admin, reportPath), reportReview('removed', 'post'));
  await remove.commit();
  assert.equal((await getDoc(postRef)).exists(), false);
  await assertFails(getDocs(collection(b, 'posts', postId, 'replies')));
});

test('papel de moderação exige identidade de QA verificada e é revogado pelo documento', async () => {
  const rolePath = 'admins/' + moderator.uid;
  assert.equal((await getDoc(doc(admin, rolePath))).get('enabled'), true);
  assert.equal((await getDoc(doc(admin, 'profiles', moderator.uid))).get('displayName'), moderator.name);
  await assertFails(getDoc(doc(a, rolePath)));
  await assertFails(updateDoc(doc(admin, rolePath), {enabled: false}));
  await assertFails(setDoc(doc(b, 'admins', bob.uid), {enabled: true}));
  for (const db of [session(moderator, {email_verified: false}), session(moderator, {email: alice.email}),
    session(alice, {admin: true}), outsider]) {
    await assertFails(getDocs(collection(db, 'reports')));
    await assertFails(getDocs(collection(db, 'badge_requests')));
  }
  try {
    await env.withSecurityRulesDisabled(context =>
      updateDoc(doc(context.firestore(), rolePath), {enabled: false}));
    assert.equal((await getDoc(doc(admin, rolePath))).get('enabled'), false);
    await assertFails(getDocs(collection(admin, 'reports')));
    await assertFails(getDocs(collection(admin, 'badge_requests')));
    await assertFails(getDocs(collection(admin, 'badge_events')));
  } finally {
    await env.withSecurityRulesDisabled(context =>
      updateDoc(doc(context.firestore(), rolePath), {enabled: true}));
  }
});

test('moderação de QA não ativa Conversas, Grupos ou o Guardião', async () => {
  const config = await getDoc(doc(admin, configPath));
  assert.equal(config.get('enabled'), false);
  assert.equal(config.get('minorPolicyApproved'), false);
  await assertFails(updateDoc(doc(admin, configPath), {enabled: true}));
  await assertFails(setDoc(doc(admin, 'app_config', 'chat_groups'), {enabled: true}));
  await assertFails(setDoc(doc(admin, 'guardian_config', 'policy'), {enabled: true}));
});
