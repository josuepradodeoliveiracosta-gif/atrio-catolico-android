import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {assertFails, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection, collectionGroup, doc, getDocFromServer, getDocsFromServer, limit, orderBy,
  query, serverTimestamp, setDoc, updateDoc, where, writeBatch} from 'firebase/firestore';
import {renderClosedPilotRules, renderPilotShutdownRules}
  from '../../firebase/qa-geral-celular/pilot/rules.mjs';
import {alice, bob, moderator, pilotDocuments, pilotFlags, projectId}
  from '../../firebase/qa-geral-celular/pilot/fixtures.mjs';

const chatId = alice.uid + '__' + bob.uid;
const chat = 'chats/' + chatId;
const chatMessage = chat + '/messages/primeira';
const groupId = 'qa-encerramento';
const group = 'chat_groups/' + groupId;
const groupMessage = group + '/messages/primeira';
const invite = group + '/atrioGroupInvites/' + bob.uid;
const directReport = 'chat_reports/' + bob.uid + '__' + chatId + '__primeira';
const groupReport = 'chat_group_reports/' + bob.uid + '__' + groupId + '__primeira';
const chatText = 'Prévia fictícia da conversa.';
const groupText = 'Prévia fictícia do grupo.';
const now = new Date();

const pilotRules = renderClosedPilotRules();
const shutdownRules = renderPilotShutdownRules();
for (const [name, rules] of [['piloto', pilotRules], ['encerramento', shutdownRules]]) {
  console.log(`SHA-256 das Rules de ${name}: ${createHash('sha256').update(rules).digest('hex')}`);
}

function connect(rules) {
  return initializeTestEnvironment({projectId, firestore: {host: '127.0.0.1', port: 8089, rules}});
}

function client(env, account) {
  return env.authenticatedContext(account.uid, {email: account.email, email_verified: true}).firestore();
}

async function seed(env, rows) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (const [path, fields] of rows) batch.set(doc(db, path), fields);
    await batch.commit();
  });
}

const histories = [
  [chat, {participants: [alice.uid, bob.uid], requesterUid: alice.uid, recipientUid: bob.uid,
    status: 'accepted', lastPreview: chatText, updatedAt: now}],
  [group, {memberUids: [alice.uid, bob.uid], adminUids: [alice.uid], ownerUid: alice.uid,
    name: 'Grupo fictício', status: 'active', lastPreview: groupText, updatedAt: now}],
  [chatMessage, {uid: alice.uid, text: chatText, kind: 'text', createdAt: now}],
  [groupMessage, {uid: alice.uid, text: groupText, kind: 'text', createdAt: now}],
  [invite, {inviteeUid: bob.uid, inviterUid: alice.uid, status: 'accepted', createdAt: now}],
  ...[alice, bob].flatMap(({uid}) => [
    [`users/${uid}/chatBox/${chatId}`, {archived: false, updatedAt: now}],
    [`users/${uid}/chatGroupBox/${groupId}`, {muted: false, updatedAt: now}]
  ])
];

const reports = [
  [directReport, {chatId, reporterUid: bob.uid, messageId: 'primeira',
    reason: 'Protocolo de teste da conversa.', reportedText: chatText, createdAt: now}],
  [groupReport, {groupId, reporterUid: bob.uid, messageId: 'primeira',
    reason: 'Protocolo de teste do grupo.', reportedText: groupText, createdAt: now}]
];

function inbox(db, uid, path, membership) {
  return getDocsFromServer(query(collection(db, path), where(membership, 'array-contains', uid), limit(100)));
}

function messages(db, parent) {
  return getDocsFromServer(query(collection(db, parent, 'messages'), orderBy('createdAt'), limit(100)));
}

async function assertClosed(env) {
  for (const account of [alice, bob]) {
    const db = client(env, account);
    const {uid} = account;
    await assertFails(inbox(db, uid, 'chats', 'participants'));
    await assertFails(inbox(db, uid, 'chat_groups', 'memberUids'));
    for (const [box, id] of [['chatBox', chatId], ['chatGroupBox', groupId]]) {
      await assertFails(getDocsFromServer(collection(db, 'users', uid, box)));
      await assertFails(getDocFromServer(doc(db, 'users', uid, box, id)));
    }
    for (const path of [chat, group, chatMessage, groupMessage, invite]) {
      await assertFails(getDocFromServer(doc(db, path)));
    }
    await assertFails(messages(db, chat));
    await assertFails(messages(db, group));
    await assertFails(getDocsFromServer(query(collectionGroup(db, 'atrioGroupInvites'),
      where('inviteeUid', '==', uid))));
    for (const parent of [chat, group]) {
      await assertFails(setDoc(doc(db, parent, 'messages', 'apos-fechar'), {
        uid, text: 'Mensagem fictícia após o fechamento.', kind: 'text', createdAt: serverTimestamp()
      }));
    }
  }
}

async function assertDocumentsRemain(env) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [path, expected] of [...histories, ...reports]) {
      const snapshot = await getDocFromServer(doc(db, path));
      assert.ok(snapshot.exists(), path);
      for (const [key, value] of Object.entries(expected)) {
        const stored = snapshot.get(key);
        assert.deepEqual(value instanceof Date ? stored.toMillis() : stored,
          value instanceof Date ? value.getTime() : value, `${path}.${key}`);
      }
    }
  });
}

