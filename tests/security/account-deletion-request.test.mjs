/**
 * Solicitações de exclusão: apenas registro, sem apagar Auth ou Firestore.
 * Todos os acessos acontecem no emulador Firestore, nunca em produção.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {
  doc, collection, setDoc, updateDoc, getDoc, getDocs, deleteDoc,
  serverTimestamp, Timestamp
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-atrio-v11',
  firestore: {host: '127.0.0.1', port: 8089, rules: readFileSync('firestore.rules','utf8')}
});
const alice = env.authenticatedContext('delete-alice').firestore();
const bob = env.authenticatedContext('delete-bob').firestore();
const anon = env.unauthenticatedContext().firestore();
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
  await check('não permite origem diferente', () =>
    assertFails(setDoc(doc(alice,path), {...valid(),source:'web'})));
  await check('titular cria solicitação válida', () =>
    assertSucceeds(setDoc(doc(alice,path),valid())));
  await check('titular consulta próprio pedido e data de solicitação', async () => {
    const x = await assertSucceeds(getDoc(doc(alice,path)));
    assert.equal(x.data().status,'requested');
    assert.equal(x.data().source,'android');
    assert.deepEqual(Object.keys(x.data()).sort(),['status','source','requestedAt'].sort());
    assert.ok(x.data().requestedAt);
  });
  await check('outro usuário não consulta pedido',()=>assertFails(getDoc(doc(bob,path))));
  await check('anônimo não consulta pedido',()=>assertFails(getDoc(doc(anon,path))));
  await check('não enumera pedidos de outros usuários',()=>assertFails(
    getDocs(collection(alice,'account_deletion_requests'))));
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
