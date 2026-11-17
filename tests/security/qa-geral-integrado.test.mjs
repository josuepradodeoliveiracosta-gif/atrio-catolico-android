import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch
} from 'firebase/firestore';

const parity = readFileSync('qa-parity.generated.rules', 'utf8');
assert.ok(parity.includes('BEGIN QA PARITY ADDITIVE'));
assert.equal(parity.split('function signedIn() {\n      return request.auth != null;').length, 2);
assert.equal(parity.split('allow get: if true;').length, 2);

// Aplica a identidade do QA Geral Celular às regras compostas, só em memória.
// As permissões de dono, membro e moderador continuam sendo avaliadas pelo Firestore.
const rules = parity.replace(
  'function signedIn() {\n      return request.auth != null;',
  `function signedIn() {
      return request.auth != null
        && request.auth.token.get('email_verified', false) == true
        && ((request.auth.uid == 'qa-nav-alice'
             && request.auth.token.get('email', '') == 'alice.navegacao@qa.invalid')
          || (request.auth.uid == 'qa-nav-bob'
             && request.auth.token.get('email', '') == 'bob.navegacao@qa.invalid'));`
).replace('allow get: if true;', 'allow get: if signedIn();');

const env = await initializeTestEnvironment({
  projectId: 'demo-atrio-v11',
  firestore: { host: '127.0.0.1', port: 8089, rules }
});

const aliceUid = 'qa-nav-alice';
const bobUid = 'qa-nav-bob';
const aliceEmail = 'alice.navegacao@qa.invalid';
const bobEmail = 'bob.navegacao@qa.invalid';
const alice = env.authenticatedContext(aliceUid, { email: aliceEmail, email_verified: true }).firestore();
const bob = env.authenticatedContext(bobUid, { email: bobEmail, email_verified: true }).firestore();
const wrongEmail = env.authenticatedContext(aliceUid, { email: bobEmail, email_verified: true }).firestore();
const wrongUid = env.authenticatedContext('qa-outsider', { email: aliceEmail, email_verified: true }).firestore();
const unverified = env.authenticatedContext(aliceUid, { email: aliceEmail, email_verified: false }).firestore();
const guest = env.unauthenticatedContext().firestore();

const chatId = aliceUid + '__' + bobUid;
const chat = 'chats/' + chatId;
const group = 'chat_groups/qa-integrado';
const postId = 'qa-post-integrado';
const post = 'posts/' + postId;
const replyId = 'qa-resposta-integrada';
const notice = 'users/' + bobUid + '/notifications/' + replyId;

