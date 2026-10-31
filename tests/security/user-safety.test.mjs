/** Firestore emulator QA only: user report and member block security. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,setDoc,getDoc,getDocs,updateDoc,deleteDoc,serverTimestamp,Timestamp} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}});
const alice=env.authenticatedContext('ugc-alice').firestore();
const bob=env.authenticatedContext('ugc-bob').firestore();
const admin=env.authenticatedContext('ugc-admin').firestore();
const guest=env.authenticatedContext('ugc-other').firestore();
const anon=env.unauthenticatedContext().firestore();
const block=(db,a,b)=>doc(db,'users/'+a+'/blockedMembers/'+b);
const report=(db,a,b,reason='Comportamento inadequado para revisão')=>setDoc(
  doc(db,'user_reports/'+a+'_user_'+b),{
    reporterUid:a,targetUid:b,reason,createdAt:serverTimestamp()
  });
const reply=(db,post,id,uid,name)=>setDoc(doc(db,'posts/'+post+'/replies/'+id),
  {uid,authorName:name,body:'Resposta de teste',createdAt:serverTimestamp()});
let passed=0;
const test=async(label,fn)=>{await fn();passed++;console.log('PASS UGC',label)};
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'admins/ugc-admin'),{enabled:true});
    for(const [uid,name] of [['ugc-alice','Alice'],['ugc-bob','Bob']]){
      await setDoc(doc(db,'profiles/'+uid),{displayName:name,createdAt:Timestamp.now()});
      await setDoc(doc(db,'posts/p-'+uid),{uid,authorName:name,
        title:'Título de teste',body:'Conteúdo de teste',category:'Liturgia',
        createdAt:Timestamp.now()});
    }
  });
  await test('interacao antes do bloqueio',async()=>{
    await assertSucceeds(reply(bob,'p-ugc-alice','before','ugc-bob','Bob'));
    await assertSucceeds(reply(alice,'p-ugc-bob','before','ugc-alice','Alice'));
  });
  const engagement=(db,kind,uid,postId)=>doc(db,'users/'+uid+'/'+kind+'/'+postId);
  const reaction=(db,postId,replyId,uid)=>doc(db,
    'posts/'+postId+'/replies/'+replyId+'/reactions/'+uid);
  await test('interacoes permitidas antes de bloquear e reversiveis',async()=>{
    for(const kind of ['likedPosts','savedPosts','followedPosts']){
      const target=engagement(bob,kind,'ugc-bob','p-ugc-alice');
      await assertSucceeds(setDoc(target,{createdAt:serverTimestamp()}));
      await assertSucceeds(deleteDoc(target));
    }
    const target=reaction(bob,'p-ugc-alice','before','ugc-bob');
    await assertSucceeds(setDoc(target,{kind:'heart',createdAt:serverTimestamp()}));
    await assertSucceeds(deleteDoc(target));
  });
  await test('bloqueio do titular',()=>assertSucceeds(setDoc(
    block(alice,'ugc-alice','ugc-bob'),{createdAt:serverTimestamp()})));
  await test('bloqueio lido apenas pelo titular',async()=>{
    await assertSucceeds(getDoc(block(alice,'ugc-alice','ugc-bob')));
    await assertFails(getDoc(block(bob,'ugc-alice','ugc-bob')));
    await assertFails(getDoc(block(anon,'ugc-alice','ugc-bob')));
    await assertSucceeds(getDocs(collection(alice,'users/ugc-alice/blockedMembers')));
    await assertFails(getDocs(collection(bob,'users/ugc-alice/blockedMembers')));
  });
  await test('bloqueio reciproco impede resposta ao post',async()=>{
    await assertFails(reply(bob,'p-ugc-alice','blocked-b','ugc-bob','Bob'));
    await assertFails(reply(alice,'p-ugc-bob','blocked-a','ugc-alice','Alice'));
  });
  await test('bloqueio tambem impede curtidas, salvos, seguir e reacoes',async()=>{
    for(const kind of ['likedPosts','savedPosts','followedPosts']){
      await assertFails(setDoc(engagement(bob,kind,'ugc-bob','p-ugc-alice'),{
        createdAt:serverTimestamp()
      }));
    }
    await assertFails(setDoc(reaction(bob,'p-ugc-alice','before','ugc-bob'),{
      kind:'heart',createdAt:serverTimestamp()
    }));
  });
  await test('nao bloquear em nome de terceiro',()=>assertFails(setDoc(
    block(guest,'ugc-alice','ugc-other'),{createdAt:serverTimestamp()})));
  await test('nao bloquear propria conta',()=>assertFails(setDoc(
    block(bob,'ugc-bob','ugc-bob'),{createdAt:serverTimestamp()})));
  await test('nao aceitar horario forjado nem campos extras',async()=>{
    await assertFails(setDoc(block(bob,'ugc-bob','ugc-other'),{
      createdAt:Timestamp.fromMillis(1000)}));
    await assertFails(setDoc(block(bob,'ugc-bob','ugc-other'),{
      createdAt:serverTimestamp(),admin:true}));
  });
  await test('nao alterar bloqueio ja criado',()=>assertFails(updateDoc(
    block(alice,'ugc-alice','ugc-bob'),{createdAt:serverTimestamp()})));
  await test('bloqueio unilateral continua ativo',async()=>{
    await assertSucceeds(setDoc(block(bob,'ugc-bob','ugc-alice'),{
      createdAt:serverTimestamp()}));
    await assertSucceeds(deleteDoc(block(alice,'ugc-alice','ugc-bob')));
    await assertFails(reply(alice,'p-ugc-bob','reverse','ugc-alice','Alice'));
  });
  await test('desbloqueio bilateral restaura resposta',async()=>{
    await assertSucceeds(deleteDoc(block(bob,'ugc-bob','ugc-alice')));
    await assertSucceeds(reply(alice,'p-ugc-bob','after','ugc-alice','Alice'));
  });
  await test('desbloqueio permite curtida, salvar, seguir e reagir novamente',async()=>{
    for(const kind of ['likedPosts','savedPosts','followedPosts']){
      await assertSucceeds(setDoc(engagement(bob,kind,'ugc-bob','p-ugc-alice'),{
        createdAt:serverTimestamp()
      }));
    }
    await assertSucceeds(setDoc(reaction(bob,'p-ugc-alice','before','ugc-bob'),{
      kind:'heart',createdAt:serverTimestamp()
    }));
  });
  await test('denuncia autenticada de usuario',()=>assertSucceeds(report(bob,'ugc-bob','ugc-alice')));
  await test('nao sobrescrever denuncia',()=>assertFails(report(bob,'ugc-bob','ugc-alice','Texto alterado')));
  await test('nao denunciar a si mesmo',()=>assertFails(report(alice,'ugc-alice','ugc-alice')));
  await test('nao forjar identidade do denunciante',()=>assertFails(report(bob,'ugc-alice','ugc-other')));
  await test('nao aceitar motivo curto',()=>assertFails(report(alice,'ugc-alice','ugc-bob','não')));
  await test('denuncia privada de todos exceto moderador',async()=>{
    const path='user_reports/ugc-bob_user_ugc-alice';
    await assertFails(getDoc(doc(alice,path)));
    await assertFails(getDoc(doc(bob,path)));
    await assertFails(getDocs(collection(guest,'user_reports')));
    const snap=await assertSucceeds(getDoc(doc(admin,path)));
    assert.equal(snap.data().targetUid,'ugc-alice');
    await assertSucceeds(getDocs(collection(admin,'user_reports')));
  });
  await test('somente moderador decide com auditoria',async()=>{
    const path='user_reports/ugc-bob_user_ugc-alice';
    await assertFails(updateDoc(doc(bob,path),{status:'dismissed'}));
    await assertSucceeds(updateDoc(doc(admin,path),{
      status:'reviewed',reviewedBy:'ugc-admin',reviewedAt:serverTimestamp(),
      reviewNote:'Relato analisado e providências registradas'}));
    await assertFails(updateDoc(doc(admin,path),{status:'dismissed'}));
    await assertFails(deleteDoc(doc(admin,path)));
  });
  console.log('OK: '+passed+' testes UGC no Firestore Emulator, sem serviços reais');
}finally{await env.cleanup()}
