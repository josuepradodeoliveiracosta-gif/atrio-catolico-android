/**
 * Firestore write-freeze regression tests: demo-only, never production.
 * Admin SDK / privileged Worker bypasses rules and MUST enforce its own freeze.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails}
  from '@firebase/rules-unit-testing';
import {
  doc,setDoc,updateDoc,deleteDoc,getDoc,serverTimestamp,writeBatch
} from 'firebase/firestore';

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089' ||
  process.env.GCLOUD_PROJECT!=='demo-atrio-v11' ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  throw Error('freeze_test_requires_local_demo_emulator');

const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}
});
const A='freeze-alice',B='freeze-bob',nameA='Alice de QA',nameB='Bruno de QA';
const alice=env.authenticatedContext(A).firestore();
const bob=env.authenticatedContext(B).firestore();
const anon=env.unauthenticatedContext().firestore();
const marker='account_deletion_freeze/'+A;
const request='account_deletion_requests/'+A;
const postA='posts/qa_freeze_alice_post';
const postB='posts/qa_freeze_bob_post';
const post=(uid,name)=>({
  uid,authorName:name,title:'Discussão segura de teste',
  body:'Conteúdo fictício destinado aos testes de proteção.',
  category:'Vida espiritual',createdAt:serverTimestamp()
});
const reply=(uid,name)=>({
  uid,authorName:name,body:'Resposta de teste.',createdAt:serverTimestamp()
});
const note=(postId,replyId)=>({
  postId,replyId,actorUid:B,actorName:nameB,read:false,createdAt:serverTimestamp()
});
let total=0;
async function check(label,fn){await fn();total++;console.log('PASS WRITE FREEZE',label);}
try{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await setDoc(doc(db,'profiles',A),{displayName:nameA,createdAt:new Date()});
    await setDoc(doc(db,'profiles',B),{displayName:nameB,createdAt:new Date()});
    await setDoc(doc(db,postA),{...post(A,nameA),createdAt:new Date()});
    await setDoc(doc(db,postB),{...post(B,nameB),createdAt:new Date()});
    await setDoc(doc(db,'posts/qa_freeze_bob_post/replies/qa_freeze_alice_old'),{
      ...reply(A,nameA),createdAt:new Date()
    });
    await setDoc(doc(db,'users',A,'notifications','old_notice'),{
      postId:postA.slice(6),replyId:'old_notice',actorUid:B,actorName:nameB,
      read:false,createdAt:new Date()
    });
  });
  await check('pedido próprio permitido e NÃO congela sozinho',async()=>{
    await assertSucceeds(setDoc(doc(alice,request),{
      status:'requested',source:'android',requestedAt:serverTimestamp()
    }));
    await assertSucceeds(setDoc(doc(alice,'posts/qa_before_freeze'),post(A,nameA)));
    await assertSucceeds(updateDoc(doc(alice,'profiles',A),{displayName:'Alice Teste'}));
    await assertSucceeds(getDoc(doc(alice,request)));
  });
  await check('notificação direta e reação funcionam ANTES do freeze',async()=>{
    const id='qa_before_freeze_notice';
    const batch=writeBatch(bob);
    batch.set(doc(bob,postB+'/replies/'+id),{
      ...reply(B,nameB),replyToId:'qa_freeze_alice_old',replyToUid:A
    });
    batch.set(doc(bob,'users',A,'notifications',id),{
      ...note('qa_freeze_bob_post',id),replyToId:'qa_freeze_alice_old'
    });
    await assertSucceeds(batch.commit());
    await assertSucceeds(setDoc(doc(bob,
      postB+'/replies/qa_freeze_alice_old/reactions/'+B),{
        kind:'heart',createdAt:serverTimestamp()
    }));
  });
  await check('cliente não cria marcador administrativo',async()=>{
    await assertFails(setDoc(doc(alice,marker),{status:'processing'}));
    await assertFails(setDoc(doc(bob,marker),{status:'processing'}));
    await assertFails(setDoc(doc(anon,marker),{status:'processing'}));
  });
  // Only privileged emulator seed simulates the future administrative server.
  await env.withSecurityRulesDisabled(async c=>{
    await setDoc(doc(c.firestore(),marker),{
      status:'processing',reason:'qa-only',at:new Date()
    });
  });
  await check('marcador é privado, imutável e legível apenas ao titular',async()=>{
    await assertSucceeds(getDoc(doc(alice,marker)));
    await assertFails(getDoc(doc(bob,marker)));
    await assertFails(deleteDoc(doc(alice,marker)));
    await assertFails(updateDoc(doc(alice,marker),{status:'cancelled'}));
    await assertFails(deleteDoc(doc(bob,marker)));
  });
  await check('titular congelado não cria nem altera publicações',async()=>{
    await assertFails(setDoc(doc(alice,'posts/qa_after_freeze'),post(A,'Alice Teste')));
    await assertFails(updateDoc(doc(alice,'posts/qa_before_freeze'),{
      title:'Título alterado',updatedAt:serverTimestamp()
    }));
    await assertFails(deleteDoc(doc(alice,'posts/qa_before_freeze')));
    await assertFails(setDoc(doc(alice,postB+'/replies/qa_frozen_reply'),
      reply(A,'Alice Teste')));
  });
  await check('titular congelado não edita perfil, selo ou dados públicos',async()=>{
    await assertFails(updateDoc(doc(alice,'profiles',A),{displayName:'Alice Nova'}));
    await assertFails(setDoc(doc(alice,'badges',A),{lay:'leiga'}));
    await assertFails(deleteDoc(doc(alice,'public_profiles',A)));
    await assertFails(setDoc(doc(alice,'public_profiles',A),{
      displayName:'Alice Teste',bio:'QA',joinedAt:new Date(),updatedAt:serverTimestamp()
    }));
  });
  await check('titular congelado não insere curtidas, acompanhamentos ou token FCM',async()=>{
    await assertFails(setDoc(doc(alice,'users',A,'likedPosts','qa_freeze_bob_post'),
      {createdAt:serverTimestamp()}));
    await assertFails(setDoc(doc(alice,'users',A,'savedPosts','qa_freeze_bob_post'),
      {createdAt:serverTimestamp()}));
    await assertFails(setDoc(doc(alice,'users',A,'followedPosts','qa_freeze_bob_post'),
      {createdAt:serverTimestamp()}));
    await assertFails(setDoc(doc(alice,'users',A,'pushDevices','phone_1'),{
      token:'fcm-test-device-token-not-real-abcdefghijklmnopqrstuvwxyz',
      updatedAt:serverTimestamp()
    }));
  });
  await check('titular congelado não cria denúncia nem altera notificações',async()=>{
    await assertFails(setDoc(doc(alice,'reports',A+'_post_qa_freeze_bob_post'),{
      postId:'qa_freeze_bob_post',reporterUid:A,reason:'Denúncia de teste',
      createdAt:serverTimestamp()
    }));
    await assertFails(updateDoc(doc(alice,'users',A,'notifications','old_notice'),
      {read:true}));
    await assertFails(deleteDoc(doc(alice,'users',A,'notifications','old_notice')));
    await assertSucceeds(getDoc(doc(alice,'users',A,'notifications','old_notice')));
  });
  await check('reação a comentário congelado não pode ser alterada por terceiro',async()=>{
    await assertFails(updateDoc(doc(bob,
      postB+'/replies/qa_freeze_alice_old/reactions/'+B),{
        kind:'prayer'
    }));
  });
  await check('outro usuário não cria respostas no post congelado nem novas referências',async()=>{
    await assertFails(setDoc(doc(bob,postA+'/replies/new_bob_reply'),
      reply(B,nameB)));
    await assertFails(setDoc(doc(bob,'users',B,'likedPosts','qa_freeze_alice_post'),
      {createdAt:serverTimestamp()}));
    await assertFails(setDoc(doc(bob,'users',B,'savedPosts','qa_freeze_alice_post'),
      {createdAt:serverTimestamp()}));
    await assertFails(setDoc(doc(bob,'users',B,'followedPosts','qa_freeze_alice_post'),
      {createdAt:serverTimestamp()}));
  });
  await check('nenhuma notificação nova pode ser entregue a destinatário congelado',async()=>{
    const id='qa_bob_to_alice_notification';
    const batch=writeBatch(bob);
    batch.set(doc(bob,postB+'/replies/'+id),{
      ...reply(B,nameB),replyToId:'qa_freeze_alice_old',replyToUid:A
    });
    batch.set(doc(bob,'users',A,'notifications',id),{
      ...note('qa_freeze_bob_post',id),replyToId:'qa_freeze_alice_old'
    });
    await assertFails(batch.commit());
  });
  await check('outro usuário mantém publicações, respostas e tokens funcionando',async()=>{
    await assertSucceeds(setDoc(doc(bob,'posts/qa_active_bob'),post(B,nameB)));
    await assertSucceeds(setDoc(doc(bob,postB+'/replies/qa_active_reply'),
      reply(B,nameB)));
    await assertSucceeds(setDoc(doc(bob,'users',B,'likedPosts','qa_active_bob'),
      {createdAt:serverTimestamp()}));
    await assertSucceeds(setDoc(doc(bob,'users',B,'pushDevices','phone_2'),{
      token:'fcm-test-device-token-not-real-abcdefghijklmnopqrstuvwxyz',
      updatedAt:serverTimestamp()
    }));
  });
  await check('leitura da conta congelada e pedido permanecem disponíveis',async()=>{
    await assertSucceeds(getDoc(doc(alice,'profiles',A)));
    await assertSucceeds(getDoc(doc(alice,postA)));
    const r=await assertSucceeds(getDoc(doc(alice,request)));
    assert.equal(r.data().status,'requested');
    await assertFails(updateDoc(doc(alice,request),{status:'completed'}));
  });
  // Model approved cancellation only in local emulator, never from a user.
  await env.withSecurityRulesDisabled(async c=>{
    await deleteDoc(doc(c.firestore(),marker));
  });
  await check('retirada administrativa do freeze reabilita escrita sem mudar pedido',async()=>{
    await assertSucceeds(setDoc(doc(alice,'posts/qa_resumed'),post(A,'Alice Teste')));
    assert.equal((await getDoc(doc(alice,request))).data().status,'requested');
  });
  console.log('OK: '+total+' testes write-freeze no Firestore Emulator, zero produção');
}finally{
  await env.cleanup();
}
