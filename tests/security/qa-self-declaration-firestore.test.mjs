// TESTES EXCLUSIVAMENTE NO FIREBASE EMULATOR. SEM PROJETO REAL OU PRODUÇÃO.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderSelfDeclarationRules} from '../../firebase/qa-general/self-declaration-candidate.mjs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
 from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,deleteDoc,Timestamp} from 'firebase/firestore';

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
 await test('rotas de onboarding real ainda bloqueadas por Rules QA candidatas',async()=>{
   // O aplicativo usa essas rotas durante cadastro e confirmação do email.
   // Enquanto não houver política QA específica aprovada, fail-closed.
   const db=c(alice);
   await assertFails(getDoc(doc(db,'app_config/email_verification')));
   await assertFails(getDoc(doc(db,'app_config/community_rules')));
   await assertFails(setDoc(doc(db,'users/'+alice+'/private/account'),{
     onboardingStatus:'pending_email',profileVersion:2,
     noticesOptIn:false,communityUpdates:false
   }));
   await assertFails(setDoc(doc(db,'community_consents/'+alice),{
     version:'2026-11-v1'
   }));
   await assertFails(setDoc(doc(db,'profiles/'+alice),{
     displayName:'Conta QA Sintética'
   }));
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
