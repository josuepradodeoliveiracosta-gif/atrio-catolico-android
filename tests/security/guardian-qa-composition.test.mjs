import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,setDoc,deleteDoc,collectionGroup} from 'firebase/firestore';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
assert.ok(process.env.GUARDIAN_QA_BOUNDARY_RULES_PATH);
const projectId='demo-atrio-guardian-boundary';
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8089,rules:readFileSync(process.env.GUARDIAN_QA_BOUNDARY_RULES_PATH,'utf8')}});
const normal=env.authenticatedContext('ordinary_user').firestore();
const claimed=env.authenticatedContext('ordinary_claimed',{guardianQaRole:'triage'}).firestore();
const anon=env.unauthenticatedContext().firestore();
const triage=env.authenticatedContext('fixture_triage',{guardianQaRole:'triage'}).firestore();
const activation=env.authenticatedContext('fixture_activation',{guardianQaRole:'activation'}).firestore();
const noClaim=env.authenticatedContext('fixture_triage').firestore();
try{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
   const db=c.firestore();
   for(const path of ['legacy_posts/a','legacy_posts/a/legacy_replies/b','public_fixture/a','qa_guardian_cases/fixture_a','qa_guardian_cases/fixture_a/legacy_replies/c','qa_guardian_principals/fixture_triage']){
     await setDoc(doc(db,path),{body:'synthetic'});
   }
 });
 await assertSucceeds(getDoc(doc(normal,'legacy_posts/a')));
 await assertSucceeds(getDocs(collection(normal,'legacy_posts')));
 await assertSucceeds(setDoc(doc(normal,'legacy_posts/new'),{body:'synthetic'}));
 await assertSucceeds(getDoc(doc(anon,'public_fixture/a')));
 console.log('GUARDIAN COMPOSITION PASS legacy get list create and public get');
 for(const db of [triage,activation,noClaim,claimed]){
   await assertFails(getDoc(doc(db,'legacy_posts/a')));
   await assertFails(getDocs(collection(db,'legacy_posts')));
   await assertFails(getDoc(doc(db,'public_fixture/a')));
   await assertFails(setDoc(doc(db,'legacy_posts/forbidden'),{body:'synthetic'}));
 }
 console.log('GUARDIAN COMPOSITION PASS all guardian identities denied by legacy allows');
 await assertFails(getDoc(doc(normal,'qa_guardian_cases/fixture_a')));
 await assertFails(getDocs(collection(normal,'qa_guardian_cases')));
 await assertFails(setDoc(doc(normal,'qa_guardian_cases/fixture_new'),{body:'synthetic'}));
 await assertFails(deleteDoc(doc(normal,'qa_guardian_principals/fixture_triage')));
 await assertFails(getDoc(doc(normal,'qa_guardian_cases/fixture_a/legacy_replies/c')));
 console.log('GUARDIAN COMPOSITION PASS legacy wildcard cannot read or write reserved namespace');
 // A collection-group query that might include reserved paths must fail closed.
 await assertFails(getDocs(collectionGroup(normal,'legacy_replies')));
 console.log('GUARDIAN COMPOSITION PASS mixed collection group cannot expose reserved descendants');
 console.log('GUARDIAN COMPOSITION: 4 scenarios');
}finally{await env.cleanup();}
