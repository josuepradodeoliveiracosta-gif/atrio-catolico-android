import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {after, before, test} from 'node:test';
import {assertFails, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {arrayRemove, arrayUnion, collection, collectionGroup, deleteDoc, doc, getDoc,
  getDocFromServer, getDocs, getDocsFromServer, limit, orderBy, query, serverTimestamp,
  setDoc, updateDoc, where, writeBatch}
  from 'firebase/firestore';
import {renderClosedPilotRules, renderPilotRollbackRules} from '../../firebase/qa-geral-celular/pilot/rules.mjs';
import {alice, bob, moderator, pilotDocuments, pilotFlags, projectId}
  from '../../firebase/qa-geral-celular/pilot/fixtures.mjs';

const rules = renderClosedPilotRules();
console.log('SHA-256 das Rules do piloto:', createHash('sha256').update(rules).digest('hex'));
const env = await initializeTestEnvironment({
  projectId, firestore: {host: '127.0.0.1', port: 8089, rules}
});
function session(account, verified = true, environment = env) {
  return environment.authenticatedContext(account.uid, {email: account.email, email_verified: verified}).firestore();
}
const a = session(alice);
const b = session(bob);
const admin = session(moderator);
const outsider = {uid: 'qa-pilot-fora', email: 'fora@qa.invalid'};
const guest = env.unauthenticatedContext().firestore();
const chatId = alice.uid + '__' + bob.uid;
const room = 'chats/' + chatId;
const groupId = 'qa-pilot-grupo';
const group = 'chat_groups/' + groupId;
const invite = group + '/atrioGroupInvites/' + bob.uid;
const chatText = 'Primeiro contato fictício no piloto.';
const groupText = 'Mensagem fictícia do grupo do piloto.';
const now = new Date();
const fixtures = new Map(pilotDocuments(now));
const age = uid => 'users/' + uid + '/chatAgeEligibility/current';
const groupAdmission = uid => 'users/' + uid + '/chatGroupAccess/eligibility';

async function seed(rows) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (const [path, data] of rows) batch.set(doc(db, path), data);
    await batch.commit();
  });
}

function firstContact(peer = bob.uid) {
  const id = alice.uid + '__' + peer;
  const path = 'chats/' + id;
  const batch = writeBatch(a);
  batch.set(doc(a, path), {
    participants: [alice.uid, peer], requesterUid: alice.uid, recipientUid: peer, status: 'pending',
    initialId: 'primeira', lastMessageId: 'primeira', lastPreview: chatText, lastSenderUid: alice.uid,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), unreadRequester: 0, unreadRecipient: 1
  });
  batch.set(doc(a, path, 'messages', 'primeira'), {
    uid: alice.uid, kind: 'text', text: chatText, createdAt: serverTimestamp()
  });
  batch.set(doc(a, 'users', alice.uid, 'chatLimits', 'requests'), {
    count: 1, windowStart: serverTimestamp(), updatedAt: serverTimestamp(), lastChatId: id
  });
  return batch.commit();
}

function inbox(db, uid) {
  return getDocs(query(collection(db, 'chats'), where('participants', 'array-contains', uid), limit(100)));
}

function directHistory(db) {
  return getDocs(query(collection(db, room, 'messages'), orderBy('createdAt'), limit(100)));
}

function groupHistory(db) {
  return getDocs(query(collection(db, group, 'messages'), orderBy('createdAt'), limit(100)));
}

function acceptInvitation() {
  const batch = writeBatch(b);
  batch.update(doc(b, invite), {status: 'accepted', updatedAt: serverTimestamp()});
  batch.update(doc(b, group), {memberUids: arrayUnion(bob.uid), updatedAt: serverTimestamp()});
  return batch.commit();
}

function contentReport(kind, messageId, text) {
  const direct = kind === 'direct';
  const collectionName = direct ? 'chat_reports' : 'chat_group_reports';
  const target = direct ? {chatId} : {groupId};
  const id = bob.uid + '__' + (direct ? chatId : groupId) + '__' + messageId;
  return [collectionName + '/' + id, {...target, messageId, reporterUid: bob.uid,
    reason: 'Denúncia fictícia para a moderação do piloto.', reportedText: text,
    createdAt: serverTimestamp()}];
}

const [directReport, directData] = contentReport('direct', 'primeira', chatText);
const [groupReport, groupData] = contentReport('group', 'primeira', groupText);
const [lateReport, lateData] = contentReport('group', 'posterior', 'Outra mensagem fictícia.');

before(async () => {
  await env.clearFirestore();
  await seed(fixtures);
});
after(() => env.cleanup());

