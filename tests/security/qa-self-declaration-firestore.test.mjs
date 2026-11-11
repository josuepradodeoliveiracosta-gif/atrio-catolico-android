// TESTES EXCLUSIVAMENTE NO FIREBASE EMULATOR. SEM PROJETO REAL OU PRODUÇÃO.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderSelfDeclarationRules} from '../../firebase/qa-general/self-declaration-candidate.mjs';
import {STAGED_QA_DOCS,LAB_ONLY_ACTIVE_CHAT,validateStagedQaDocs}
 from '../../firebase/qa-general/admin-config-preflight.mjs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
 from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,deleteDoc,Timestamp,serverTimestamp} from 'firebase/firestore';

const chat=readFileSync(new URL('../../firebase/atrio-conversas-v1.rules.fragment',import.meta.url),'utf8');
const group=readFileSync(new URL('../../firebase/atrio-grupos-v1.rules.fragment',import.meta.url),'utf8');
const rules=renderSelfDeclarationRules(chat,group);
test('regras distintas de QA não contêm permissão global nem dados de produção',()=>{
 assert.match(rules,/declared_18_plus/);
 assert.match(rules,/2026-11-selfdecl-qa-v1/);
 assert.doesNotMatch(rules,/allow read, write: if true;/);
 assert.doesNotMatch(rules,/firebase\.google\.com|atrio-qa-geral-db/);
});