async function requireDocument(db, path) {
  const result = await assertSucceeds(getDoc(doc(db, path)));
  assert.ok(result.exists(), 'Documento esperado: ' + path);
  return result.data();
}

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const now = Timestamp.now();
    const expiry = Timestamp.fromMillis(now.toMillis() + 86400000);
    const batch = writeBatch(db);
    batch.set(doc(db, 'app_config/opening_video'), { enabled: false });
    batch.set(doc(db, 'app_config/email_verification'), { enabled: true, version: '2026-11-v1' });
    batch.set(doc(db, 'app_config/conversations'), {
      enabled: true, version: '2026-11-v1', minorPolicyApproved: true,
      safetyReviewVersion: '2026-11-safety-v1'
    });
    batch.set(doc(db, 'app_config/chat_groups'), {
      enabled: true, version: '2026-11-groups-v1', minorPolicyApproved: true
    });
    for (const [uid, name] of [[aliceUid, 'Alice QA'], [bobUid, 'Bob QA']]) {
      batch.set(doc(db, 'profiles', uid), {
        displayName: name, bio: 'Biografia privada fictícia.', createdAt: now
      });
      batch.set(doc(db, 'users/' + uid + '/chatAgeEligibility/current'), {
        status: 'eligible', minimumAge: 18, policyVersion: '2026-11-18plus-qa-v1',
        reviewExpiresAt: expiry
      });
    }
    batch.set(doc(db, 'users/' + aliceUid + '/chatGroupAccess/eligibility'), {
      status: 'approved', policyVersion: '2026-11-group-safety-v1', reviewExpiresAt: expiry
    });
    batch.set(doc(db, chat), {
      participants: [aliceUid, bobUid], requesterUid: aliceUid, recipientUid: bobUid, status: 'accepted'
    });
    batch.set(doc(db, chat + '/messages/first'), {
      uid: bobUid, kind: 'text', text: 'Conversa fictícia de QA.', createdAt: now
    });
    batch.set(doc(db, group), {
      ownerUid: aliceUid, memberUids: [aliceUid], adminUids: [aliceUid], status: 'active'
    });
    batch.set(doc(db, group + '/messages/first'), {
      uid: aliceUid, kind: 'text', text: 'Grupo fictício de QA.', createdAt: now
    });
    await batch.commit();
  });

  await requireDocument(alice, 'app_config/opening_video');
  await assertSucceeds(setDoc(doc(bob, post), {
    uid: bobUid, authorName: 'Bob QA', title: 'Discussão fictícia do QA',
    body: 'Texto fictício do ensaio integrado.', category: 'Vida espiritual', createdAt: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(doc(bob, post), {
    title: 'Discussão revisada do QA', body: 'Texto revisado no ensaio integrado.', updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(alice, post), { title: 'Edição de outro autor', updatedAt: serverTimestamp() }));
  await requireDocument(alice, post);
  assert.equal((await assertSucceeds(getDocs(collection(alice, 'posts')))).size, 1);
  for (const marker of ['likedPosts', 'savedPosts']) {
    const path = 'users/' + aliceUid + '/' + marker + '/' + postId;
    await assertSucceeds(setDoc(doc(alice, path), { createdAt: serverTimestamp() }));
    await requireDocument(alice, path);
    await assertFails(getDoc(doc(bob, path)));
  }
  const reply = writeBatch(alice);
  reply.set(doc(alice, post + '/replies/' + replyId), {
    uid: aliceUid, authorName: 'Alice QA', body: 'Resposta fictícia do ensaio.',
    createdAt: serverTimestamp()
  });
  reply.set(doc(alice, notice), {
    postId, replyId, actorUid: aliceUid, actorName: 'Alice QA',
    read: false, createdAt: serverTimestamp()
  });
  await assertSucceeds(reply.commit());
  await requireDocument(bob, notice);
  await assertFails(getDoc(doc(alice, notice)));
  console.log('Fórum: publicação, edição, resposta com aviso e marcadores privados.');

  await requireDocument(alice, 'profiles/' + aliceUid);
  await assertFails(getDoc(doc(bob, 'profiles/' + aliceUid)));
  await assertSucceeds(setDoc(doc(alice, 'badges', aliceUid), { lay: 'leiga' }));
  await requireDocument(bob, 'badges/' + aliceUid);
  const protocol = 'user_reports/' + aliceUid + '__' + bobUid;
  await assertSucceeds(setDoc(doc(alice, protocol), {
    reporterUid: aliceUid, targetUid: bobUid, reason: 'Denúncia fictícia do ensaio integrado.', createdAt: serverTimestamp()
  }));
  await requireDocument(alice, protocol);
  await assertFails(getDoc(doc(bob, protocol)));
  await assertFails(setDoc(doc(alice, 'admins', aliceUid), { enabled: true }));
  console.log('Perfil e denúncias: selo visível, bio privada e protocolo restrito ao autor.');

  await requireDocument(alice, chat + '/messages/first');
  await requireDocument(bob, chat + '/messages/first');
  await requireDocument(alice, group + '/messages/first');
  await assertFails(getDoc(doc(bob, group + '/messages/first')));
  await assertFails(updateDoc(doc(alice, 'app_config/conversations'), { enabled: false }));
  console.log('Conversas e grupos: acesso por elegibilidade e participação.');

  for (const outsider of [wrongEmail, wrongUid, unverified, guest]) {
    for (const path of ['app_config/opening_video', post, chat, group, protocol]) {
      await assertFails(getDoc(doc(outsider, path)));
    }
    await assertFails(setDoc(doc(outsider, 'badges', aliceUid), { lay: 'leigo' }));
  }
  console.log('Isolamento: visitante, conta externa, e-mail divergente e conta não verificada recusados.');
} finally {
  await env.cleanup();
}