test('o piloto começa fechado com configuração presente ou ausente', async () => {
  for (const [path] of pilotFlags()) {
    assert.equal((await getDoc(doc(a, path))).get('enabled'), false);
    await assertFails(updateDoc(doc(a, path), {enabled: true, minorPolicyApproved: true}));
  }
  await assertFails(firstContact());
  await assertFails(directHistory(a));
  await assertFails(groupHistory(a));
  await env.withSecurityRulesDisabled(async context => {
    for (const [path] of pilotFlags()) await deleteDoc(doc(context.firestore(), path));
  });
  await assertFails(inbox(a, alice.uid));
  await assertFails(firstContact());
  await assertFails(getDoc(doc(a, group)));
  await seed(pilotFlags());
});

test('admissão exige confirmação individual e ninguém altera a própria elegibilidade', async () => {
  await seed(pilotFlags(true));
  await setDoc(doc(b, 'users', bob.uid, 'chatSettings', 'privacy'), {
    requests: 'all', readReceipts: false, showPushPreview: false, updatedAt: serverTimestamp()
  });
  await assertFails(updateDoc(doc(a, age(alice.uid)), {status: 'eligible'}));
  await assertFails(updateDoc(doc(b, groupAdmission(bob.uid)), {status: 'approved'}));
  await seed([[age(outsider.uid), fixtures.get(age(bob.uid))],
    ['users/' + outsider.uid + '/chatSettings/privacy', {requests: 'all'}]]);
  await assertFails(firstContact(outsider.uid));
  for (const proof of [{minimumAge: 17}, {status: 'revoked'}, {reviewExpiresAt: new Date(0)}]) {
    await seed([[age(bob.uid), {...fixtures.get(age(bob.uid)), ...proof}]]);
    await assertFails(firstContact());
  }
  await seed([[age(bob.uid), fixtures.get(age(bob.uid))]]);
  await firstContact();
  assert.equal((await getDoc(doc(b, room))).get('status'), 'pending');
  await assertFails(updateDoc(doc(a, room), {status: 'accepted', updatedAt: serverTimestamp()}));
  await updateDoc(doc(b, room), {status: 'accepted', updatedAt: serverTimestamp()});
  assert.equal((await getDoc(doc(a, room))).get('status'), 'accepted');
});

test('lista e histórico diretos exigem a sessão e a participação corretas', async () => {
  for (const [db, uid] of [[a, alice.uid], [b, bob.uid]]) {
    assert.deepEqual((await inbox(db, uid)).docs.map(item => item.id), [chatId]);
    assert.equal((await directHistory(db)).docs[0].get('text'), chatText);
  }
  await assertFails(inbox(a, bob.uid));
  for (const db of [session(outsider), session(bob, false), session({...bob, email: alice.email}), admin, guest]) {
    await assertFails(getDoc(doc(db, room)));
    await assertFails(directHistory(db));
  }
});

test('bloqueio bilateral retira caixa e histórico direto e impede convite novo', async () => {
  const name = 'Grupo fechado QA';
  const batch = writeBatch(a);
  batch.set(doc(a, group), {
    name, category: 'study', ownerUid: alice.uid, memberUids: [alice.uid],
    adminUids: [alice.uid], status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    lastMessageId: '', lastPreview: '', lastSenderUid: ''
  });
  batch.set(doc(a, 'users', alice.uid, 'chatGroupLimits', 'creation'), {
    count: 1, windowStart: serverTimestamp(), lastGroupId: groupId, updatedAt: serverTimestamp()
  });
  await batch.commit();
  const ownBlock = doc(a, 'users', alice.uid, 'blockedMembers', bob.uid);
  const payload = {inviteeUid: bob.uid, inviterUid: alice.uid, contactChatId: chatId, groupName: name,
    status: 'pending', createdAt: serverTimestamp(), updatedAt: serverTimestamp()};
  await setDoc(ownBlock, {createdAt: serverTimestamp()});
  for (const [db, uid] of [[a, alice.uid], [b, bob.uid]]) {
    await assertFails(inbox(db, uid));
    await assertFails(getDoc(doc(db, room)));
    await assertFails(directHistory(db));
  }
  await assertFails(deleteDoc(doc(b, ownBlock.path)));
  await assertFails(setDoc(doc(a, invite), payload));
  await deleteDoc(ownBlock);
  await setDoc(doc(a, invite), payload);
  assert.equal((await directHistory(a)).size, 1);
});