const env=await initializeTestEnvironment({
 projectId:'demo-atrio-v11',
 firestore:{host:'127.0.0.1',port:8089,rules}
});
const claim=()=>({
 status:'declared_18_plus',minimumAge:18,
 policyVersion:'2026-11-selfdecl-qa-v1',
 reviewExpiresAt:Timestamp.fromDate(new Date(Date.now()+364*86400000))
});
const pathFor=uid=>'users/'+uid+'/chatAgeEligibility/current';
const limitFor=uid=>'users/'+uid+'/chatLimits/requests';
const alice='qa-adult-declarant';
const bob='qa-bob-no-declaration';
const c=uid=>env.authenticatedContext(uid,{email_verified:true}).firestore();
const unverified=env.authenticatedContext(alice,{email_verified:false}).firestore();
const unsigned=env.unauthenticatedContext().firestore();
try{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),'app_config/conversations'),{
     enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
     safetyReviewVersion:'2026-11-safety-v1'
   });
 });
 await test('staged config QA exige email mas nunca abre chat, grupos ou push',async()=>{
   const report=validateStagedQaDocs(STAGED_QA_DOCS);
   assert.equal(report.ready_for_deploy,false);
   await env.withSecurityRulesDisabled(async ctx=>{
     for(const [path,data] of Object.entries(STAGED_QA_DOCS)){
       await setDoc(doc(ctx.firestore(),path),data);
     }
   });
   const me=c(alice);
   for(const key of ['app_config/email_verification','app_config/community_rules']){
     const snapshot=await assertSucceeds(getDoc(doc(me,key)));
     assert.equal(snapshot.data()?.enabled,true);
     assert.equal(snapshot.data()?.version,'2026-11-v1');
     await assertFails(setDoc(doc(me,key),{enabled:false,version:'fake'}));
   }
   const conversations=await assertSucceeds(getDoc(doc(me,'app_config/conversations')));
   assert.equal(conversations.data()?.enabled,false);
   const groups=await assertSucceeds(getDoc(doc(me,'app_config/chat_groups')));
   assert.equal(groups.data()?.enabled,false);
   await assertFails(getDoc(doc(me,limitFor(alice))));
   await assertFails(getDoc(doc(me,'chat_groups/closed-qa')));
   await assertFails(setDoc(doc(me,'app_config/conversations'),LAB_ONLY_ACTIVE_CHAT));
   await assertFails(setDoc(doc(me,'app_config/chat_groups'),{
     enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:true
   }));
   await env.withSecurityRulesDisabled(async ctx=>{
     await setDoc(doc(ctx.firestore(),'app_config/conversations'),LAB_ONLY_ACTIVE_CHAT);
   });
 });
 await test('cadastro QA: politica legivel mas config nao editavel pelo cliente',async()=>{
   const own=c(alice);
   await assertSucceeds(getDoc(doc(own,'app_config/email_verification')));
   await assertSucceeds(getDoc(doc(own,'app_config/community_rules')));
   await assertFails(getDoc(doc(unsigned,'app_config/email_verification')));
   await assertFails(setDoc(doc(own,'app_config/email_verification'),{
      enabled:false,version:'outdated'
   }));
   await assertFails(setDoc(doc(own,'app_config/community_rules'),{
      enabled:false,version:'outdated'
   }));
 });
 await test('cadastro QA: conta privada inicia antes do email e conclui apenas apos confirmar',async()=>{
   const path='users/'+alice+'/private/account';
   const data=()=>({onboardingStatus:'pending_email',profileVersion:2,
     noticesOptIn:false,communityUpdates:false,updatedAt:serverTimestamp()});
   await assertFails(setDoc(doc(c(bob),path),data()));
   await assertFails(setDoc(doc(unsigned,path),data()));
   await assertFails(setDoc(doc(c(alice),path),{...data(),isAdmin:true}));
   await assertFails(setDoc(doc(c(alice),path),{...data(),onboardingStatus:'complete'}));
   await assertSucceeds(setDoc(doc(unverified,path),data()));
   await assertSucceeds(getDoc(doc(unverified,path)));
   await assertFails(getDoc(doc(c(bob),path)));
   await assertFails(setDoc(doc(unverified,path),{
     ...data(),onboardingStatus:'complete'
   }));
   const afterDenied=await assertSucceeds(getDoc(doc(unverified,path)));
   assert.equal(afterDenied.data()?.onboardingStatus,'pending_email');
   await assertFails(setDoc(doc(c(alice),path),{
     ...data(),onboardingStatus:'complete',role:'admin'
   }));
   await assertSucceeds(setDoc(doc(c(alice),path),{
     ...data(),onboardingStatus:'complete'
   },{merge:true}));
   const afterConfirmed=await assertSucceeds(getDoc(doc(c(alice),path)));
   assert.equal(afterConfirmed.data()?.onboardingStatus,'complete');
   await assertFails(setDoc(doc(c(alice),path),data()));
 });
 await test('cadastro QA: perfil e aceite próprios com campos exatos e timestamps de servidor',async()=>{
   const profile='profiles/'+alice,consent='community_consents/'+alice;
   const p=()=>({displayName:'Adulto QA',createdAt:serverTimestamp()});
   const accepted=()=>({version:'2026-11-v1',acceptedAt:serverTimestamp()});
   await assertFails(setDoc(doc(c(bob),profile),p()));
   await assertFails(setDoc(doc(c(alice),profile),{...p(),isModerator:true}));
   await assertFails(setDoc(doc(c(alice),profile),{...p(),displayName:'X'}));
   await assertSucceeds(setDoc(doc(unverified,profile),p()));
   await assertSucceeds(getDoc(doc(c(alice),profile)));
   await assertFails(getDoc(doc(c(bob),profile)));
   await assertFails(setDoc(doc(unverified,profile),p()));
   await assertSucceeds(setDoc(doc(c(alice),profile),{displayName:'Perfil Novo',createdAt:serverTimestamp()}));
   await assertFails(setDoc(doc(c(bob),consent),accepted()));
   await assertFails(setDoc(doc(c(alice),consent),{...accepted(),role:'admin'}));
   await assertFails(setDoc(doc(c(alice),consent),{...accepted(),version:'fake'}));
   await assertFails(setDoc(doc(c(alice),consent),{version:'2026-11-v1'}));
   await assertFails(setDoc(doc(c(alice),consent),{...accepted(),acceptedAt:'fake'}));
   await assertFails(setDoc(doc(c(alice),consent),{
     ...accepted(),acceptedAt:Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'))
   }));
   await assertSucceeds(setDoc(doc(unverified,consent),accepted()));
   const serverAccepted=await assertSucceeds(getDoc(doc(c(alice),consent)));
   assert.ok(serverAccepted.data()?.acceptedAt instanceof Timestamp);
   await assertFails(getDoc(doc(c(bob),consent)));
   await assertSucceeds(deleteDoc(doc(c(alice),consent)));
 });
 await test('cadastro QA: preferencias de fé somente privadas, opcionais e com aceite',async()=>{
   const path='users/'+alice+'/private/preferences';
   const prefs=()=>({interests:['Oração','Comunidade'],participation:'Leigo(a)',
     city:'Fortaleza',parish:'',consentVersion:'cadastro-v2-2026-11',
     consentAt:serverTimestamp(),updatedAt:serverTimestamp()});
   await assertFails(setDoc(doc(unverified,path),prefs()));
   await assertFails(setDoc(doc(c(bob),path),prefs()));
   await assertFails(setDoc(doc(c(alice),path),{...prefs(),role:'Padre'}));
   await assertFails(setDoc(doc(c(alice),path),{...prefs(),consentVersion:'none'}));
   await assertFails(setDoc(doc(c(alice),path),{...prefs(),interests:['other']}));
   await assertFails(setDoc(doc(c(alice),path),{...prefs(),city:'X'.repeat(81)}));
   await assertSucceeds(setDoc(doc(c(alice),path),prefs()));
   await assertSucceeds(getDoc(doc(c(alice),path)));
   await assertFails(getDoc(doc(c(bob),path)));
   await assertSucceeds(deleteDoc(doc(c(alice),path)));
 });
 await test('sem autodeclaração, chat não libera',async()=>{
   await assertFails(getDoc(doc(c(alice),limitFor(alice))));
   await assertFails(getDoc(doc(c(bob),limitFor(bob))));
 });
 await test('cliente não pode declarar por outro UID nem usar valores inválidos',async()=>{
   await assertFails(setDoc(doc(c(bob),pathFor(alice)),claim()));
   await assertFails(setDoc(doc(unsigned,pathFor(alice)),claim()));
   const wrongStatus={...claim(),status:'eligible'};
   await assertFails(setDoc(doc(c(alice),pathFor(alice)),wrongStatus));
   await assertFails(setDoc(doc(c(alice),pathFor(alice)),{...claim(),minimumAge:16}));
   await assertFails(setDoc(doc(c(alice),pathFor(alice)),{...claim(),cpf:'00000000000'}));
   await assertFails(setDoc(doc(c(alice),pathFor(alice)),{...claim(),reviewExpiresAt:Timestamp.fromDate(new Date(Date.now()+400*86400000))}));
   await assertFails(getDoc(doc(c(alice),limitFor(alice))));
 });
 await test('declaração do próprio UID habilita somente conta autenticada e verificada',async()=>{
   await assertSucceeds(setDoc(doc(c(alice),pathFor(alice)),claim()));
   await assertSucceeds(getDoc(doc(c(alice),limitFor(alice))));
   await assertFails(getDoc(doc(unverified,limitFor(alice))));
   await assertFails(getDoc(doc(c(bob),pathFor(alice))));
   await assertFails(getDoc(doc(c(bob),limitFor(bob))));
 });
 await test('política administrativa ausente ou desativada nega acesso apesar da declaração',async()=>{
   const configPath='app_config/conversations';
   const active={enabled:true,version:'2026-11-v1',
     minorPolicyApproved:true,safetyReviewVersion:'2026-11-safety-v1'};
   for(const denied of [
     {...active,enabled:false},
     {...active,minorPolicyApproved:false},
     {...active,safetyReviewVersion:'unreviewed'},
     {...active,version:'outdated'}
   ]){
     await env.withSecurityRulesDisabled(async ctx=>{
       await setDoc(doc(ctx.firestore(),configPath),denied);
     });
     await assertFails(getDoc(doc(c(alice),limitFor(alice))));
   }
   await env.withSecurityRulesDisabled(async ctx=>{
     await deleteDoc(doc(ctx.firestore(),configPath));
   });
   await assertFails(getDoc(doc(c(alice),limitFor(alice))));
   await env.withSecurityRulesDisabled(async ctx=>{
     await setDoc(doc(ctx.firestore(),configPath),active);
   });
   await assertSucceeds(getDoc(doc(c(alice),limitFor(alice))));
 });
 await test('elegibilidade expirada, revogada, adulterada ou antiga falha fechada',async()=>{
   const bad=[
     {...claim(),reviewExpiresAt:Timestamp.fromDate(new Date(Date.now()-60000))},
     {...claim(),status:'revoked'},
     {...claim(),policyVersion:'2026-11-18plus-qa-v1'},
     {...claim(),birthDate:'2000-01-01'},
     {...claim(),minimumAge:'18'}
   ];
   for(const invalid of bad){
     await env.withSecurityRulesDisabled(async ctx=>{
       await setDoc(doc(ctx.firestore(),pathFor(alice)),invalid);
     });
     await assertFails(getDoc(doc(c(alice),limitFor(alice))));
   }
   await env.withSecurityRulesDisabled(async ctx=>{
     await setDoc(doc(ctx.firestore(),pathFor(alice)),claim());
   });
   await assertSucceeds(getDoc(doc(c(alice),limitFor(alice))));
 });
 await test('grupos exigem permissões administrativas e participação além da declaração',async()=>{
   const groupId='qa-auditoria-privado';
   const groupPath='chat_groups/'+groupId;
   const groupPolicy={enabled:true,minorPolicyApproved:true,version:'2026-11-groups-v1'};
   const groupAccess={status:'approved',policyVersion:'2026-11-group-safety-v1',
     reviewExpiresAt:Timestamp.fromDate(new Date(Date.now()+30*86400000))};
   await env.withSecurityRulesDisabled(async ctx=>{
     const db=ctx.firestore();
     await setDoc(doc(db,'app_config/chat_groups'),groupPolicy);
     await setDoc(doc(db,'users/'+alice+'/chatGroupAccess/eligibility'),groupAccess);
     await setDoc(doc(db,groupPath),{memberUids:[alice,bob],adminUids:[alice],
       status:'active',ownerUid:alice});
   });
   await assertSucceeds(getDoc(doc(c(alice),groupPath)));
   // Segundo usuário consta como membro, porém não tem declaração 18+.
   await assertFails(getDoc(doc(c(bob),groupPath)));
   // Declaração 18+ não concede a permissão administrativa de grupos.
   await assertSucceeds(setDoc(doc(c(bob),pathFor(bob)),claim()));
   await assertFails(getDoc(doc(c(bob),groupPath)));
   // Mesmo o usuário autorizado por admin perde o acesso sem o seu registro.
   await env.withSecurityRulesDisabled(async ctx=>{
     await deleteDoc(doc(ctx.firestore(),
       'users/'+alice+'/chatGroupAccess/eligibility'));
   });
   await assertFails(getDoc(doc(c(alice),groupPath)));
   await env.withSecurityRulesDisabled(async ctx=>{
     await setDoc(doc(ctx.firestore(),
       'users/'+alice+'/chatGroupAccess/eligibility'),groupAccess);
     await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),
       {...groupPolicy,enabled:false});
   });
   await assertFails(getDoc(doc(c(alice),groupPath)));
   await env.withSecurityRulesDisabled(async ctx=>{
     await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),groupPolicy);
   });
   await assertSucceeds(getDoc(doc(c(alice),groupPath)));
 });
 await test('QA: protocolos existentes seguem legíveis com chats suspensos sem expor DMs',async()=>{
   // Somente fixtures sintéticas: nenhuma criação de protocolo em Firebase real.
   const reviewer='qa-moderation-reviewer';
   const dmReport='chat_reports/qa-report-sintetico';
   const groupReport='chat_group_reports/qa-group-report-sintetico';
   await env.withSecurityRulesDisabled(async ctx=>{
     const internal=ctx.firestore();
     await setDoc(doc(internal,'admins/'+reviewer),{enabled:true});
     await setDoc(doc(internal,'chats/qa-room-sintetico'),{
       participants:[alice,bob],status:'accepted'
     });
     await setDoc(doc(internal,'chats/qa-room-sintetico/messages/qa-message'),{
       uid:alice,kind:'text',text:'Mensagem fictícia de teste'
     });
     await setDoc(doc(internal,dmReport),{
       chatId:'qa-room-sintetico',messageId:'qa-message',
       reporterUid:alice,reason:'Teste de denúncia QA',
       reportedText:'Mensagem fictícia de teste',createdAt:serverTimestamp()
     });
     await setDoc(doc(internal,groupReport),{
       groupId:'qa-group-sintetico',messageId:'qa-message',
       reporterUid:alice,reason:'Teste de denúncia QA',
       reportedText:'Mensagem fictícia de teste',createdAt:serverTimestamp()
     });
     await setDoc(doc(internal,'app_config/conversations'),{
       enabled:false,version:'2026-11-v1',minorPolicyApproved:false,
       safetyReviewVersion:'2026-11-safety-v1'
     });
     await setDoc(doc(internal,'app_config/chat_groups'),{
       enabled:false,version:'2026-11-groups-v1',minorPolicyApproved:false
     });
   });
   const reporter=c(alice),thirdParty=c(bob),admin=c(reviewer);
   const ownDm=await assertSucceeds(getDoc(doc(reporter,dmReport)));
   const ownGroup=await assertSucceeds(getDoc(doc(reporter,groupReport)));
   assert.equal(ownDm.data()?.reporterUid,alice);
   assert.equal(ownGroup.data()?.reporterUid,alice);
   await assertFails(getDoc(doc(thirdParty,dmReport)));
   await assertFails(getDoc(doc(thirdParty,groupReport)));
   await assertFails(getDocs(collection(reporter,'chat_reports')));
   await assertFails(getDocs(collection(reporter,'chat_group_reports')));
   await assertSucceeds(getDoc(doc(admin,dmReport)));
   await assertSucceeds(getDoc(doc(admin,groupReport)));
   await assertSucceeds(getDocs(collection(admin,'chat_reports')));
   await assertSucceeds(getDocs(collection(admin,'chat_group_reports')));
   await assertFails(getDoc(doc(admin,'chats/qa-room-sintetico/messages/qa-message')));
   await assertFails(getDoc(doc(reporter,'chats/qa-room-sintetico/messages/qa-message')));
   await assertFails(deleteDoc(doc(reporter,dmReport)));
   await assertFails(deleteDoc(doc(admin,groupReport)));
   await assertFails(setDoc(doc(reporter,'chat_reports/qa-while-disabled'),{
     chatId:'qa-room-sintetico',messageId:'qa-message',
     reporterUid:alice,reason:'Denúncia tardia',
     reportedText:'Mensagem fictícia de teste',createdAt:serverTimestamp()
   }));
 });
 await test('declaração existente não pode ser atualizada, apagada nem convertida em prova',async()=>{
   await assertFails(setDoc(doc(c(alice),pathFor(alice)),claim()));
   await assertFails(deleteDoc(doc(c(alice),pathFor(alice))));
   await env.withSecurityRulesDisabled(async ctx=>{
     await setDoc(doc(ctx.firestore(),pathFor(alice)),{
       ...claim(),status:'revoked'
     });
   });
   await assertFails(getDoc(doc(c(alice),limitFor(alice))));
   await assertFails(setDoc(doc(c(alice),pathFor(alice)),claim()));
 });
}finally{await env.cleanup();}
console.log('Emulador: self-declaracao QA testada. SEM verificação etária real, SEM deploy.');
