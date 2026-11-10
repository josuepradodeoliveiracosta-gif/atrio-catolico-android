// Somente Firebase Emulator. Nunca ligar a um projeto real.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,getDocs,collection,setDoc,deleteDoc,writeBatch,serverTimestamp,updateDoc,Timestamp} from 'firebase/firestore';

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
// Mesmo UID da conta válida, com claim de verificação revogada.
const bobEmailUnverified=env.authenticatedContext('qa-bob',{email_verified:false}).firestore();
const outsider=env.authenticatedContext('qa-outsider',{email_verified:true}).firestore();
const guest=env.unauthenticatedContext().firestore();
const unverified=env.authenticatedContext('qa-unverified',{email_verified:false}).firestore();
const room='chats/qa-alice__qa-bob';
const qaAge18Proof={
  status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',
  reviewExpiresAt:Timestamp.fromDate(new Date('2035-01-01T00:00:00.000Z'))
};
const aliceAge='users/qa-alice/chatAgeEligibility/current';
const bobAge='users/qa-bob/chatAgeEligibility/current';
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
 // No QA novo a configuracao global, por si so, NAO libera o chat.
 await assertFails(setDoc(doc(bob,'users/qa-bob/chatSettings/privacy'),{
   requests:'all',readReceipts:false,showPushPreview:false,
   updatedAt:serverTimestamp()
 }));
 // Prova sintética é escrita somente no contexto administrativo do emulador.
 await assertFails(setDoc(doc(bob,bobAge),qaAge18Proof));
 await assertFails(setDoc(doc(alice,aliceAge),qaAge18Proof));
 await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   await setDoc(doc(db,aliceAge),qaAge18Proof);
   await setDoc(doc(db,bobAge),qaAge18Proof);
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
 const createInitialChat=()=>{
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
 return b;
 };
 // O mesmo batch valido deve falhar sem a elegibilidade do destinatario.
 await env.withSecurityRulesDisabled(async ctx=>{
   await deleteDoc(doc(ctx.firestore(),bobAge));
 });
 await assertFails(createInitialChat().commit());
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),bobAge),qaAge18Proof);
 });
 await assertSucceeds(createInitialChat().commit());
 await assertSucceeds(getDoc(doc(bob,room)));
 await assertSucceeds(getDoc(doc(bob,room+'/messages/first')));
 await assertFails(getDoc(doc(outsider,room)));
 // O token da MESMA conta perde email_verified: não pode consultar
 // mensagens já salvas, mesmo permanecendo participante da conversa.
 // Isto é simulação no Firebase Emulator, não uma revogação no Auth real.
 await assertFails(getDoc(doc(bobEmailUnverified,room)));
 await assertFails(getDoc(doc(bobEmailUnverified,room+'/messages/first')));
 await assertFails(updateDoc(doc(bobEmailUnverified,room),{
   status:'accepted',updatedAt:serverTimestamp()
 }));
 await assertSucceeds(updateDoc(doc(bob,room),{status:'accepted',updatedAt:serverTimestamp()}));
 // Mesmo apos aceite, uma conta elegivel NAO pode enviar nova mensagem
 // a um destinatario cuja prova foi revogada. Controle positivo usa
 // o mesmo batch com metadados e mensagem ligados atomicamente.
 const sendSecondMessage=()=>{
   const b=writeBatch(alice);
   b.set(doc(alice,room+'/messages/qa-second'),{
     uid:'qa-alice',kind:'text',
     text:'Mensagem adicional ficticia QA',createdAt:serverTimestamp()
   });
   b.update(doc(alice,room),{
     lastMessageId:'qa-second',lastPreview:'Mensagem adicional ficticia QA',
     lastSenderUid:'qa-alice',updatedAt:serverTimestamp(),
     unreadRequester:0,unreadRecipient:2
   });
   return b;
 };
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),bobAge),{...qaAge18Proof,status:'revoked'});
 });
 await assertFails(sendSecondMessage().commit());
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),bobAge),qaAge18Proof);
 });
 await assertSucceeds(sendSecondMessage().commit());
 await assertSucceeds(getDoc(doc(bob,room+'/messages/qa-second')));
 // Idade desconhecida, revogacao, limite inadequado, politica errada
 // ou validade encerrada sempre retiram acesso AO HISTORICO existente.
 for(const invalid of [
   {...qaAge18Proof,status:'revoked'},
   {...qaAge18Proof,minimumAge:16},
   {...qaAge18Proof,minimumAge:17},
   {...qaAge18Proof,policyVersion:'unreviewed'},
   {...qaAge18Proof,reviewExpiresAt:Timestamp.fromDate(new Date('2000-01-01T00:00:00Z'))}
 ]) {
   await env.withSecurityRulesDisabled(async ctx=>{
     await setDoc(doc(ctx.firestore(),bobAge),invalid);
   });
   await assertFails(getDoc(doc(bob,room)));
   await assertFails(getDoc(doc(bob,room+'/messages/first')));
 }
 await env.withSecurityRulesDisabled(async ctx=>{
   await deleteDoc(doc(ctx.firestore(),bobAge));
 });
 await assertFails(getDoc(doc(bob,room)));
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),bobAge),qaAge18Proof);
 });
 await assertSucceeds(getDoc(doc(bob,room)));
 await assertSucceeds(getDoc(doc(bob,room+'/messages/first')));
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
 // O documento de liberacao sequer existe no QA recem-criado: negar
 // leitura do historico e escrita sem confundir com valores false.
 await env.withSecurityRulesDisabled(async ctx=>{
   await deleteDoc(doc(ctx.firestore(),'app_config/conversations'));
 });
 await assertFails(getDoc(doc(bob,room)));
 await assertFails(setDoc(doc(bob,'users/qa-bob/chatSettings/privacy'),{
   requests:'all',readReceipts:false,showPushPreview:false,
   updatedAt:serverTimestamp()
 }));
 // Um documento parcial sem revisao de seguranca tambem permanece fechado.
 await env.withSecurityRulesDisabled(async ctx=>{
   const {safetyReviewVersion:unused, ...incomplete}=approvedChat;
   await setDoc(doc(ctx.firestore(),'app_config/conversations'),incomplete);
 });
 await assertFails(getDoc(doc(bob,room)));
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
 // QA novo sem documento de ativacao de grupos: a elegibilidade
 // administrativa nao libera leitura se o portao de grupo nao existe.
 await env.withSecurityRulesDisabled(async ctx=>{
   await deleteDoc(doc(ctx.firestore(),'app_config/chat_groups'));
 });
 await assertFails(getDoc(doc(alice,eligibility)));
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
 // Mesmo UID e membro do grupo, mas claim email_verified=false.
 const aliceEmailUnverified=env.authenticatedContext('qa-alice',{
   email_verified:false
 }).firestore();
 await assertFails(getDoc(doc(aliceEmailUnverified,group)));
 await assertFails(getDoc(doc(aliceEmailUnverified,groupMessage)));
 await assertFails(getDoc(doc(bob,group)));
 await assertFails(getDoc(doc(outsider,groupMessage)));
 await assertFails(getDoc(doc(guest,groupMessage)));
 await assertFails(getDoc(doc(unverified,groupMessage)));
 // Ex-integrante: o gate individual continua aprovado, mas a retirada da
 // lista de membros precisa revogar grupo, mensagens e preferencias privadas.
 // Todas as gravacoes administrativas abaixo existem SOMENTE no emulador.
 const bobEligibility='users/qa-bob/chatGroupAccess/eligibility';
 const bobGroupBox='users/qa-bob/chatGroupBox/qa-existing-group';
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),bobEligibility),approvedEligibility);
   await updateDoc(doc(ctx.firestore(),group),{
     memberUids:['qa-alice','qa-bob']
   });
   await setDoc(doc(ctx.firestore(),bobGroupBox),{
     muted:true,updatedAt:past
   });
 });
 // Controle positivo: Bob era integrante normal, sem papel administrativo.
 await assertSucceeds(getDoc(doc(bob,group)));
 await assertSucceeds(getDoc(doc(bob,groupMessage)));
 await assertSucceeds(getDocs(collection(bob,group+'/messages')));
 await assertSucceeds(getDoc(doc(bob,bobGroupBox)));
 // O administrador ficticio remove SOMENTE Bob, sem desativar o grupo.
 await env.withSecurityRulesDisabled(async ctx=>{
   await updateDoc(doc(ctx.firestore(),group),{
     memberUids:['qa-alice']
   });
 });
 await assertFails(getDoc(doc(bob,group)));
 await assertFails(getDoc(doc(bob,groupMessage)));
 await assertFails(getDocs(collection(bob,group+'/messages')));
 await assertFails(getDoc(doc(bob,bobGroupBox)));
 // Controle positivo apos a retirada: o grupo e seu historico permanecem
 // acessiveis ao integrante que continua autorizado.
 await assertSucceeds(getDoc(doc(alice,group)));
 await assertSucceeds(getDoc(doc(alice,groupMessage)));
 // Restaurar Bob apenas neste cenario sintético prova que o bloqueio foi
 // exclusivamente por membresia, nao por uma falha permanente do fixture.
 await env.withSecurityRulesDisabled(async ctx=>{
   await updateDoc(doc(ctx.firestore(),group),{
     memberUids:['qa-alice','qa-bob']
   });
 });
 await assertSucceeds(getDoc(doc(bob,groupMessage)));
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
 // Ausencia integral da autorizacao individual jamais permite reentrada.
 await env.withSecurityRulesDisabled(async ctx=>{
   await deleteDoc(doc(ctx.firestore(),eligibility));
 });
 await assertFails(getDoc(doc(alice,group)));
 await assertFails(getDoc(doc(alice,groupMessage)));
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
 // Regressao QA: o destinatario deve ser elegivel ANTES de receber
 // convite, e deve continuar elegivel para ler, recusar ou ser reconvidado.
 // Somente dados sintéticos em uma instância do Firebase Emulator.
 const inviteGroup='chat_groups/qa-age-invite';
 const inviteRef=inviteGroup+'/atrioGroupInvites/qa-bob';
 const newInvite=()=>setDoc(doc(alice,inviteRef),{
   inviteeUid:'qa-bob',inviterUid:'qa-alice',
   groupName:'Grupo sintético QA',contactChatId:'qa-alice__qa-bob',
   status:'pending',createdAt:serverTimestamp(),updatedAt:serverTimestamp()
 });
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),'app_config/conversations'),approvedChat);
   await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),{
     enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:true
   });
   await setDoc(doc(ctx.firestore(),eligibility),approvedEligibility);
   await setDoc(doc(ctx.firestore(),bobEligibility),approvedEligibility);
   await setDoc(doc(ctx.firestore(),inviteGroup),{
     name:'Grupo sintético QA',ownerUid:'qa-alice',
     memberUids:['qa-alice'],adminUids:['qa-alice'],status:'active'
   });
   await deleteDoc(doc(ctx.firestore(),bobAge));
 });
 await assertSucceeds(getDoc(doc(alice,inviteGroup)));
 // Contato individual aceito nao deve substituir prova de idade ausente.
 await assertSucceeds(getDoc(doc(alice,room)));
 await assertFails(newInvite());
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),bobAge),qaAge18Proof);
 });
 await assertSucceeds(newInvite());
 await assertSucceeds(getDoc(doc(bob,inviteRef)));
 // Uma prova revogada impede leitura do convite e sua aceitacao/recusa.
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),bobAge),{
     ...qaAge18Proof,status:'revoked'
   });
 });
 await assertFails(getDoc(doc(bob,inviteRef)));
 await assertFails(updateDoc(doc(bob,inviteRef),{
   status:'declined',updatedAt:serverTimestamp()
 }));
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),bobAge),qaAge18Proof);
 });
 await assertSucceeds(getDoc(doc(bob,inviteRef)));
 await assertSucceeds(updateDoc(doc(bob,inviteRef),{
   status:'declined',updatedAt:serverTimestamp()
 }));
 // Reconvite pelo administrador tambem exige prova valida do destinatario.
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),bobAge),{
     ...qaAge18Proof,reviewExpiresAt:past
   });
 });
 await assertFails(updateDoc(doc(alice,inviteRef),{
   status:'pending',updatedAt:serverTimestamp()
 }));
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),bobAge),qaAge18Proof);
 });
 await assertSucceeds(updateDoc(doc(alice,inviteRef),{
   status:'pending',updatedAt:serverTimestamp()
 }));
 await assertSucceeds(getDoc(doc(bob,inviteRef)));
 console.log('QA geral: convidado inelegivel bloqueado na criacao, leitura e reconvite (EMULATOR).');
 console.log('QA geral: revogacao/expiracao impede leitura de historicos de grupo existentes.');
}finally{await env.cleanup();}
