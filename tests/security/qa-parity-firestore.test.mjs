// COMPOSIÇÃO DE PARIDADE LOCAL. NUNCA CONECTAR AO FIREBASE REAL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {doc,getDoc,getDocs,collection,setDoc,Timestamp}
  from 'firebase/firestore';

const rules=readFileSync('qa-parity.generated.rules','utf8');
if(!rules.includes('BEGIN QA PARITY ADDITIVE') ||
   !rules.includes('END QA PARITY ADDITIVE') ||
   !rules.includes('match /chats/{chatId}') ||
   !rules.includes('match /chat_groups/{groupId}'))
  throw Error('qa_parity_rules_not_generated');
const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules}
});
const alice=env.authenticatedContext('qa-alice',{email_verified:true}).firestore();
const aliceUnverified=env.authenticatedContext('qa-alice',{email_verified:false}).firestore();
const bob=env.authenticatedContext('qa-bob',{email_verified:true}).firestore();
const outsider=env.authenticatedContext('qa-outsider',{email_verified:true}).firestore();
const moderator=env.authenticatedContext('qa-moderator',{email_verified:true}).firestore();
const guest=env.unauthenticatedContext().firestore();
const chat='chats/qa-alice__qa-bob';
const group='chat_groups/qa-private-group';
const chatMessage=chat+'/messages/first';
const groupMessage=group+'/messages/first';
const chatReport='chat_reports/qa-alice__qa-alice__qa-bob__first';
const groupReport='chat_group_reports/qa-alice__qa-private-group__first';
try {
  await env.clearFirestore();
  // Direitos preexistentes da base versionada: comprova paridade positiva.
  await assertSucceeds(getDoc(doc(guest,'app_config/opening_video')));
  await assertSucceeds(getDoc(doc(alice,'profiles/qa-alice')));
  await assertFails(getDoc(doc(bob,'profiles/qa-alice')));
  await assertFails(setDoc(doc(alice,'admins/qa-alice'),{enabled:true}));
  // Nenhuma configuração de ativação: a inclusão não pode abrir DMs/grupos.
  await assertFails(getDoc(doc(alice,chat)));
  await assertFails(getDoc(doc(alice,group)));
  const future=Timestamp.fromDate(new Date('2035-01-01T00:00:00Z'));
  const createdAt=Timestamp.fromDate(new Date('2026-11-01T00:00:00Z'));
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'app_config/conversations'),{
      enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
      safetyReviewVersion:'2026-11-safety-v1'
    });
    await setDoc(doc(db,'app_config/chat_groups'),{
      enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:true
    });
    await setDoc(doc(db,'users/qa-alice/chatGroupAccess/eligibility'),{
      status:'approved',policyVersion:'2026-11-group-safety-v1',
      reviewExpiresAt:future
    });
    await setDoc(doc(db,chat),{
      participants:['qa-alice','qa-bob'],requesterUid:'qa-alice',
      recipientUid:'qa-bob',status:'accepted'
    });
    await setDoc(doc(db,group),{
      ownerUid:'qa-alice',memberUids:['qa-alice'],adminUids:['qa-alice'],
      status:'active'
    });
    await setDoc(doc(db,chatMessage),{
      uid:'qa-alice',kind:'text',text:'Mensagem ficticia QA',createdAt
    });
    await setDoc(doc(db,groupMessage),{
      uid:'qa-alice',kind:'text',text:'Mensagem ficticia QA',createdAt
    });
    await setDoc(doc(db,chatReport),{
      chatId:'qa-alice__qa-bob',messageId:'first',reporterUid:'qa-alice',
      reason:'Teste ficticio QA',reportedText:'Mensagem ficticia QA',createdAt
    });
    await setDoc(doc(db,groupReport),{
      groupId:'qa-private-group',messageId:'first',reporterUid:'qa-alice',
      reason:'Teste ficticio QA',reportedText:'Mensagem ficticia QA',createdAt
    });
    // Permissao administrativa sintetica, criada somente no emulador.
    await setDoc(doc(db,'admins/qa-moderator'),{enabled:true});
  });
  // Controle positivo: regras experimentais funcionam APENAS em fixtures.
  await assertSucceeds(getDoc(doc(alice,chat)));
  await assertSucceeds(getDoc(doc(alice,group)));
  await assertFails(getDoc(doc(aliceUnverified,chat)));
  await assertFails(getDoc(doc(aliceUnverified,group)));
  await assertFails(getDoc(doc(bob,group)));
  // Paridade de privacidade: a base legada nao pode liberar historico privado.
  await assertSucceeds(getDoc(doc(alice,chatMessage)));
  await assertSucceeds(getDoc(doc(alice,groupMessage)));
  await assertFails(getDoc(doc(outsider,chatMessage)));
  await assertFails(getDoc(doc(outsider,groupMessage)));
  await assertFails(getDoc(doc(moderator,chat)));
  await assertFails(getDoc(doc(moderator,group)));
  await assertFails(getDoc(doc(moderator,chatMessage)));
  await assertFails(getDoc(doc(moderator,groupMessage)));

  // Moderador le apenas protocolos, nunca DMs ou grupos por ser moderador.
  // Denunciante acessa seu protocolo; outro membro nao pode le-lo nem listar.
  await assertSucceeds(getDoc(doc(alice,chatReport)));
  await assertSucceeds(getDoc(doc(alice,groupReport)));
  await assertFails(getDoc(doc(bob,chatReport)));
  await assertFails(getDoc(doc(bob,groupReport)));
  await assertFails(getDocs(collection(alice,'chat_reports')));
  await assertFails(getDocs(collection(alice,'chat_group_reports')));
  await assertSucceeds(getDoc(doc(moderator,chatReport)));
  await assertSucceeds(getDoc(doc(moderator,groupReport)));
  await assertSucceeds(getDocs(collection(moderator,'chat_reports')));
  await assertSucceeds(getDocs(collection(moderator,'chat_group_reports')));

  // Um único gate desligado precisa negar mesmo o histórico existente.
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'app_config/conversations'),{
      enabled:false,version:'2026-11-v1',minorPolicyApproved:true,
      safetyReviewVersion:'2026-11-safety-v1'
    });
  });
  await assertFails(getDoc(doc(alice,chat)));
  await assertFails(getDoc(doc(alice,group)));
  await assertFails(getDoc(doc(alice,chatMessage)));
  await assertFails(getDoc(doc(alice,groupMessage)));
  // Denuncias existentes devem sobreviver ao bloqueio do chat/grupo.
  await assertSucceeds(getDoc(doc(alice,chatReport)));
  await assertSucceeds(getDoc(doc(alice,groupReport)));
  await assertSucceeds(getDoc(doc(moderator,chatReport)));
  await assertSucceeds(getDoc(doc(moderator,groupReport)));
  // A rota pública legada continua legível: não é um falso negativo global.
  await assertSucceeds(getDoc(doc(guest,'app_config/opening_video')));
  console.log('Paridade QA: legado, gates, mensagens e protocolos privados OK (EMULATOR).');
}finally {
  await env.cleanup();
}
