/**
 * PRÉ-LANÇAMENTO — ensaio ponta a ponta só com usuários sintéticos.
 * Regras reais do Firestore Emulator + REST Admin emulator, sem IAM, cobrança,
 * Cloudflare, push, endpoints públicos ou dados de usuários reais.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,getDoc,serverTimestamp,collection,getDocs} from 'firebase/firestore';
import {Firestore,caseId} from '../../cloudflare/guardian-worker/src/firestore.js';
import {processDocument,processReport,reviewCase,scanOnce} from '../../cloudflare/guardian-worker/src/index.js';

const project='demo-atrio-v11';
const env=await initializeTestEnvironment({
 projectId:project,
 firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}
});
const reader=new Firestore('emulator-only',project,'http://127.0.0.1:8089/v1');
const author=env.authenticatedContext('qa-autor').firestore();
const reviewer=env.authenticatedContext('qa-revisor').firestore();
const moderator=env.authenticatedContext('qa-moderador').firestore();
const outsider=env.authenticatedContext('qa-estranho').firestore();
const makePost=(uid,name,body)=>({
 uid,authorName:name,title:'Ensaio da comunidade católica',
 body,category:'Liturgia',createdAt:serverTimestamp()
});
const makeReply=(uid,name,body)=>({
 uid,authorName:name,body,createdAt:serverTimestamp()
});
let checks=0;
async function check(label,fn){
 await fn();
 console.log('GUARDIAN_E2E_PASS',++checks,label);
}
try{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),'admins/qa-moderador'),{enabled:true});
 });
 await check('perfis de teste criados pelo próprio usuário',async()=>{
  await assertSucceeds(setDoc(doc(author,'profiles/qa-autor'),{
   displayName:'Autora QA',createdAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(reviewer,'profiles/qa-revisor'),{
   displayName:'Revisor QA',createdAt:serverTimestamp()
  }));
 });
 await check('autora publica e segundo usuário visualiza conteúdo legítimo',async()=>{
  await assertSucceeds(setDoc(doc(author,'posts/qa_topic'),makePost(
   'qa-autor','Autora QA','Como viver a Eucaristia na comunidade?')));
  await assertSucceeds(setDoc(doc(author,'posts/qa_topic/replies/qa_good'),makeReply(
   'qa-autor','Autora QA','A fé inspira caridade e diálogo fraterno.')));
  assert.equal((await getDoc(doc(reviewer,'posts/qa_topic'))).exists(),true);
  assert.equal((await getDoc(doc(reviewer,'posts/qa_topic/replies/qa_good'))).exists(),true);
  assert.equal(await processDocument(reader,await reader.get('posts/qa_topic'),{
   enabled:true,allowHold:true
  }),'clear');
  assert.equal(await reader.get('guardian_cases/'+await caseId('posts/qa_topic')),null);
 });
 await check('denúncia falsa de conteúdo católico não gera punição',async()=>{
  await assertSucceeds(setDoc(doc(reviewer,'reports/qa-revisor_post_qa_topic'),{
   postId:'qa_topic',reporterUid:'qa-revisor',reason:'Pedido de revisão de conteúdo',
   createdAt:serverTimestamp()
  }));
  assert.equal(await processReport(reader,await reader.get('reports/qa-revisor_post_qa_topic'),{
   enabled:true,allowHold:true
  }),'clear');
  assert.equal((await getDoc(doc(reviewer,'posts/qa_topic'))).exists(),true);
  await assertFails(getDoc(doc(reviewer,'reports/qa-revisor_post_qa_topic')));
  assert.equal((await getDoc(doc(moderator,'reports/qa-revisor_post_qa_topic'))).exists(),true);
 });
 const path='posts/qa_topic/replies/qa_phish';
 const caseName=await caseId(path);
 await check('autora cria resposta suspeita e revisor registra denúncia válida',async()=>{
  await assertSucceeds(setDoc(doc(author,path),makeReply(
   'qa-autor','Autora QA','Clique https://exemplo.invalid para informar sua senha')));
  await assertSucceeds(setDoc(doc(reviewer,'reports/qa-revisor_reply_qa_topic_qa_phish'),{
   postId:'qa_topic',replyId:'qa_phish',reporterUid:'qa-revisor',
   reason:'Possível fraude por link de coleta de senha',
   createdAt:serverTimestamp()
  }));
  await assertFails(setDoc(doc(reviewer,'reports/qa-revisor_reply_qa_topic_qa_phish'),{
   postId:'qa_topic',replyId:'qa_phish',reporterUid:'qa-revisor',
   reason:'Denúncia repetida',createdAt:serverTimestamp()
  }));
 });
 await check('moderação habilitada somente no emulador faz quarentena reversível',async()=>{
  const result=await processDocument(reader,await reader.get(path),{
   enabled:true,allowHold:true
  });
  assert.equal(result,'hold');
  assert.equal((await getDoc(doc(reviewer,path))).exists(),false);
  const caseDoc=await reader.get('guardian_cases/'+caseName);
  const held=await reader.get('guardiao_quarantine/'+caseName);
  assert.equal(caseDoc.fields.status.stringValue,'held');
  assert.equal(held.fields.status.stringValue,'held');
  assert.equal(held.fields.ownerUid.stringValue,'qa-autor');
  assert.equal(held.fields.originalFields.mapValue.fields.body.stringValue,
   'Clique https://exemplo.invalid para informar sua senha');
  assert.ok(await reader.get('guardian_audit/'+caseName));
  assert.ok(await reader.get('guardian_notices/qa-autor/items/'+caseName));
 });
 await check('somente autora vê aviso e autor pode recorrer uma única vez',async()=>{
  assert.equal((await getDoc(doc(author,'guardian_notices/qa-autor/items/'+caseName))).exists(),true);
  await assertFails(getDoc(doc(reviewer,'guardian_notices/qa-autor/items/'+caseName)));
  await assertFails(updateDoc(doc(reviewer,'guardiao_quarantine/'+caseName),{
   status:'restored'
  }));
  await assertSucceeds(updateDoc(doc(author,'guardiao_quarantine/'+caseName),{
   appealText:'Solicito revisão humana; foi uma simulação de segurança no QA.',
   appealedAt:serverTimestamp()
  }));
  await assertFails(updateDoc(doc(author,'guardiao_quarantine/'+caseName),{
   appealText:'Tentativa de mudar o recurso',appealedAt:serverTimestamp()
  }));
  await assertFails(updateDoc(doc(author,'guardian_cases/'+caseName),{status:'restored'}));
  const held=await reader.get('guardiao_quarantine/'+caseName);
  assert.equal(held.fields.status.stringValue,'held');
  assert.equal(held.fields.appealText.stringValue,
   'Solicito revisão humana; foi uma simulação de segurança no QA.');
  assert.equal((await getDoc(doc(moderator,'guardiao_quarantine/'+caseName))).exists(),true);
 });
 await check('moderador independente restaura resposta e preserva trilha de auditoria',async()=>{
  await assert.rejects(reviewCase(reader,'qa-autor',{
   caseId:caseName,action:'restore',note:'Autorrevisão indevida'
  }),e=>e.status===403);
  assert.equal(await reviewCase(reader,'qa-moderador',{
   caseId:caseName,action:'restore',note:'Simulação legítima; falso positivo confirmado.'
  }),'restored');
  const visible=await getDoc(doc(reviewer,path));
  assert.equal(visible.exists(),true);
  assert.equal(visible.data().body,'Clique https://exemplo.invalid para informar sua senha');
  assert.equal((await reader.get('guardian_cases/'+caseName)).fields.status.stringValue,'restored');
  assert.equal((await reader.get('guardiao_quarantine/'+caseName)).fields.status.stringValue,'restored');
  assert.equal((await reader.get('guardian_audit/'+caseName+'_restored')).fields.actor.stringValue,'qa-moderador');
  assert.ok(await reader.get('guardian_notices/qa-autor/items/'+caseName+'_review'));
  await assert.rejects(reviewCase(reader,'qa-moderador',{
   caseId:caseName,action:'confirm',note:'Tentativa de segunda decisão'
  }),e=>e.status===409);
 });
 await check('outro caso pode ser confirmado pelo moderador sem permitir autorrevisão',async()=>{
  const second='posts/qa_topic/replies/qa_second';
  const secondCase=await caseId(second);
  await assertSucceeds(setDoc(doc(author,second),makeReply(
   'qa-autor','Autora QA','Clique https://exemplo.invalid para informar sua senha')));
  assert.equal(await processDocument(reader,await reader.get(second),{
   enabled:true,allowHold:true
  }),'hold');
  assert.equal(await reviewCase(reader,'qa-moderador',{
   caseId:secondCase,action:'confirm',note:'Golpe confirmado na simulação.'
  }),'confirmed');
  assert.equal((await getDoc(doc(reviewer,second))).exists(),false);
  assert.equal((await reader.get('guardian_cases/'+secondCase)).fields.status.stringValue,'removed');
  assert.ok(await reader.get('guardian_audit/'+secondCase+'_confirmed'));
  assert.ok(await reader.get('guardian_notices/qa-autor/items/'+secondCase+'_review'));
 });
 await check('usuários e até admins via SDK não podem adulterar decisões do servidor',async()=>{
  await assertFails(setDoc(doc(outsider,'guardian_cases/fake'),{status:'approved'}));
  await assertFails(updateDoc(doc(moderator,'guardian_cases/'+caseName),{status:'held'}));
  await assertFails(updateDoc(doc(moderator,'guardian_audit/'+caseName+'_restored'),{
   actor:'qa-estranho'
  }));
  await assertFails(getDocs(collection(outsider,'guardian_audit')));
 });
 await check('parada de emergência impede toda varredura',async()=>{
  assert.deepEqual(await scanOnce(reader,{enabled:false}),{status:'disabled'});
  assert.equal((await getDoc(doc(reviewer,'posts/qa_topic'))).exists(),true);
  assert.equal((await getDoc(doc(reviewer,'posts/qa_topic/replies/qa_good'))).exists(),true);
 });
 console.log('GUARDIAN_E2E_EMULATOR',checks,'PASS');
}finally{
 await env.cleanup();
}
