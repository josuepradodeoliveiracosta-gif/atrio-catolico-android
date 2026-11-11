// Projeto fictício, exclusivamente Firebase Emulator. SEM credenciais ou deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails}
 from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,getDocs,collection,Timestamp}
 from 'firebase/firestore';
import {renderClosedBetaSelfDeclarationRules}
 from '../../firebase/qa-general/closed-beta-rules.mjs';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const rules=renderClosedBetaSelfDeclarationRules(
 read('../../firebase/atrio-conversas-v1.rules.fragment'),
 read('../../firebase/atrio-grupos-v1.rules.fragment')
);
const env=await initializeTestEnvironment({
 projectId:'demo-atrio-v11',
 firestore:{host:'127.0.0.1',port:8089,rules}
});
const alice='qa-tester-fixture-alice';
const bob='qa-tester-fixture-bob';
const c=(uid,email_verified=true)=>env.authenticatedContext(uid,{email_verified}).firestore();
const proof=()=>({
 status:'declared_18_plus',minimumAge:18,
 policyVersion:'2026-11-selfdecl-qa-v1',
 reviewExpiresAt:Timestamp.fromDate(new Date(Date.now()+30*86400000))
});
const member=()=>({
 enabled:true,policyVersion:'2026-11-closed-beta-qa-v1',
 reviewExpiresAt:Timestamp.fromDate(new Date(Date.now()+15*86400000))
});
const ticket=uid=>'qa_closed_testers/'+uid;
const age=uid=>'users/'+uid+'/chatAgeEligibility/current';
const limit=uid=>'users/'+uid+'/chatLimits/requests';
const withRoot=async cb=>env.withSecurityRulesDisabled(
 async context=>cb(context.firestore())
);
try{
 await env.clearFirestore();
 await withRoot(async db=>{
  await setDoc(doc(db,'app_config/conversations'),{
   enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
   safetyReviewVersion:'2026-11-safety-v1'
  }); // APENAS fixture de emulador, nunca publicar configuração "aberta".
  await setDoc(doc(db,age(alice)),proof());
  await setDoc(doc(db,age(bob)),proof());
 });
 await test('mesmo adulto autodeclarado e email verificado permanece barrado sem convite QA',async()=>{
  await assertFails(getDoc(doc(c(alice),limit(alice))));
  await assertFails(getDoc(doc(c(bob),limit(bob))));
  await assertFails(getDoc(doc(c(alice),ticket(alice))));
  await assertFails(getDocs(collection(c(alice),'qa_closed_testers')));
  await assertFails(setDoc(doc(c(alice),ticket(alice)),member()));
  await assertFails(setDoc(doc(c(alice),ticket(bob)),member()));
 });
 await test('administrador fictício provisiona somente no setup do emulador',async()=>{
  await withRoot(async db=>{await setDoc(doc(db,ticket(alice)),member());});
  await assertSucceeds(getDoc(doc(c(alice),limit(alice))));
  await assertFails(getDoc(doc(c(alice,false),limit(alice))));
  await assertFails(getDoc(doc(c(bob),limit(bob))));
  await assertFails(getDoc(doc(c(alice),ticket(alice))));
  await assertFails(getDoc(doc(c(bob),ticket(alice))));
 });
 await test('testador removido, expirado ou com campos extras volta a ser bloqueado',async()=>{
  for(const invalid of [
   {...member(),enabled:false},
   {...member(),policyVersion:'outdated'},
   {...member(),reviewExpiresAt:Timestamp.fromDate(new Date(Date.now()-100000))},
   {...member(),role:'ADMIN'},
   {...member(),email:'invalido@example.invalid'}
  ]){
   await withRoot(async db=>{await setDoc(doc(db,ticket(alice)),invalid);});
   await assertFails(getDoc(doc(c(alice),limit(alice))));
  }
  await withRoot(async db=>{await setDoc(doc(db,ticket(alice)),member());});
  await assertSucceeds(getDoc(doc(c(alice),limit(alice))));
  await withRoot(async db=>{await setDoc(doc(db,ticket(alice)),{enabled:false});});
  await assertFails(getDoc(doc(c(alice),limit(alice))));
 });
 await test('nenhum cliente pode listar, apagar, atualizar ou se autoincluir',async()=>{
  await assertFails(setDoc(doc(c(alice),ticket(alice)),member()));
  await assertFails(setDoc(doc(c(bob),ticket(bob)),member()));
  await assertFails(getDocs(collection(c(bob),'qa_closed_testers')));
  await assertFails(getDoc(doc(c(bob),ticket(alice))));
 });
}finally{
 await env.cleanup();
}
