import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,updateDoc,deleteDoc,writeBatch,serverTimestamp,Timestamp} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-atrio-v09',firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}});
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
const admin=env.authenticatedContext('admin').firestore();
const alice=env.authenticatedContext('alice').firestore();
const bob=env.authenticatedContext('bob').firestore();
const anon=env.unauthenticatedContext().firestore();
const review=(status='dismissed',by='admin')=>({status,reviewedBy:by,reviewedAt:serverTimestamp(),reviewNote:'Análise de teste'});
const report=(id='p')=>({postId:id,reporterUid:'bob',reason:'Motivo para revisão',createdAt:serverTimestamp()});
try {
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'admins/admin'),{enabled:true});
  await setDoc(doc(db,'profiles/alice'),{displayName:'Alice',createdAt:Timestamp.now()});
  await setDoc(doc(db,'profiles/bob'),{displayName:'Bob',createdAt:Timestamp.now()});
  for(const id of ['p','p2','p3'])await setDoc(doc(db,'posts/'+id),{uid:'alice',authorName:'Alice',title:'Título teste',body:'Conteúdo de teste',category:'Liturgia',createdAt:Timestamp.now()});
 });
 await test('anônimo não lê denúncias',()=>assertFails(getDocs(collection(anon,'reports'))));
 await test('usuário envia denúncia antiga sem status',()=>assertSucceeds(setDoc(doc(bob,'reports/r'),report())));
 await test('usuário não lê a própria denúncia',()=>assertFails(getDoc(doc(bob,'reports/r'))));
 await test('usuário não lista denúncias',()=>assertFails(getDocs(collection(bob,'reports'))));
 await test('usuário consulta somente seu registro de acesso',()=>assertSucceeds(getDoc(doc(bob,'admins/bob'))));
 await test('usuário não lê acesso de outra conta',()=>assertFails(getDoc(doc(bob,'admins/admin'))));
 await test('usuário não se promove',()=>assertFails(setDoc(doc(bob,'admins/bob'),{enabled:true})));
 await test('administrador não promove contas pelo cliente',()=>assertFails(setDoc(doc(admin,'admins/bob'),{enabled:true})));
 await test('administrador não altera seu acesso pelo cliente',()=>assertFails(updateDoc(doc(admin,'admins/admin'),{enabled:false})));
 await test('administrador consulta denúncias',()=>assertSucceeds(getDocs(collection(admin,'reports'))));
 await test('usuário não exclui publicação alheia',()=>assertFails(deleteDoc(doc(bob,'posts/p'))));
 await test('usuário não encerra denúncia',()=>assertFails(updateDoc(doc(bob,'reports/r'),review('dismissed','bob'))));
 await test('autor mantém edição própria',()=>assertSucceeds(updateDoc(doc(alice,'posts/p'),{body:'Conteúdo revisado pelo autor'})));
 await test('administrador não reescreve texto alheio',()=>assertFails(updateDoc(doc(admin,'posts/p'),{body:'Texto de outra pessoa'})));
 await test('denunciante não insere decisão pronta',()=>assertFails(setDoc(doc(bob,'reports/fake'),{...report(),...review()})));
 await test('administrador não forja identidade do revisor',()=>assertFails(updateDoc(doc(admin,'reports/r'),review('dismissed','bob'))));
 await test('administrador não altera motivo da denúncia',()=>assertFails(updateDoc(doc(admin,'reports/r'),{...review(),reason:'Outro motivo'})));
 await test('decisão exige justificativa válida',()=>assertFails(updateDoc(doc(admin,'reports/r'),{...review(),reviewNote:'x'})));
 await test('remoção exige que publicação deixe de existir',()=>assertFails(updateDoc(doc(admin,'reports/r'),review('removed'))));
 await test('remoção e decisão atômicas autorizadas',async()=>{
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p'));b.update(doc(admin,'reports/r'),review('removed'));await assertSucceeds(b.commit());
  assert.equal((await getDoc(doc(admin,'posts/p'))).exists(),false);
  assert.equal((await getDoc(doc(admin,'reports/r'))).data().status,'removed');
 });
 await test('decisão concluída é imutável',()=>assertFails(updateDoc(doc(admin,'reports/r'),review())));
 await test('registro de denúncia não pode ser apagado',()=>assertFails(deleteDoc(doc(admin,'reports/r'))));
 await setDoc(doc(bob,'reports/r2'),report('p2'));
 await test('encerrar sem remoção mantém publicação',async()=>{
  await assertSucceeds(updateDoc(doc(admin,'reports/r2'),review()));assert.equal((await getDoc(doc(alice,'posts/p2'))).exists(),true);
 });
 await test('resposta e aviso da v07 continuam funcionando',async()=>{
  const b=writeBatch(bob);b.set(doc(bob,'posts/p2/replies/answer'),{uid:'bob',authorName:'Bob',body:'Resposta de teste',createdAt:serverTimestamp()});
  b.set(doc(bob,'users/alice/notifications/answer'),{postId:'p2',replyId:'answer',actorUid:'bob',actorName:'Bob',read:false,createdAt:serverTimestamp()});await assertSucceeds(b.commit());
 });
 await test('administrador não lê biografia privada alheia',()=>assertFails(getDoc(doc(admin,'profiles/alice'))));
 await test('autor ainda exclui sua publicação',()=>assertSucceeds(deleteDoc(doc(alice,'posts/p3'))));
 await env.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore(),'admins/admin'),{enabled:false}));
 await test('revogação impede consulta de denúncias',()=>assertFails(getDocs(collection(admin,'reports'))));
 await test('revogação impede remoção alheia',()=>assertFails(deleteDoc(doc(admin,'posts/p2'))));
 console.log(`RESULTADO: ${passed} testes aprovados.`);
} finally { await env.cleanup(); }
