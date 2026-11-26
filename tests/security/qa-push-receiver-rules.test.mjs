import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,query,where,limit,getDoc,getDocs,setDoc,updateDoc,deleteDoc,Timestamp} from 'firebase/firestore';
import {renderPushReceiverRules,reviewedSnapshot} from '../../firebase/qa-geral-celular/pilot/push-receiver-rules.mjs';
const baseline=reviewedSnapshot();
const rules=renderPushReceiverRules(baseline);
test('exact audited snapshot only; original permissions preserved byte-for-byte',()=>{
  assert.throws(()=>renderPushReceiverRules({...baseline,projectId:'atrio-catolico'}),/unreviewed/);
  assert.throws(()=>renderPushReceiverRules({...baseline,source:baseline.source+' '}),/unreviewed/);
  assert.throws(()=>renderPushReceiverRules({...baseline,rulesetName:'other'}),/unreviewed/);
  const start=rules.indexOf('    // Candidato OFFLINE:');
  const end=rules.lastIndexOf('    match /{document=**}');
  assert.ok(start>0&&end>start);
  assert.equal(rules.slice(0,start)+rules.slice(end),baseline.source);
  assert.ok(!rules.slice(start,end).includes('match /chat_groups/'));
});
const host=process.env.FIRESTORE_EMULATOR_HOST||'';
assert.match(host,/^127\.0\.0\.1:\d+$/);
const port=Number(host.split(':')[1]);
test('receiver reads only the admitted QA pair; denies writes, groups, global list and stale eligibility',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-atrio-v11',firestore:{host:'127.0.0.1',port,rules}});
 const alice='qa-nav-alice',bob='qa-nav-bob',room='chats/'+alice+'__'+bob, msg=room+'/messages/m1';
 const age=uid=>'users/'+uid+'/chatAgeEligibility/current';
 const config='app_config/conversations';
 const future=Timestamp.fromMillis(Date.now()+3600000);
 const cfg={enabled:true,minorPolicyApproved:true,version:'2026-11-v1',safetyReviewVersion:'2026-11-safety-v1',
  pushPilot:{enabled:true,projectId:'atrio-catolico-qa-general',databaseId:'(default)',ageMode:'eligible',roundId:'qa-199-push-isolado',expiresAt:future}};
 const proof={status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:future};
 const data={participants:[alice,bob],requesterUid:alice,recipientUid:bob,status:'accepted'};
 const write=async rows=>env.withSecurityRulesDisabled(async c=>{for(const [p,v] of rows){if(v===null)await deleteDoc(doc(c.firestore(),p));else await setDoc(doc(c.firestore(),p),v)}});
 try{
  await env.clearFirestore();
  await write([[config,cfg],[age(alice),proof],[age(bob),proof],[room,data],[msg,{uid:alice,text:'fixture',kind:'text'}],
   ['users/'+bob+'/chatPushAdmission/current',{status:'active'}],['users/'+bob+'/chatPushPending/current',{unread:true}],
   ['chat_groups/fixture',{members:[alice,bob]}],['admins/qa-nav-moderador',{enabled:true}],
   ['chat_reports/fixture',{reporterUid:alice}],['chat_group_reports/fixture',{reporterUid:alice}]]);
  const session=(uid,email)=>env.authenticatedContext(uid,{email,email_verified:true}).firestore();
  const a=session(alice,'alice.navegacao@qa.invalid'),b=session(bob,'bob.navegacao@qa.invalid');
  const m=session('qa-nav-moderador','moderador.navegacao@qa.invalid');
  const x=session('external','external@qa.invalid');
  for(const d of [a,b]){await assertSucceeds(getDoc(doc(d,room)));await assertSucceeds(getDoc(doc(d,msg)));
   await assertFails(getDocs(query(collection(d,'chats'),where('participants','array-contains',d===a?alice:bob),limit(10))));
   await assertFails(getDocs(collection(d,room+'/messages')));
   await assertFails(setDoc(doc(d,room+'/messages/new'),{uid:alice,text:'forged'}));
   await assertFails(updateDoc(doc(d,room),{status:'accepted'}));
   await assertFails(getDoc(doc(d,'chat_groups/fixture')));}
  for(const d of [m,x])await assertFails(getDoc(doc(d,msg)));
  for(const path of [age(bob),'users/'+bob+'/chatPushAdmission/current','users/'+bob+'/chatPushPending/current','qaAge18RestorationAuthorizations/fixture']){
   await assertFails(setDoc(doc(b,path),{status:'active'}));}
  await assertFails(getDoc(doc(b,'users/'+bob+'/chatPushAdmission/current')));
  await assertFails(getDoc(doc(b,'users/'+bob+'/chatPushPending/current')));
  // Preserve published evidence permissions, not a new moderation grant.
  await assertSucceeds(getDoc(doc(a,'chat_reports/fixture')));
  await assertSucceeds(getDocs(collection(m,'chat_reports')));
  await assertSucceeds(getDocs(collection(m,'chat_group_reports')));
  await assertFails(setDoc(doc(a,'chat_reports/new'),{reporterUid:alice}));
  for(const rows of [
   [[age(bob),{...proof,status:'revoked'}]],
   [[age(bob),{...proof,reviewExpiresAt:Timestamp.fromMillis(0)}]],
   [[age(bob),proof],['users/'+alice+'/blockedMembers/'+bob,{createdAt:future}]],
   [['users/'+alice+'/blockedMembers/'+bob,null],['users/'+bob+'/blockedMembers/'+alice,{createdAt:future}]],
   [['users/'+bob+'/blockedMembers/'+alice,null],[config,{...cfg,pushPilot:{...cfg.pushPilot,expiresAt:Timestamp.fromMillis(0)}}]],
   [[config,cfg],[room,{...data,status:'pending'}]]
  ]){await write(rows);await assertFails(getDoc(doc(b,msg)));await assertFails(getDoc(doc(a,room)));}
 }finally{await env.cleanup();}
});