test('convite e ingresso de grupo exigem aceite do destinatário sem bloqueio', async () => {
  const received = await getDocs(query(collectionGroup(b, 'atrioGroupInvites'),
    where('inviteeUid', '==', bob.uid)));
  assert.ok(received.docs.some(item => item.ref.path === invite));
  await assertFails(getDoc(doc(b, group)));
  await assertFails(getDoc(doc(session(outsider), invite)));
  await assertFails(getDoc(doc(session(bob, false), invite)));
  await assertFails(updateDoc(doc(b, invite), {status: 'accepted', updatedAt: serverTimestamp()}));
  const ownBlock = doc(b, 'users', bob.uid, 'blockedMembers', alice.uid);
  await setDoc(ownBlock, {createdAt: serverTimestamp()});
  await assertFails(acceptInvitation());
  await deleteDoc(ownBlock);
  await acceptInvitation();
  assert.deepEqual((await getDoc(doc(b, group))).get('memberUids'), [alice.uid, bob.uid]);
  const batch = writeBatch(a);
  batch.set(doc(a, group, 'messages', 'primeira'), {
    uid: alice.uid, kind: 'text', text: groupText, createdAt: serverTimestamp()
  });
  batch.update(doc(a, group), {lastMessageId: 'primeira', lastPreview: groupText,
    lastSenderUid: alice.uid, updatedAt: serverTimestamp()});
  await batch.commit();
  assert.equal((await groupHistory(b)).docs[0].get('text'), groupText);
});

test('denúncias são consultadas pelo autor do protocolo e pelo moderador ativo', async () => {
  for (const [path, data] of [[directReport, directData], [groupReport, groupData]]) {
    await setDoc(doc(b, path), data);
    assert.equal((await getDoc(doc(b, path))).get('reportedText'), data.reportedText);
    assert.equal((await getDoc(doc(admin, path))).get('reporterUid'), bob.uid);
    for (const db of [a, session(outsider), session(bob, false), guest]) {
      await assertFails(getDoc(doc(db, path)));
    }
    const collectionName = path.split('/')[0];
    await assertFails(getDocs(collection(b, collectionName)));
    assert.equal((await getDocs(collection(admin, collectionName))).size, 1);
    await assertFails(updateDoc(doc(b, path), {reason: 'Edição posterior da evidência.'}));
    await assertFails(deleteDoc(doc(admin, path)));
  }
  await assertFails(directHistory(admin));
  await assertFails(groupHistory(admin));
});

test('revogação individual e suspensão de grupo retiram acesso no servidor', async () => {
  await seed([[age(bob.uid), {...fixtures.get(age(bob.uid)), status: 'revoked'}]]);
  await assertFails(inbox(b, bob.uid));
  await assertFails(directHistory(b));
  await assertFails(groupHistory(b));
  assert.equal((await getDoc(doc(b, directReport))).exists(), true);
  await seed([[age(bob.uid), fixtures.get(age(bob.uid))],
    [groupAdmission(bob.uid), {...fixtures.get(groupAdmission(bob.uid)), status: 'suspended'}]]);
  assert.equal((await directHistory(b)).size, 1);
  await assertFails(groupHistory(b));
  await seed([[groupAdmission(bob.uid), fixtures.get(groupAdmission(bob.uid))]]);
  assert.equal((await groupHistory(b)).size, 1);
});

test('remoção e saída retiram acesso ao histórico sem apagar o protocolo anterior', async () => {
  await seed([[group + '/messages/posterior', {
    uid: alice.uid, kind: 'text', text: lateData.reportedText, createdAt: now
  }]]);
  const remove = {memberUids: arrayRemove(bob.uid), lastRemovedUid: bob.uid, updatedAt: serverTimestamp()};
  await updateDoc(doc(a, group), remove);
  await assertFails(getDoc(doc(b, group)));
  await assertFails(groupHistory(b));
  assert.equal((await groupHistory(a)).size, 2);
  await assertFails(setDoc(doc(b, lateReport), lateData));
  await updateDoc(doc(a, invite), {status: 'pending', updatedAt: serverTimestamp()});
  await assertFails(groupHistory(b));
  await acceptInvitation();
  await updateDoc(doc(b, group), {...remove, updatedAt: serverTimestamp()});
  await assertFails(getDoc(doc(b, group, 'messages', 'primeira')));
  await assertFails(groupHistory(b));
  await assertFails(setDoc(doc(b, lateReport), lateData));
  assert.equal((await getDoc(doc(b, groupReport))).exists(), true);
  assert.equal((await getDoc(doc(admin, groupReport))).exists(), true);
});

