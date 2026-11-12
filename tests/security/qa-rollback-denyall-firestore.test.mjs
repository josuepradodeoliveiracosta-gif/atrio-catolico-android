// A referencia de reversao deve negar ABSOLUTAMENTE todas as operacoes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,deleteDoc,getDocs,collection} from 'firebase/firestore';
const rules=readFileSync(new URL('../../firebase/qa-general/qa-deny-all-reference.rules',import.meta.url),'utf8');
test('regra de reversao tem apenas allow false',()=>{
 assert.match(rules,/allow read, write: if false;/);
 assert.doesNotMatch(rules,/allow\s+(read|write|get|list|create|update|delete):\s*if\s+true;/);
});
const env=await initializeTestEnvironment({projectId:'demo-atrio-v11',
 firestore:{host:'127.0.0.1',port:8089,rules}});
try {
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,'chats/qa1'),{participants:['qa-a','qa-b'],status:'accepted'});
  await setDoc(doc(db,'chat_groups/group1'),{memberUids:['qa-a','qa-b'],status:'active'});
  await setDoc(doc(db,'users/qa-a/chatAgeEligibility/current'),{status:'declared_18_plus'});
  await setDoc(doc(db,'app_config/conversations'),{enabled:true,minorPolicyApproved:true});
 });
 await test('mesmo autenticado admin tem leitura e escrita negadas',async()=>{
  const db=env.authenticatedContext('qa-a',{email_verified:true}).firestore();
  for(const path of ['chats/qa1','chat_groups/group1',
      'users/qa-a/chatAgeEligibility/current','app_config/conversations']){
   await assertFails(getDoc(doc(db,path)));
   await assertFails(setDoc(doc(db,path),{status:'approved'}));
   await assertFails(deleteDoc(doc(db,path)));
  }
  await assertFails(getDocs(collection(db,'chats')));
 });
 await test('visitante e outro UID nao veem nenhuma colecao',async()=>{
  const anonymous=env.unauthenticatedContext().firestore();
  const other=env.authenticatedContext('qa-b',{email_verified:true}).firestore();
  for(const db of [anonymous,other]){
    await assertFails(getDoc(doc(db,'chats/qa1')));
    await assertFails(getDoc(doc(db,'chat_groups/group1')));
    await assertFails(getDoc(doc(db,'users/qa-a/chatAgeEligibility/current')));
  }
 });
}finally{await env.cleanup();}
