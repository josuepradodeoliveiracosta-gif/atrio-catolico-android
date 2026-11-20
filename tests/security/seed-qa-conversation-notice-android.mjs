import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc, writeBatch} from 'firebase/firestore';
import {alice, bob, projectId} from '../../firebase/qa-geral-celular/pilot/fixtures.mjs';
import {conversationPushPilot, conversationPushPilotDocuments}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-fixtures.mjs';
import {renderConversationPushPilotRules}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-rules.mjs';

const auth = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const password = 'GrupoQa2026!Emulador'; // Exclusivo do Auth Emulator.
const users = [alice, bob].map(({uid, email, name}) => ({
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
try {
  const now = new Date();
  const rows = new Map(conversationPushPilotDocuments(now));
  const chatId = conversationPushPilot.conversationId;
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
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (const [path, data] of rows) batch.set(doc(db, path), data);
    await batch.commit();
  });
  console.log('Rules SHA-256 do laboratório de avisos:', createHash('sha256').update(rules).digest('hex'));
} finally {
  await env.cleanup();
}