test('revogar o moderador fecha a fila e desligar o piloto oculta históricos existentes', async () => {
  await seed([['admins/' + moderator.uid, {enabled: false}]]);
  await assertFails(getDoc(doc(admin, directReport)));
  await assertFails(getDocs(collection(admin, 'chat_group_reports')));
  await seed(pilotFlags());
  await assertFails(inbox(a, alice.uid));
  await assertFails(directHistory(a));
  await assertFails(groupHistory(a));
  assert.equal((await getDoc(doc(b, directReport))).exists(), true);
});

test('ligar Grupos sem a política aprovada de Conversas mantém os históricos fechados', async () => {
  const [direct, groups] = pilotFlags(true);
  await seed([[direct[0], {...direct[1], minorPolicyApproved: false}], groups]);
  await assertFails(inbox(a, alice.uid));
  await assertFails(directHistory(a));
  await assertFails(getDoc(doc(a, group)));
  await assertFails(groupHistory(a));
  await seed(pilotFlags());
});

test('as permissões de Fórum e perfil ficam disponíveis com o piloto fechado', async () => {
  assert.equal((await getDoc(doc(a, 'profiles', alice.uid))).get('displayName'), alice.name);
  await assertFails(getDoc(doc(b, 'profiles', alice.uid)));
  const post = 'posts/qa-nav-bob-profile';
  assert.equal((await getDoc(doc(a, post))).get('uid'), bob.uid);
});

test('as regras de retorno fecham dados piloto preexistentes mesmo com as flags ativas', async () => {
  await seed([...pilotFlags(true), ['admins/' + moderator.uid, {enabled: true}]]);
  // Os dados do grupo permanecem após a saída de Bob no cenário anterior.
  // Repor o participante antes de testar o bloqueio para as duas contas.
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), group), {memberUids: [alice.uid, bob.uid]});
  });
  const requests = (db, uid) => [
    getDocFromServer(doc(db, room)),
    getDocFromServer(doc(db, room, 'messages', 'primeira')),
    getDocsFromServer(query(collection(db, 'chats'), where('participants', 'array-contains', uid), limit(100))),
    getDocFromServer(doc(db, group)),
    getDocFromServer(doc(db, group, 'messages', 'primeira')),
    getDocsFromServer(query(collection(db, 'chat_groups'), where('memberUids', 'array-contains', uid), limit(100)))
  ];
  const preferenceWrites = (db, uid, muted) => [
    setDoc(doc(db, 'users', uid, 'chatBox', chatId),
      {muted, pinned: false, archived: false, updatedAt: serverTimestamp()}),
    setDoc(doc(db, 'users', uid, 'chatGroupBox', groupId), {muted, updatedAt: serverTimestamp()})
  ];
  for (const [db, uid] of [[a, alice.uid], [b, bob.uid]]) {
    const results = await Promise.all(requests(db, uid));
    assert.ok(results.every(result => typeof result.exists === 'function' ? result.exists() : !result.empty));
    await Promise.all(preferenceWrites(db, uid, false));
  }
  assert.equal((await getDocFromServer(doc(b, invite))).exists(), true);

  const rollbackRules = renderPilotRollbackRules();
  console.log('SHA-256 das Rules de retorno fechado:', createHash('sha256').update(rollbackRules).digest('hex'));
  const rollback = await initializeTestEnvironment({
    projectId, firestore: {host: '127.0.0.1', port: 8089, rules: rollbackRules}
  });
  try {
    const closedAlice = session(alice, true, rollback);
    const closedBob = session(bob, true, rollback);
    const closedModerator = session(moderator, true, rollback);
    for (const [db, uid] of [[closedAlice, alice.uid], [closedBob, bob.uid]]) {
      await Promise.all(requests(db, uid).map(request => assertFails(request)));
      await assertFails(getDocFromServer(doc(db, invite)));
      await assertFails(getDocsFromServer(query(collectionGroup(db, 'atrioGroupInvites'), where('inviteeUid', '==', uid))));
      await Promise.all(preferenceWrites(db, uid, true).map(request => assertFails(request)));
    }
    for (const [path] of pilotFlags()) {
      assert.equal((await getDocFromServer(doc(closedBob, path))).get('enabled'), true);
    }
    for (const path of [directReport, groupReport]) {
      assert.equal((await getDocFromServer(doc(closedBob, path))).exists(), true);
      assert.equal((await getDocFromServer(doc(closedModerator, path))).exists(), true);
      await assertFails(getDocFromServer(doc(closedAlice, path)));
    }
    assert.equal((await getDocFromServer(doc(closedAlice, 'posts/qa-nav-bob-profile'))).get('uid'), bob.uid);
    assert.equal((await getDocFromServer(doc(closedAlice, 'profiles', alice.uid))).get('displayName'), alice.name);
  } finally {
    await rollback.cleanup();
  }
});
