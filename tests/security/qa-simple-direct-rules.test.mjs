import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,query,limit,orderBy,setDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp,Timestamp} from 'firebase/firestore';
import {renderSimpleDirectRules} from '../../firebase/qa-geral-celular/pilot/simple-direct-rules.mjs';
import {reviewedSnapshot} from '../../firebase/qa-geral-celular/pilot/push-receiver-rules.mjs';
const snapshot=reviewedSnapshot(),rules=renderSimpleDirectRules(snapshot);
assert.throws(()=>renderSimpleDirectRules({...snapshot,projectId:'atrio-catolico'}),/unreviewed/);
const host=process.env.FIRESTORE_EMULATOR_HOST||'';
assert.match(host,/^127\.0\.0\.1:\d+$/);
test('QA direct: request, recipient decision, atomic send, bounded path, revocation and administrative isolation',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-atrio-v11',firestore:{host:'127.0.0.1',port:Number(host.split(':')[1]),rules}});
 const a='qa-nav-alice',b='qa-nav-bob',id=a+'__'+b,room='chats/'+id;
 const age=u=>'users/'+u+'/chatAgeEligibility/current';
 const config='app_config/conversations',privacy=u=>'users/'+u+'/chatSettings/privacy';
 const future=Timestamp.fromMillis(Date.now()+3600000);
 const proof={status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:future};
 const cfg={enabled:true,minorPolicyApproved:true,qaSimpleDirectEnabled:true,version:'2026-11-v1',safetyReviewVersion:'2026-11-safety-v1',
 pushPilot:{enabled:true,projectId:'atrio-catolico-qa-general',databaseId:'(default)',roundId:'qa-199-push-isolado',ageMode:'eligible',expiresAt:null}};
 const seed=async rows=>env.withSecurityRulesDisabled(async c=>{for(const [p,v] of rows){if(v===null)await deleteDoc(doc(c.firestore(),p));else await setDoc(doc(c.firestore(),p),v)}});
 const session=(uid,email,verified=true)=>env.authenticatedContext(uid,{email,email_verified:verified}).firestore();
 const A=session(a,'alice.navegacao@qa.invalid'),B=session(b,'bob.navegacao@qa.invalid');
 const X=session('external','external@qa.invalid'),N=session(a,'alice.navegacao@qa.invalid',false);
 const M=session('qa-nav-moderador','moderador.navegacao@qa.invalid');
 const op=(d,p)=>doc(d,p);
 try{
  await env.clearFirestore();
  await seed([[config,cfg],[age(a),proof],[age(b),proof],[privacy(b),{requests:'all'}],
   ['admins/qa-nav-moderador',{enabled:true}],['chat_reports/old',{reporterUid:a}],
   ['chat_groups/fixture',{memberUids:[a,b]}]]);
  await assertSucceeds(getDoc(op(A,'users/'+a+'/chatLimits/requests')));
  assert.equal((await assertSucceeds(getDoc(op(A,room)))).exists(),false);
  await assertFails(getDoc(op(A,'chats/other')));
  await seed([[config,{...cfg,qaSimpleDirectEnabled:false}]]);
  await assertFails(getDoc(op(A,room)));
  await seed([[config,cfg]]);
  const first=writeBatch(A);
  first.set(op(A,'users/'+a+'/chatLimits/requests'),{count:1,windowStart:serverTimestamp(),updatedAt:serverTimestamp(),lastChatId:id});
  first.set(op(A,room),{participants:[a,b],requesterUid:a,recipientUid:b,status:'pending',initialId:'m1',
    lastMessageId:'m1',lastPreview:'Ola QA',lastSenderUid:a,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),unreadRequester:0,unreadRecipient:1});
  first.set(op(A,room+'/messages/m1'),{uid:a,text:'Ola QA',kind:'text',createdAt:serverTimestamp()});
  await assertSucceeds(first.commit());
  await assertFails(updateDoc(op(A,room),{status:'accepted',updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(op(B,room),{status:'accepted',updatedAt:serverTimestamp()}));
  await assertSucceeds(getDoc(op(B,room+'/messages/m2')));
  const send=writeBatch(A);
  send.set(op(A,room+'/messages/m2'),{uid:a,text:'Mensagem QA',kind:'text',createdAt:serverTimestamp()});
  send.update(op(A,room),{lastMessageId:'m2',lastPreview:'Mensagem QA',lastSenderUid:a,updatedAt:serverTimestamp(),unreadRecipient:2});
  await assertSucceeds(send.commit());
  await assertSucceeds(getDoc(op(B,room+'/messages/m2')));
  await assertSucceeds(getDocs(query(collection(B,room+'/messages'),orderBy('createdAt','desc'),limit(40))));
  await assertFails(getDocs(collection(A,'chats')));
  await assertFails(setDoc(op(B,room+'/messages/forged'),{uid:a,text:'forged',kind:'text',createdAt:serverTimestamp()}));
  for(const d of [X,N,M])await assertFails(getDoc(op(d,room)));
  await assertFails(getDoc(op(A,'chat_groups/fixture')));
  await assertSucceeds(getDocs(collection(M,'chat_reports')));
  await assertFails(setDoc(op(A,age(a)),proof));
  for(const p of ['users/'+a+'/chatPushAdmission/current','users/'+a+'/chatPushPending/current','qaAge18RestorationAuthorizations/fixture']){
   await assertFails(getDoc(op(A,p)));await assertFails(setDoc(op(A,p),{status:'active'}));
  }
  const block='users/'+b+'/blockedMembers/'+a;
  await assertSucceeds(setDoc(op(B,block),{createdAt:serverTimestamp()}));
  await assertFails(getDoc(op(A,room)));await assertFails(getDocs(collection(B,room+'/messages')));
  await assertSucceeds(deleteDoc(op(B,block)));
  await assertSucceeds(getDoc(op(B,room)));
  await seed([[age(a),{...proof,status:'revoked'}]]);
  await assertFails(getDoc(op(B,room)));await assertFails(getDoc(op(B,room+'/messages/m2')));
  await seed([[age(a),proof],['serverInboxControl/writeBoundary',{policy:'test'}]]);
  await assertFails(updateDoc(op(B,room),{unreadRecipient:0}));
  await assertFails(setDoc(op(B,block),{createdAt:serverTimestamp()}));
 }finally{await env.cleanup();}
});
