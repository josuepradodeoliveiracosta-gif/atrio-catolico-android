/**
 * Autorização do apoio ao desenvolvedor.
 * Somente Firestore Emulator; não altera dados ou regras de produção.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-atrio-v11',
  firestore: {host: '127.0.0.1', port: 8089, rules: readFileSync('firestore.rules', 'utf8')}
});
const founder = env.authenticatedContext('founder-support-test').firestore();
const other = env.authenticatedContext('other-support-test').firestore();
const admin = env.authenticatedContext('admin-support-test').firestore();
const anon = env.unauthenticatedContext().firestore();
const key = 'app_config/developer_support';
const support = (pixKey = 'chave-apenas-para-teste') => ({
  enabled: true, pixKey, bankName: '', agency: '', account: '',
  message: 'Apoie voluntariamente o desenvolvimento do Átrio',
  updatedBy: 'founder-support-test', updatedAt: serverTimestamp()
});
let checks = 0;
async function check(label, run) { await run(); console.log('PASS APOIO', label); checks++; }

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'app_config/founder'), {uid: 'founder-support-test'});
    await setDoc(doc(db, 'admins/founder-support-test'), {enabled: true});
    await setDoc(doc(db, 'admins/admin-support-test'), {enabled: true});
  });
  await check('membro comum não publica dados', () => assertFails(setDoc(doc(other,key), support())));
  await check('administrador não fundador não publica dados', () => assertFails(setDoc(doc(admin,key), support())));
  await check('fundador administrador publica uma chave de teste', () => assertSucceeds(setDoc(doc(founder,key), support())));
  await check('membro autenticado lê configuração publicada', async () => {
    const snapshot = await assertSucceeds(getDoc(doc(other,key)));
    assert.equal(snapshot.data().pixKey, 'chave-apenas-para-teste');
  });
  await check('anônimo não lê dados', () => assertFails(getDoc(doc(anon,key))));
  await check('ninguém pode enumerar app_config', () => assertFails(getDocs(collection(founder,'app_config'))));
  await check('outro administrador não consegue editar', () =>
    assertFails(updateDoc(doc(admin,key), {message:'Alteração não autorizada'})));
  await check('membro comum não consegue editar', () =>
    assertFails(updateDoc(doc(other,key), {pixKey:'chave-maliciosa'})));
  await check('chave ou banco são necessários ao ativar divulgação', () =>
    assertFails(setDoc(doc(founder,key), support('') )));
  await check('banco incompleto é proibido', () =>
    assertFails(setDoc(doc(founder,key), {...support(''),bankName:'Banco',agency:'123'})));
  await check('campos extras são proibidos', () =>
    assertFails(setDoc(doc(founder,key), {...support(), emailPrivado: 'dado-sensivel'})));
  await check('fundador não altera updatedBy', () =>
    assertFails(setDoc(doc(founder,key), {...support(),updatedBy:'other-support-test'})));
  await check('fundador pode ocultar informações sem apagá-las', () =>
    assertSucceeds(setDoc(doc(founder,key), {...support(),enabled:false})));
  await check('documento público não pode ser excluído pelo cliente', () =>
    assertFails(deleteDoc(doc(founder,key))));
  await check('fundador perde edição ao perder autorização admin', async () => {
    await env.withSecurityRulesDisabled(ctx =>
      setDoc(doc(ctx.firestore(), 'admins/founder-support-test'), {enabled:false})
    );
    await assertFails(setDoc(doc(founder,key),support()));
  });
  console.log(`OK: ${checks} verificações de autorização da seção Apoie o desenvolvedor`);
} finally { await env.cleanup(); }
