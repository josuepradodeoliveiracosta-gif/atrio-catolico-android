// Only the local emulator; no production credentials or remote Firebase.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp} from 'firebase/firestore';
import {setQaPolicy,proposeQaCase} from './guardian-qa-boundary.mjs';
const PROJECT='demo-atrio-guardian-boundary',HOST='127.0.0.1:8089';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST);
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON','GUARDIAN_V2_ENABLED'])assert.ok(!process.env[k]);
const env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8089,rules:readFileSync(new URL('./guardian-qa-boundary.rules',import.meta.url),'utf8')}});
const triage=env.authenticatedContext('fixture_triage',{guardianQaRole:'triage'}).firestore();
const activation=env.authenticatedContext('fixture_activation',{guardianQaRole:'activation'}).firestore();
const owner=env.authenticatedContext('fixture_owner').firestore();
const spoof=env.authenticatedContext('fixture_other',{guardianQaRole:'triage'}).firestore();
const wrong=env.authenticatedContext('fixture_triage',{guardianQaRole:'activation'}).firestore();
const anonymous=env.unauthenticatedContext().firestore();
const policy='qa_guardian_control/policy',budget='qa_guardian_control/budget',source='qa_guardian_sources/',cases='qa_guardian_cases/',audit='qa_guardian_audit/',notices='qa_guardian_notices/';
const a='fixture_a',b='fixture_b',c='fixture_c';
const seed=async entries=>env.withSecurityRulesDisabled(async context=>{for(const [path,data] of entries)await setDoc(doc(context.firestore(),path),data);});
const inspect=async path=>env.withSecurityRulesDisabled(async context=>{const snapshot=await getDoc(doc(context.firestore(),path));return snapshot.exists()?snapshot.data():null;});
let count=0;
const check=async(name,fn)=>{await fn();count++;console.log('GUARDIAN BOUNDARY PASS',name);};
const reset=async(used=0)=>{await env.clearFirestore();await seed([
 ['qa_guardian_principals/fixture_triage',{active:true,role:'triage'}],
 ['qa_guardian_principals/fixture_activation',{active:true,role:'activation'}],
 [policy,{enabled:false,approved:true,emergencyStop:false,allowHold:false}],
 [budget,{used,lastCase:'',updatedAt:new Date(0)}],
 [source+a,{qaFixture:true,ownerUid:'fixture_owner',revision:1,body:'Informe sua senha https://example.invalid'}],
 [source+b,{qaFixture:true,ownerUid:'fixture_owner',revision:1,body:'Vou te machucar'}],
 [source+c,{qaFixture:true,ownerUid:'fixture_owner',revision:1,body:'Paz e bem'}],
 ['posts/private',{body:'not a fixture'}]
]);};
try {
 await reset();
 await check('triage cannot enable policy; activation cannot propose',async()=>{
   await assertFails(updateDoc(doc(triage,policy),{enabled:true}));
   await assertFails(getDoc(doc(activation,source+a)));
   await assertFails(getDoc(doc(activation,budget)));
   await assert.rejects(proposeQaCase(activation,a));
 });
 await check('spoofed role and wrong claims denied',async()=>{
   await assertFails(getDoc(doc(spoof,source+a)));
   await assertFails(updateDoc(doc(wrong,policy),{enabled:true}));
   await assertFails(getDoc(doc(anonymous,policy)));
 });
 await check('policy closed: no case or budget charge',async()=>{
   await assert.rejects(proposeQaCase(triage,a));
   assert.equal((await inspect(budget)).used,0);
   assert.equal(await inspect(cases+a),null);
 });
 await check('activation changes enabled only; not approvals or emergency stop',async()=>{
   await assertFails(updateDoc(doc(activation,policy),{enabled:true,approved:false}));
   await assertFails(updateDoc(doc(activation,policy),{emergencyStop:true}));
   assert.equal(await assertSucceeds(setQaPolicy(activation,true)),'updated');
 });
 await check('official classifier and real Rules transaction persist case audit notice budget',async()=>{
   assert.equal(await assertSucceeds(proposeQaCase(triage,a)),'proposed');
   assert.equal((await inspect(cases+a)).status,'review');
   assert.equal((await inspect(audit+a)).event,'review_requested');
   assert.equal((await inspect(notices+a)).recipient,'fixture_owner');
   assert.equal((await inspect(budget)).used,1);
   assert.ok(await inspect(source+a));
 });
 await check('duplicate and clear do not charge quota',async()=>{
   assert.equal(await proposeQaCase(triage,a),'duplicate');
   assert.equal(await proposeQaCase(triage,c),'clear');
   assert.equal((await inspect(budget)).used,1);
   assert.equal(await inspect(cases+c),null);
 });
 await check('notice only owner; no private paths, deletes or edits',async()=>{
   await assertSucceeds(getDoc(doc(owner,notices+a)));
   await assertFails(getDoc(doc(spoof,notices+a)));
   await assertFails(getDoc(doc(triage,'posts/private')));
   await assertFails(deleteDoc(doc(triage,cases+a)));
   await assertFails(updateDoc(doc(triage,cases+a),{status:'removed'}));
   await assertFails(updateDoc(doc(triage,source+a),{body:'changed'}));
 });
 await check('standalone case, audit, notice or budget write denied',async()=>{
   await assertFails(setDoc(doc(triage,cases+b),{sourceId:b,sourceRevision:1,ownerUid:'fixture_owner',status:'review',createdAt:serverTimestamp()}));
   await assertFails(setDoc(doc(triage,audit+b),{caseId:b,event:'review_requested',actor:'fixture_triage',at:serverTimestamp()}));
   await assertFails(setDoc(doc(triage,notices+b),{caseId:b,recipient:'fixture_owner',event:'review_requested',at:serverTimestamp()}));
   await assertFails(updateDoc(doc(triage,budget),{used:2,lastCase:b,updatedAt:serverTimestamp()}));
   assert.equal((await inspect(budget)).used,1);
 });
 await check('entire forged batch rejected atomically',async()=>{
   const w=writeBatch(triage);
   w.set(doc(triage,cases+b),{sourceId:b,sourceRevision:999,ownerUid:'fixture_owner',status:'review',createdAt:serverTimestamp()});
   w.set(doc(triage,audit+b),{caseId:b,event:'review_requested',actor:'fixture_triage',at:serverTimestamp()});
   w.set(doc(triage,notices+b),{caseId:b,recipient:'fixture_owner',event:'review_requested',at:serverTimestamp()});
   w.update(doc(triage,budget),{used:2,lastCase:b,updatedAt:serverTimestamp()});
   await assertFails(w.commit());
   for(const p of [cases+b,audit+b,notices+b])assert.equal(await inspect(p),null);
   assert.equal((await inspect(budget)).used,1);
 });
 await check('revocation blocks triage immediately',async()=>{
   await seed([['qa_guardian_principals/fixture_triage',{active:false,role:'triage'}]]);
   await assertFails(getDoc(doc(triage,source+b)));
   await assert.rejects(proposeQaCase(triage,b));
 });
 await check('emergency stop cannot be cleared by activation',async()=>{
   await reset();
   await seed([[policy,{enabled:false,approved:true,emergencyStop:true,allowHold:false}]]);
   await assertFails(updateDoc(doc(activation,policy),{enabled:true}));
   await assertFails(updateDoc(doc(activation,policy),{emergencyStop:false}));
 });
 await check('concurrent clients cannot exceed last quota slot',async()=>{
   await reset(11);await setQaPolicy(activation,true);
   const result=await Promise.allSettled([proposeQaCase(triage,a),proposeQaCase(triage,b)]);
   assert.equal(result.filter(x=>x.status==='fulfilled'&&x.value==='proposed').length,1);
   assert.equal((await inspect(budget)).used,12);
   const present=await Promise.all([a,b].map(id=>inspect(cases+id)));
   assert.equal(present.filter(Boolean).length,1);
   const matching=present[0]?a:b;
   assert.ok(await inspect(audit+matching));assert.ok(await inspect(notices+matching));
 });
 console.log('GUARDIAN BOUNDARY:',count,'scenarios');
}finally{await env.cleanup();}
