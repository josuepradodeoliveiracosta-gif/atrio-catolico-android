import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {deleteApp, initializeApp} from 'firebase-admin/app';
import {FieldValue, getFirestore} from 'firebase-admin/firestore';
import {alice, bob, projectId} from '../../firebase/qa-geral-celular/pilot/fixtures.mjs';
import {createConversationPushAdminService}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-admin.mjs';
import {conversationPushPilot, conversationPushPilotDocuments}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-fixtures.mjs';
import {renderConversationPushPilotRules}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-rules.mjs';

const auth = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
assert.equal(projectId, 'demo-atrio-v11');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089';
const password = 'GrupoQa2026!Emulador'; // Exclusivo do Auth Emulator.
const lucia = {uid:'qa-nav-lucia',email:'lucia.navegacao@qa.invalid',name:'Lúcia — fora da admissão'};
// Clara=Alice e Miguel=Bob são os titulares da conversa; Lúcia é controle negativo.
const users = [alice, bob, lucia].map(({uid, email, name}) => ({
  localId: uid, email, emailVerified: true, displayName: name, rawPassword: password
}));
if (!process.argv.includes('--firestore-only')) {
  const imported = await fetch(auth + '/projects/' + projectId + '/accounts:batchCreate', {
    method: 'POST',
    headers: {Authorization: 'Bearer owner', 'Content-Type': 'application/json'},
    body: JSON.stringify({users}),
    signal: AbortSignal.timeout(10_000)
  });
  assert.ok(imported.ok, 'Identidades fictícias recusadas pelo Auth Emulator');
  assert.deepEqual((await imported.json()).error ?? [], []);
}

const rules = renderConversationPushPilotRules();
const env = await initializeTestEnvironment({
  projectId, firestore: {host: '127.0.0.1', port: 8089, rules}
});
const adminApp = initializeApp({projectId}, 'qa-notice-android');
try {
  const db = getFirestore(adminApp);
  const admin = createConversationPushAdminService({
    db,
    serverTimestamp: () => FieldValue.serverTimestamp(),
    authorize: (principal, capability) => principal.capability === capability,
  });
  const {conversationId: chatId, messageId, roundId} = conversationPushPilot;
  const admissionPath = uid => 'users/' + uid + '/chatPushAdmission/current';
  const pendingPath = 'users/' + bob.uid + '/chatPushPending/current';
  const expiresAt = new Date(Date.now() + 4 * 60_000);
  const now = new Date();
  const rows = new Map(conversationPushPilotDocuments(now));
  const proofBatch = db.batch();
  for (const {uid} of [alice, bob]) {
    const path = 'users/' + uid + '/chatAgeEligibility/current';
    proofBatch.set(db.doc(path), rows.get(path));
    rows.delete(path);
  }
  await proofBatch.commit();
  const grant = async uid => {
    const admission = await db.doc(admissionPath(uid)).get();
    return admin.admit({
      uid, operationKey: randomUUID(), expiresAt,
      expectedGeneration: admission.data()?.generation ?? null,
      principal: {capability: 'manage_admissions'},
    });
  };
  const [sender, recipient] = await Promise.all([grant(alice.uid), grant(bob.uid)]);
  // O serviço exige que a mensagem seja posterior às duas admissões no relógio do Emulator.
  await delay(10);
  rows.delete(admissionPath(alice.uid));
  rows.delete(admissionPath(bob.uid));
  rows.delete(pendingPath);
  rows.get('chats/' + chatId + '/messages/' + messageId).createdAt = FieldValue.serverTimestamp();
  const room = rows.get('chats/' + chatId);
  rows.set('users/' + bob.uid + '/chatInboxByPeer/' + alice.uid + '/entries/' + chatId, {
    ownerUid: bob.uid, peerUid: alice.uid, chatId, status: room.status,
    lastPreview: room.lastPreview, updatedAt: now
  });
  rows.set('posts/qa-nav-alice-notice', {
    uid: alice.uid, authorName: alice.name, title: 'Publicação fictícia para o teste de avisos',
    body: 'Publicação de QA para abrir o perfil e a conversa manualmente.',
    category: 'Vida espiritual', createdAt: now
  });
  const batch = db.batch();
  for (const [path, data] of rows) batch.set(db.doc(path), data);
  // Cada classe Android repete a mesma mensagem da fixture em um cenário independente.
  const receipt = createHash('sha256').update(JSON.stringify([roundId, chatId, messageId])).digest('hex');
  batch.delete(db.doc('users/' + bob.uid + '/chatPushPublicationReceipts/' + receipt));
  batch.delete(db.doc(pendingPath));
  await batch.commit();
  const publication = await admin.publish({
    senderUid: alice.uid, recipientUid: bob.uid, conversationId: chatId, messageId, expiresAt,
    expectedSenderGeneration: sender.generation, expectedRecipientGeneration: recipient.generation,
    principal: {capability: 'publish_notices'},
  });
  assert.equal(publication.replay, false);
  console.log('Admissões e aviso fictícios publicados pelo serviço administrativo no Firestore Emulator.');
  console.log('Rules SHA-256 do laboratório de avisos:', createHash('sha256').update(rules).digest('hex'));
} finally {
  await Promise.all([deleteApp(adminApp), env.cleanup()]);
}
