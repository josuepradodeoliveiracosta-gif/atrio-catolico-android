/**
 * Perfis de outros membros. Todos os testes usam somente o emulador Firestore.
 * A coleção privada /profiles continua proibida para terceiros.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {
  doc, collection, setDoc, updateDoc, getDoc, getDocs, deleteDoc, writeBatch, serverTimestamp, Timestamp
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-atrio-v11',
  firestore: {host: '127.0.0.1', port: 8089, rules: readFileSync('firestore.rules', 'utf8')}
});
const alice = env.authenticatedContext('public-alice').firestore();
const bob = env.authenticatedContext('public-bob').firestore();
const anon = env.unauthenticatedContext().firestore();
const privatePath = 'profiles/public-alice';
const publicPath = 'public_profiles/public-alice';
let count = 0;
async function check(name, test) { await test(); count++; console.log('PASS PUBLIC PROFILE', name); }

try {
  await env.clearFirestore();
  await check('titular cria perfil privado', () => assertSucceeds(setDoc(doc(alice,privatePath),{
    displayName: 'Alice Católica', createdAt: serverTimestamp()
  })));
  await check('titular atualiza apresentação privada', () => assertSucceeds(updateDoc(doc(alice,privatePath),{
    bio: 'Apresentação de teste do Átrio'
  })));
  await check('outro membro não lê bio privada', () => assertFails(getDoc(doc(bob,privatePath))));
  await check('anônimo não lê perfil privado', () => assertFails(getDoc(doc(anon,privatePath))));
  const joinedAt = (await assertSucceeds(getDoc(doc(alice,privatePath)))).data().createdAt;
  const publicData = {
    displayName: 'Alice Católica', bio: 'Apresentação de teste do Átrio',
    joinedAt, updatedAt: serverTimestamp()
  };
  await check('terceiro não publica em nome da titular', () => assertFails(setDoc(doc(bob,publicPath),publicData)));
  await check('titular não pode publicar e-mail ou CPF', () => assertFails(setDoc(doc(alice,publicPath),{
    ...publicData, email: 'privado@example.test', cpf: '00000000000'
  })));
  await check('titular não pode forjar nome', () => assertFails(setDoc(doc(alice,publicPath),{
    ...publicData, displayName: 'Falso fundador'
  })));
  await check('titular não pode forjar data de entrada', () => assertFails(setDoc(doc(alice,publicPath),{
    ...publicData, joinedAt: Timestamp.fromMillis(1000)
  })));
  await check('titular publica dados permitidos com opt-in', () => assertSucceeds(setDoc(doc(alice,publicPath),publicData)));
  await check('outro membro consulta apenas projeção pública', async () => {
    const publicDoc = await assertSucceeds(getDoc(doc(bob,publicPath)));
    assert.equal(publicDoc.data().bio, 'Apresentação de teste do Átrio');
    assert.deepEqual(Object.keys(publicDoc.data()).sort(),
      ['displayName','bio','joinedAt','updatedAt'].sort());
  });
  await check('anônimo não consulta apresentação pública', () => assertFails(getDoc(doc(anon,publicPath))));
  await check('ninguém enumera coleção pública', () => assertFails(getDocs(collection(bob,'public_profiles'))));
  await check('titular não injeta selo na projeção', () => assertFails(updateDoc(doc(alice,publicPath), {clergy:'padre'})));
  await check('titular revoga publicação', () => assertSucceeds(deleteDoc(doc(alice,publicPath))));
  await check('recurso revogado deixa de aparecer', async () => {
    const result = await assertSucceeds(getDoc(doc(bob,publicPath)));
    assert.equal(result.exists(), false);
  });
  await check('terceiro não apaga publicação alheia', async () => {
    await assertSucceeds(setDoc(doc(alice,publicPath),publicData));
    await assertFails(deleteDoc(doc(bob,publicPath)));
  });
  await check('biografia pública não pode antecipar a edição privada', () => assertFails(
    updateDoc(doc(alice, publicPath), {bio: 'Apresentação adulterada'})
  ));
  await check('nome e bio são atualizados atomicamente no perfil privado e público', async () => {
    const batch = writeBatch(alice);
    batch.update(doc(alice, privatePath), {
      displayName: 'Alice Atualizada', bio: 'Nova apresentação aprovada'
    });
    batch.set(doc(alice, publicPath), {
      displayName: 'Alice Atualizada', bio: 'Nova apresentação aprovada',
      joinedAt, updatedAt: serverTimestamp()
    });
    await assertSucceeds(batch.commit());
    const privateProfile = await assertSucceeds(getDoc(doc(alice, privatePath)));
    const publicProfile = await assertSucceeds(getDoc(doc(bob, publicPath)));
    assert.equal(privateProfile.data().displayName, publicProfile.data().displayName);
    assert.equal(privateProfile.data().bio, publicProfile.data().bio);
    assert.equal(publicProfile.data().bio, 'Nova apresentação aprovada');
  });
  await check('lote inválido não altera perfil privado parcialmente', async () => {
    const batch = writeBatch(alice);
    batch.update(doc(alice, privatePath), {
      displayName: 'Nome que deve falhar', bio: 'Bio que deve falhar'
    });
    batch.set(doc(alice, publicPath), {
      displayName: 'Nome que deve falhar', bio: 'Bio que deve falhar',
      joinedAt, updatedAt: serverTimestamp(), email: 'nao-pode@example.test'
    });
    await assertFails(batch.commit());
    const privateProfile = await assertSucceeds(getDoc(doc(alice, privatePath)));
    assert.equal(privateProfile.data().displayName, 'Alice Atualizada');
    assert.equal(privateProfile.data().bio, 'Nova apresentação aprovada');
  });
  console.log(`OK: ${count} verificações de perfil público concluídas`);
} finally { await env.cleanup(); }
