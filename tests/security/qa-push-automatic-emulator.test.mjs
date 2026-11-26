import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {createAutomaticPushEmulator} from '../../firebase/qa-geral-celular/pilot/conversation-push-automatic-emulator.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
import {AUTO_CHAT} from '../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';

assert.match(process.env.FIRESTORE_EMULATOR_HOST??'',/^127\.0\.0\.1:\d+$/);
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST??'',/^127\.0\.0\.1:\d+$/);
assert.equal(process.env.GCLOUD_PROJECT,'demo-atrio-v11');
const app=initializeApp({projectId:'demo-atrio-v11'},'auto-push-lab');
const db=getFirestore(app),auth=getAuth(app);
const alice='qa-nav-alice',bob='qa-nav-bob';
const {projectId,databaseId,roundId,ageMode}=identity;
const d=p=>db.doc(p);
const pending=d('users/'+alice+'/chatPushPending/current');
const room=d('chats/'+AUTO_CHAT);
const gen=i=>'00000000-0000-4000-8000-00000000000'+i;
const hash=id=>createHash('sha256').update(JSON.stringify([roundId,AUTO_CHAT,id])).digest('hex');
const receipt=id=>d('users/'+alice+'/chatPushPublicationReceipts/'+hash(id));
const outbox=id=>d('qaPushAutomaticOutbox/'+hash(id));
const event=id=>({type:'created',projectId,databaseId,chatId:AUTO_CHAT,messageId:id});
const make=enabled=>createAutomaticPushEmulator({db,auth,enabled,serverTimestamp:()=>FieldValue.serverTimestamp()});
const service=make(true);
const pause=()=>new Promise(r=>setTimeout(r,30));
async function seed(id){
 await pending.delete();
 for(const uid of [alice,bob]){
  await d('users/'+uid+'/blockedMembers/'+(uid===alice?bob:alice)).delete();
 }
 await d('users/'+alice+'/chatBox/'+AUTO_CHAT).delete();
 await d('serverInboxControl/writeBoundary').delete();
 await d('serverInboxControl/pagination').delete();
 await d('app_config/conversations').set({enabled:true,qaSimpleDirectEnabled:true,minorPolicyApproved:true,
  version:'2026-11-v1',safetyReviewVersion:'2026-11-safety-v1',
  pushPilot:{enabled:true,projectId,databaseId,roundId,ageMode,expiresAt:null}});
 for(const uid of [alice,bob]){
  await d('users/'+uid+'/chatAgeEligibility/current').set({status:'eligible',minimumAge:18,
   policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:new Date(Date.now()+300000)});
 }
 await pause();
 for(const [i,uid] of [alice,bob].entries()){
  await d('users/'+uid+'/chatPushAdmission/current').set({status:'active',roundId,email:identity.accounts[uid],
   generation:gen(i),admittedAt:FieldValue.serverTimestamp(),expiresAt:null});
 }
 await d('users/'+alice+'/pushDevices/fake').set({token:'synthetic-not-an-fcm-token',updatedAt:FieldValue.serverTimestamp()});
 await pause();
 await newMessage(id);
}
async function newMessage(id){
 const batch=db.batch();
 batch.set(room,{participants:[alice,bob],requesterUid:alice,recipientUid:bob,status:'accepted',
  lastSenderUid:bob,lastMessageId:id,unreadRequester:1,unreadRecipient:0});
 batch.set(room.collection('messages').doc(id),{uid:bob,kind:'text',text:'fixture',createdAt:FieldValue.serverTimestamp()});
 await batch.commit();
}
async function absent(id){
 assert.equal((await receipt(id).get()).exists,false);
 assert.equal((await outbox(id).get()).exists,false);
}
try{
 for(const uid of [alice,bob])await auth.createUser({uid,email:identity.accounts[uid],emailVerified:true,disabled:false});
 await test('disabled and wrong project are closed',async()=>{
  assert.equal((await make(false).handle(event('none'))).reason,'automation_disabled');
  assert.equal((await service.handle({...event('none'),projectId:'production'})).reason,'invalid_event');
  assert.throws(()=>createAutomaticPushEmulator({db:{projectId:identity.projectId},auth,serverTimestamp:()=>null}),/emulator_only/);
 });
 await test('atomic publication + concurrent replay creates one receipt and outbox',async()=>{
  await seed('one');
  const results=await Promise.all([service.handle(event('one')),service.handle(event('one'))]);
  assert.equal(results.filter(r=>r.status==='published_lab').length,1);
  assert.equal((await pending.get()).data().messageId,'one');
  assert.equal((await receipt('one').get()).data().operatorUid,'qa-auto-emulator-only');
  const o=(await outbox('one').get()).data();
  assert.equal(o.state,'pending_transport');
  assert.equal(o.messageId,'one');
  assert.equal(o.recipientUid,alice);
  assert.equal(o.expiresAt.toMillis(),(await pending.get()).data().expiresAt.toMillis());
  assert.equal(Object.hasOwn(o,'text'),false);
  assert.equal(Object.hasOwn(o,'token'),false);
 });
 await test('active pending defers newer message; expired pending can advance; old receipt not reopened',async()=>{
  await newMessage('two');
  assert.equal((await service.handle(event('two'))).status,'defer');
  await absent('two');
  assert.equal((await pending.get()).data().messageId,'one');
  await pending.update({expiresAt:new Date(Date.now()-5000)});
  assert.equal((await service.handle(event('two'))).status,'published_lab');
  assert.equal((await pending.get()).data().messageId,'two');
  assert.equal((await service.handle(event('one'))).status,'ignored');
 });
 for(const [id,mutate] of [
  ['blocked',()=>d('users/'+bob+'/blockedMembers/'+alice).set({})],
  ['muted',()=>d('users/'+alice+'/chatBox/'+AUTO_CHAT).set({muted:true})],
  ['read',()=>room.update({unreadRequester:0})],
  ['revoked',()=>d('users/'+bob+'/chatPushAdmission/current').update({status:'revoked'})],
  ['deleted',()=>room.collection('messages').doc('deleted').update({deletedForAll:true})],
  ['age',()=>d('users/'+alice+'/chatAgeEligibility/current').update({status:'revoked'})],
  ['boundary',()=>d('serverInboxControl/writeBoundary').set({enabled:true})],
  ['orphan',()=>outbox('orphan').set({state:'unknown'})]
 ]){
  await test(id+' refuses without partial publication',async()=>{
   await seed(id);await mutate();
   assert.equal((await service.handle(event(id))).status,'ignored');
   assert.equal((await pending.get()).exists,false);
   assert.equal((await receipt(id).get()).exists,false);
   if(id!=='orphan')assert.equal((await outbox(id).get()).exists,false);
  });
 }
 await test('newer canonical message supersedes delayed event',async()=>{
  await seed('late');await newMessage('newest');
  assert.equal((await service.handle(event('late'))).status,'ignored');
  await absent('late');
  assert.equal((await service.handle(event('newest'))).status,'published_lab');
 });
}finally{await deleteApp(app)}
