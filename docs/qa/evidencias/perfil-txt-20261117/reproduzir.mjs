// Ensaio local desta análise; não integra nem publica Rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.equal(host, '127.0.0.1:8089', 'Exige Firestore Emulator local na porta 8089');
let passed = 0;
async function check(name, fn) { await fn(); console.log(`PASS REVIEW ${++passed}: ${name}`); }
async function run(rulesFile, action) {
  const env = await initializeTestEnvironment({ projectId: 'demo-atrio-v11',
    firestore: { host: '127.0.0.1', port: 8089, rules: readFileSync(rulesFile, 'utf8') } });
  try { await env.clearFirestore(); await action(env); }
  finally { await env.cleanup(); }
}

await run('firestore.rules', async env => {
  const db = env.authenticatedContext('review-alice', { email: 'alice@example.test', email_verified: true }).firestore();
  const profile = doc(db, 'profiles/review-alice');
  await assertSucceeds(setDoc(profile, { displayName: 'Alice QA', createdAt: serverTimestamp() }));
  await check('Rules atuais recusam identidade nova sem contrato aprovado', () =>
    assertFails(updateDoc(profile, { devotionSaint: 'São José', updatedAt: serverTimestamp() })));
  await check('Rules atuais recusam allowDirectMessages em profiles', () =>
    assertFails(updateDoc(profile, { allowDirectMessages: true, updatedAt: serverTimestamp() })));
  const prefs = doc(db, 'users/review-alice/private/preferences');
  const proposed = { interests: ['Sagrada Escritura'], consentVersion: '2026-11-v1',
    consentAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await check('Payload de interesses do TXT é negado em documento novo', () => assertFails(setDoc(prefs, proposed, {merge: true})));
  await assertSucceeds(setDoc(prefs, { interests: ['Formação'], participation: 'Leigo(a)',
    city: 'Cidade QA', parish: 'Paróquia QA', consentVersion: 'cadastro-v2-2026-11',
    consentAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await check('Merge do TXT também é negado com preferências preexistentes', () => assertFails(setDoc(prefs, proposed, {merge: true})));
  await check('Apagar do TXT remove também cidade, paróquia e participação', async () => {
    const before = (await getDoc(prefs)).data();
    assert.equal(before.parish, 'Paróquia QA');
    await assertSucceeds(deleteDoc(prefs));
    assert.equal((await getDoc(prefs)).exists(), false);
  });
  await check('Rules atuais protegem a data original do perfil', () => assertFails(updateDoc(profile, { createdAt: Timestamp.fromMillis(1000) })));
});

await run('proposal-review.original.rules', async env => {
  const db = env.authenticatedContext('review-alice', { email: 'alice@example.test', email_verified: true }).firestore();
  const profile = doc(db, 'profiles/review-alice');
  await assertSucceeds(setDoc(profile, { displayName: 'Alice QA', bio: '', createdAt: serverTimestamp() }));
  await check('Fragmento do TXT aceita adulterar createdAt privado', () => assertSucceeds(updateDoc(profile, { createdAt: Timestamp.fromMillis(1000) })));
  const pub = doc(db, 'public_profiles/review-alice');
  await check('Fragmento do TXT aceita joinedAt diferente do cadastro', () => assertSucceeds(setDoc(pub, {
    displayName: 'Alice QA', bio: '', joinedAt: Timestamp.fromMillis(2000), updatedAt: serverTimestamp()
  })));
  await assertSucceeds(deleteDoc(pub));
  await check('Fragmento do TXT aceita projeção sem joinedAt', () => assertSucceeds(setDoc(pub, {
    displayName: 'Alice QA', bio: '', updatedAt: serverTimestamp()
  })));
});
console.log(`OK REVIEW: ${passed}/9 verificações concluídas. Sucessos do fragmento original demonstram falhas, não aprovação.`);
