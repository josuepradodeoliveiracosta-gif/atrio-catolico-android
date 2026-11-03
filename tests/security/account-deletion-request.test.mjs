/**
 * Solicitações de exclusão: apenas registro, sem apagar Auth ou Firestore.
 * Todos os acessos acontecem no emulador Firestore, nunca em produção.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {
  doc, collection, query, orderBy, limit, setDoc, updateDoc, getDoc, getDocs, deleteDoc,
  serverTimestamp, Timestamp
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-atrio-v11',
  firestore: {host: '127.0.0.1', port: 8089, rules: readFileSync('firestore.rules','utf8')}
});
const alice = env.authenticatedContext('delete-alice').firestore();
const bob = env.authenticatedContext('delete-bob').firestore();
const anon = env.unauthenticatedContext().firestore();
const founder = env.authenticatedContext('delete-founder').firestore();
const moderator = env.authenticatedContext('delete-moderator').firestore();
const queue = (db, size=20) => query(collection(db, 'account_deletion_requests'),
  orderBy('requestedAt', 'desc'), limit(size));
const path = 'account_deletion_requests/delete-alice';
const valid = () => ({status: 'requested', source: 'android', requestedAt: serverTimestamp()});
let n = 0;
async function check(label, call) {await call(); n++; console.log('PASS ACCOUNT DELETION', label);}

try {
  await env.clearFirestore();
  await check('anônimo não cria solicitação', () => assertFails(setDoc(doc(anon, path), valid())));
  await check('outro usuário não solicita exclusão da Alice', () => assertFails(setDoc(doc(bob,path),valid())));
  await check('não permite campos arbitrários, emails, UID injetado', () =>
    assertFails(setDoc(doc(alice,path), {...valid(), email:'alice@example.test'})));
  await check('não permite forjar data', () =>
    assertFails(setDoc(doc(alice,path), {status:'requested',source:'android',requestedAt:Timestamp.fromMillis(1000)})));
  await check('não permite marcar conta como excluída', () =>
    assertFails(setDoc(doc(alice,path), {...valid(),status:'completed'})));
  await check('não permite origem diferente do app ou web', () =>
    assertFails(setDoc(doc(alice,path), {...valid(),source:'external'})));
  await check('anônimo não cria solicitação pela web', () =>
    assertFails(setDoc(doc(anon, path), {...valid(),source:'web'})));
  await check('outro usuário não solicita pela web em nome da Alice', () =>
    assertFails(setDoc(doc(bob, path), {...valid(),source:'web'})));
  await check('titular cria solicitação válida', () =>
    assertSucceeds(setDoc(doc(alice,path),valid())));
  await check('titular consulta próprio pedido e data de solicitação', async () => {
    const x = await assertSucceeds(getDoc(doc(alice,path)));
    assert.equal(x.data().status,'requested');
    assert.equal(x.data().source,'android');
    assert.deepEqual(Object.keys(x.data()).sort(),['status','source','requestedAt'].sort());
    assert.ok(x.data().requestedAt);
  });
  await check('titular registra pedido pela web com autenticação Firebase', async () => {
    await assertSucceeds(setDoc(doc(bob,'account_deletion_requests/delete-bob'),
      {...valid(), source:'web'}));
    const result = await assertSucceeds(getDoc(doc(bob,'account_deletion_requests/delete-bob')));
    assert.equal(result.data().source,'web');
    assert.equal(result.data().status,'requested');
  });
  await check('mesmo usuário não pode substituir pedido web', () =>
    assertFails(setDoc(doc(bob,'account_deletion_requests/delete-bob'),
      {...valid(), source:'web'})));
  await check('outro usuário não consulta pedido',()=>assertFails(getDoc(doc(bob,path))));
  await check('anônimo não consulta pedido',()=>assertFails(getDoc(doc(anon,path))));
  await check('não enumera pedidos de outros usuários',()=>assertFails(
    getDocs(collection(alice,'account_deletion_requests'))));
  // O fundador só pode LER uma página limitada. O app não processa a exclusão.
  await env.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    await setDoc(doc(admin,'admins/delete-founder'),{enabled:true});
    await setDoc(doc(admin,'admins/delete-moderator'),{enabled:true});
    await setDoc(doc(admin,'app_config/founder'),{uid:'delete-founder'});
  });
  await check('fundador administrador consulta fila paginada', async () => {
    const snapshot = await assertSucceeds(getDocs(queue(founder)));
    assert.deepEqual(snapshot.docs.map(d=>d.id).sort(), ['delete-alice','delete-bob']);
  });
  await check('titulares, anônimo e moderador comum não enumeram pedidos', async () => {
    await assertFails(getDocs(queue(alice)));
    await assertFails(getDocs(queue(bob)));
    await assertFails(getDocs(queue(anon)));
    await assertFails(getDocs(queue(moderator)));
  });
  await check('fundador não lista sem limite nem acima de 20', async () => {
    await assertFails(getDocs(collection(founder,'account_deletion_requests')));
    await assertFails(getDocs(queue(founder,21)));
  });
  await check('fundador não pode ler individualmente nem alterar pedidos alheios', async () => {
    await assertFails(getDoc(doc(founder,path)));
    await assertFails(updateDoc(doc(founder,path),{status:'completed'}));
    await assertFails(deleteDoc(doc(founder,path)));
  });
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(),'admins/delete-founder'),{enabled:false});
  });
  await check('revogação de admin interrompe a consulta da fila',()=>
    assertFails(getDocs(queue(founder))));
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(),'admins/delete-founder'),{enabled:true});
    await setDoc(doc(context.firestore(),'account_deletion_freeze/delete-founder'),{state:'frozen'});
  });
  await check('fundador congelado não consulta pedidos',()=>
    assertFails(getDocs(queue(founder))));
  await check('pedido duplicado não substitui o anterior',()=>assertFails(
    setDoc(doc(alice,path),valid())));
  await check('usuário não encerra nem altera o status do pedido',()=>assertFails(
    updateDoc(doc(alice,path),{status:'processed'})));
  await check('usuário não pode apagar o registro',()=>assertFails(deleteDoc(doc(alice,path))));
  await check('terceiro não altera um pedido',()=>assertFails(
    updateDoc(doc(bob,path),{status:'processed'})));
  console.log('OK: ' + n + ' testes de solicitação de exclusão');
} finally {
  await env.cleanup();
}