test('o encerramento preserva os dados fictícios, mas fecha todas as superfícies do piloto', async t => {
  const pilot = await connect(pilotRules);
  let closed;
  try {
    await pilot.clearFirestore();
    await seed(pilot, pilotDocuments(now));
    await seed(pilot, histories);
    await seed(pilot, reports);

    await t.test('com o piloto aberto, as duas contas leem as caixas e prévias existentes', async () => {
      await seed(pilot, pilotFlags(true));
      for (const account of [alice, bob]) {
        const db = client(pilot, account);
        const {uid} = account;
        assert.equal((await inbox(db, uid, 'chats', 'participants')).docs[0].get('lastPreview'), chatText);
        assert.equal((await inbox(db, uid, 'chat_groups', 'memberUids')).docs[0].get('lastPreview'), groupText);
        assert.equal((await getDocFromServer(doc(db, chat))).get('lastPreview'), chatText);
        const groupSnapshot = await getDocFromServer(doc(db, group));
        assert.equal(groupSnapshot.get('lastPreview'), groupText);
        assert.equal(groupSnapshot.get('name'), 'Grupo fictício');
        assert.equal((await messages(db, chat)).docs[0].get('text'), chatText);
        assert.equal((await messages(db, group)).docs[0].get('text'), groupText);
        assert.equal((await getDocsFromServer(collection(db, 'users', uid, 'chatBox'))).size, 1);
        assert.equal((await getDocFromServer(doc(db, 'users', uid, 'chatGroupBox', groupId))).get('muted'), false);
      }
      assert.equal((await getDocFromServer(doc(client(pilot, bob), invite))).get('status'), 'accepted');
    });

    await t.test('desligar as flags fecha as consultas do piloto com os dados presentes', async () => {
      await seed(pilot, pilotFlags());
      await assertClosed(pilot);
      await assertDocumentsRemain(pilot);
    });

    await t.test('a revisão de encerramento mantém o bloqueio após trocar as Rules', async () => {
      closed = await connect(shutdownRules);
      await assertClosed(closed);
      await assertDocumentsRemain(closed);
    });

    await t.test('flags antigas ligadas não reabrem as leituras nas Rules de encerramento', async () => {
      await seed(closed, pilotFlags(true));
      try {
        await assertClosed(closed);
      } finally {
        await seed(closed, pilotFlags());
      }
      await closed.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        for (const [path] of pilotFlags()) {
          const snapshot = await getDocFromServer(doc(db, path));
          assert.equal(snapshot.get('enabled'), false);
          assert.equal(snapshot.get('minorPolicyApproved'), false);
        }
      });
    });

    await t.test('protocolos anteriores ficam privados e imutáveis', async () => {
      const a = client(closed, alice);
      const b = client(closed, bob);
      const mod = client(closed, moderator);
      for (const [path] of reports) {
        assert.ok((await getDocFromServer(doc(b, path))).exists());
        // Atendimento autorizado por caso usa backend e auditoria, nao SDK.
        await assertFails(getDocFromServer(doc(mod, path)));
        await assertFails(getDocFromServer(doc(a, path)));
        await assertFails(getDocsFromServer(collection(b, path.split('/')[0])));
        await assertFails(updateDoc(doc(mod, path), {reason: 'Alteração fora do protocolo.'}));
      }
    });

    await t.test('Fórum e Avisos seguem funcionando após a troca das Rules', async () => {
      const a = client(closed, alice);
      const b = client(closed, bob);
      const postId = 'qa-forum-apos-encerramento';
      const noticeId = 'resposta-apos-encerrar';
      const post = doc(b, 'posts', postId);
      await setDoc(post, {uid: bob.uid, authorName: bob.name, title: 'Discussão de QA',
        body: 'Conteúdo fictício de teste.', category: 'Vida espiritual', createdAt: serverTimestamp()});
      const feed = await getDocsFromServer(query(collection(a, 'posts'), orderBy('createdAt', 'desc'), limit(21)));
      assert.ok(feed.docs.some(item => item.id === postId));

      const noticePath = `users/${bob.uid}/notifications/${noticeId}`;
      const batch = writeBatch(a);
      batch.set(doc(a, 'posts', postId, 'replies', noticeId), {
        uid: alice.uid, authorName: alice.name, body: 'Resposta fictícia.', createdAt: serverTimestamp()
      });
      batch.set(doc(a, noticePath), {
        postId, replyId: noticeId, actorUid: alice.uid, actorName: alice.name,
        read: false, createdAt: serverTimestamp()
      });
      await batch.commit();
      assert.ok((await getDocFromServer(doc(b, 'posts', postId, 'replies', noticeId))).exists());
      const notifications = await getDocsFromServer(query(
        collection(b, 'users', bob.uid, 'notifications'), orderBy('createdAt', 'desc'), limit(21)));
      assert.ok(notifications.docs.some(item => item.id === noticeId && item.get('read') === false));
      await assertFails(getDocFromServer(doc(a, noticePath)));
      await updateDoc(doc(b, noticePath), {read: true});
      assert.equal((await getDocFromServer(doc(b, noticePath))).get('read'), true);
      await assertDocumentsRemain(closed);
    });
  } finally {
    if (closed) await closed.cleanup();
    await pilot.cleanup();
  }
});
