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
