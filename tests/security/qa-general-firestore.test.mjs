// Somente Firebase Emulator. Nunca ligar a um projeto real.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,writeBatch,serverTimestamp,updateDoc,Timestamp} from 'firebase/firestore';

const contents=readFileSync('qa-general.generated.rules','utf8');
if(!contents.includes('match /{document=**}') ||
   !contents.includes('match /chats/{chatId}') ||
   !contents.includes('match /chat_groups/{groupId}'))throw Error('rules_not_qa');
const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules:contents}
});
const alice=env.authenticatedContext('qa-alice',{email_verified:true}).firestore();
const bob=env.authenticatedContext('qa-bob',{email_verified:true}).firestore();
const outsider=env.authenticatedContext('qa-outsider',{email_verified:true}).firestore();
const guest=env.unauthenticatedContext().firestore();
const unverified=env.authenticatedContext('qa-unverified',{email_verified:false}).firestore();
const room='chats/qa-alice__qa-bob';
try {
 await env.clearFirestore();
 await assertFails(getDoc(doc(alice,room)));
 await assertFails(getDoc(doc(guest,'public_profiles/qa-alice')));
 await assertFails(getDoc(doc(alice,'posts/qa-post')));
 await assertFails(setDoc(doc(alice,'admins/qa-alice'),{enabled:true}));
 await assertFails(setDoc(doc(alice,'app_config/conversations'),{enabled:true}));
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),'app_config/conversations'),{
     enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
     safetyReviewVersion:'2026-11-safety-v1'
   });
   await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),{
     enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:false
   });
 });
 // Conta nao verificada nunca atravessa o gate, mesmo com flags sinteticas ativas.
 await assertFails(setDoc(doc(unverified,'users/qa-unverified/chatSettings/privacy'),{
   requests:'all',readReceipts:false,showPushPreview:false,
   updatedAt:serverTimestamp()
 }));
 await assertSucceeds(setDoc(doc(bob,'users/qa-bob/chatSettings/privacy'),{
   requests:'all',readReceipts:false,showPushPreview:false,
   updatedAt:serverTimestamp()
 }));
 await assertFails(setDoc(doc(alice,'users/qa-bob/chatSettings/privacy'),{
   requests:'all',readReceipts:false,showPushPreview:false,
   updatedAt:serverTimestamp()
 }));
 await assertSucceeds(setDoc(doc(bob,'users/qa-bob/blockedMembers/qa-outsider'),{
   createdAt:serverTimestamp()
 }));
 await assertFails(setDoc(doc(outsider,'users/qa-bob/blockedMembers/qa-alice'),{
   createdAt:serverTimestamp()
 }));
 await assertFails(setDoc(doc(alice,'chat_groups/g1'),{ownerUid:'qa-alice'}));
 const b=writeBatch(alice);
 b.set(doc(alice,room),{
   participants:['qa-alice','qa-bob'],requesterUid:'qa-alice',
   recipientUid:'qa-bob',status:'pending',initialId:'first',
   lastMessageId:'first',lastPreview:'Paz e bem!',lastSenderUid:'qa-alice',
   createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
   unreadRequester:0,unreadRecipient:1
 });
 b.set(doc(alice,room+'/messages/first'),{
   uid:'qa-alice',text:'Paz e bem!',kind:'text',createdAt:serverTimestamp()
 });
 b.set(doc(alice,'users/qa-alice/chatLimits/requests'),{
   count:1,windowStart:serverTimestamp(),lastChatId:'qa-alice__qa-bob',
   updatedAt:serverTimestamp()
 });
 await assertSucceeds(b.commit());
 await assertSucceeds(getDoc(doc(bob,room)));
 await assertFails(getDoc(doc(outsider,room)));
 await assertSucceeds(updateDoc(doc(bob,room),{status:'accepted',updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(doc(alice,room),{status:'declined'}));

 // Regressao fail-closed: nem mesmo um chat ja existente pode ser lido
 // caso um dos quatro portoes administrativos seja desligado ou adulterado.
 // Os valores true abaixo sao SOMENTE fixtures locais do emulador;
 // NUNCA representam autorizacao legal, verificacao etaria ou deploy.
 const approvedChat={
   enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
   safetyReviewVersion:'2026-11-safety-v1'
 };
 const denyVariants=[
   {minorPolicyApproved:false},
   {minorPolicyApproved:null},
   {enabled:false},
   {version:'unreviewed'},
   {safetyReviewVersion:'unreviewed'}
 ];
 for(const change of denyVariants){
   await env.withSecurityRulesDisabled(async ctx=>{
     await setDoc(doc(ctx.firestore(),'app_config/conversations'),{
       ...approvedChat,...change
     });
   });
   await assertFails(getDoc(doc(bob,room)));
   await assertFails(setDoc(doc(bob,'users/qa-bob/chatSettings/privacy'),{
     requests:'all',readReceipts:false,showPushPreview:false,
     updatedAt:serverTimestamp()
   }));
 }
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),'app_config/conversations'),approvedChat);
   // Elegibilidade ficticia no emulador: valida apenas o gate.
   await setDoc(doc(ctx.firestore(),'users/qa-alice/chatGroupAccess/eligibility'),{
     status:'approved',policyVersion:'2026-11-group-safety-v1'
   });
   await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),{
     enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:true
   });
 });
 const eligibility='users/qa-alice/chatGroupAccess/eligibility';
 await assertSucceeds(getDoc(doc(alice,eligibility)));
 await assertFails(getDoc(doc(guest,eligibility)));
 await assertFails(getDoc(doc(unverified,'users/qa-unverified/chatGroupAccess/eligibility')));
 // O gate de menores do grupo e independente do gate de conversas.
 for(const change of [
   {minorPolicyApproved:false},
   {enabled:false},
   {version:'unreviewed'}
 ]){
   await env.withSecurityRulesDisabled(async ctx=>{
     await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),{
       enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:true,
       ...change
     });
   });
   await assertFails(getDoc(doc(alice,eligibility)));
 }
 // Mesmo com o grupo habilitado, desligar o chat pai bloqueia grupos.
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),{
     enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:true
   });
   await setDoc(doc(ctx.firestore(),'app_config/conversations'),{
     ...approvedChat,minorPolicyApproved:false
   });
 });
 await assertFails(getDoc(doc(alice,eligibility)));

 // Mensagens e historicos de GRUPOS JA EXISTENTES nao podem escapar apos
 // revogacao de elegibilidade, vencimento de revisao ou bloqueio global.
 // A data futura e o usuario sao sinteticos no Firebase Emulator.
 const group='chat_groups/qa-existing-group';
 const groupMessage=group+'/messages/qa-first';
 const future=Timestamp.fromDate(new Date('2035-01-01T00:00:00.000Z'));
 const past=Timestamp.fromDate(new Date('2000-01-01T00:00:00.000Z'));
 const approvedEligibility={
   status:'approved',
   policyVersion:'2026-11-group-safety-v1',
   reviewExpiresAt:future
 };
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),'app_config/conversations'),approvedChat);
   await setDoc(doc(ctx.firestore(),'users/qa-alice/chatGroupAccess/eligibility'),
     approvedEligibility);
   await setDoc(doc(ctx.firestore(),group),{
     ownerUid:'qa-alice',memberUids:['qa-alice'],adminUids:['qa-alice'],
     status:'active'
   });
   await setDoc(doc(ctx.firestore(),groupMessage),{
     uid:'qa-alice',kind:'text',text:'Mensagem ficticia QA',createdAt:past
   });
 });
 // Controle positivo obrigatorio: prova que a leitura seria possivel com
 // todos os gates ficticios ligados, evitando testes negativos triviais.
 await assertSucceeds(getDoc(doc(alice,group)));
 await assertSucceeds(getDoc(doc(alice,groupMessage)));
 await assertFails(getDoc(doc(bob,group)));
 await assertFails(getDoc(doc(outsider,groupMessage)));
 await assertFails(getDoc(doc(guest,groupMessage)));
 await assertFails(getDoc(doc(unverified,groupMessage)));
 const revokedEligibility=[
   {...approvedEligibility,status:'revoked'},
   {...approvedEligibility,policyVersion:'unreviewed'},
   {...approvedEligibility,reviewExpiresAt:past},
   {status:'approved',policyVersion:'2026-11-group-safety-v1'}
 ];
 for(const denied of revokedEligibility){
   await env.withSecurityRulesDisabled(async ctx=>{
     await setDoc(doc(ctx.firestore(),eligibility),denied);
   });
   await assertFails(getDoc(doc(alice,group)));
   await assertFails(getDoc(doc(alice,groupMessage)));
 }
 // Restaurar somente fixture sintética e testar gate global independente.
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),eligibility),approvedEligibility);
   await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),{
     enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:false
   });
 });
 await assertFails(getDoc(doc(alice,group)));
 await assertFails(getDoc(doc(alice,groupMessage)));
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),{
     enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:true
   });
   await setDoc(doc(ctx.firestore(),'app_config/conversations'),{
     ...approvedChat,minorPolicyApproved:false
   });
 });
 await assertFails(getDoc(doc(alice,group)));
 await assertFails(getDoc(doc(alice,groupMessage)));
 console.log('QA geral: revogacao/expiracao impede leitura de historicos de grupo existentes.');
}finally{await env.cleanup();}
