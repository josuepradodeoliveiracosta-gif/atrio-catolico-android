import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {createAutomaticPushEmulator} from '../../firebase/qa-geral-celular/pilot/conversation-push-automatic-emulator.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
import {createWorkerLab,labBearer} from './qa-push-automatic-worker-lab.mjs';
import {createAutomaticTriggerLab,LAB_DOCUMENT} from '../../firebase/qa-geral-celular/pilot/conversation-push-automatic-trigger-lab.mjs';
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
  // Simulate a manual receipt: the automatic path must never supersede it.
  await receipt('one').update({operatorUid:'manual-fixture'});
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

 await test('one exclusive claim, result fenced by claim ID, terminal simulated acceptance',async()=>{
  await seed('claim');const pub=await service.handle(event('claim'));
  assert.equal(pub.status,'published_lab');
  const results=await Promise.all([service.claim(pub.eventKey),service.claim(pub.eventKey)]);
  const winner=results.find(r=>r.status==='claimed_lab');
  assert.ok(winner);
  assert.equal(results.filter(r=>r.status==='claimed_lab').length,1);
  assert.equal((await service.finish({eventKey:pub.eventKey,claimId:'00000000-0000-4000-8000-000000000000',outcome:'accepted_simulated'})).reason,'claim_mismatch');
  assert.equal((await service.finish({...winner,outcome:'accepted_simulated'})).status,'accepted_simulated');
  assert.equal((await service.claim(pub.eventKey)).reason,'not_pending');
  assert.equal((await service.finish({...winner,outcome:'unknown'})).reason,'claim_mismatch');
 });
 for(const [id,mutate] of [
  ['claim-revoked',()=>d('users/'+bob+'/chatPushAdmission/current').update({status:'revoked'})],
  ['claim-blocked',()=>d('users/'+alice+'/blockedMembers/'+bob).set({})],
  ['claim-read',()=>room.update({unreadRequester:0})],
  ['claim-superseded',()=>newMessage('claim-newer')],
  ['claim-tampered',()=>pending.update({senderGeneration:gen(9)})],
  ['claim-expired',()=>outbox('claim-expired').update({expiresAt:new Date(Date.now()-1)})],
  ['claim-auth-disabled',()=>auth.updateUser(bob,{disabled:true})]
 ]){
  await test(id+' cannot claim after publication',async()=>{
   await seed(id);const pub=await service.handle(event(id));assert.equal(pub.status,'published_lab');
   await mutate();
   try{
    assert.equal((await service.claim(pub.eventKey)).status,'ignored');
    assert.equal((await outbox(id).get()).data().state,'pending_transport');
   }finally{if(id==='claim-auth-disabled')await auth.updateUser(bob,{disabled:false})}
  });
 }
 await test('unknown outcome remains terminal; expired claim cannot be reclaimed',async()=>{
  await seed('unknown');const pub=await service.handle(event('unknown'));
  const claim=await service.claim(pub.eventKey);assert.equal(claim.status,'claimed_lab');
  assert.equal((await service.finish({...claim,outcome:'unknown'})).status,'unknown');
  assert.equal((await service.claim(pub.eventKey)).reason,'not_pending');
  await seed('crash');const crash=await service.handle(event('crash'));
  const c=await service.claim(crash.eventKey);assert.equal(c.status,'claimed_lab');
  assert.equal((await service.expireClaim(crash.eventKey)).reason,'not_expired_claim');
  await outbox('crash').update({expiresAt:new Date(Date.now()-1)});
  assert.equal((await service.expireClaim(crash.eventKey)).status,'unknown');
  assert.equal((await service.claim(crash.eventKey)).reason,'not_pending');
  assert.equal((await service.finish({...c,outcome:'accepted_simulated'})).reason,'claim_mismatch');
 });

 await test('integrated service authentication -> exclusive claim -> actual generated Worker -> simulated FCM',async t=>{
  await seed('integrated');const pub=await service.handle(event('integrated'));
  assert.equal(pub.status,'published_lab');
  const lab=await createWorkerLab(t,{db,auth,service});
  const body={eventKey:pub.eventKey};
  assert.equal((await lab.dispatch(labBearer({aud:'https://wrong.invalid'}),body)).status,'unauthorized');
  assert.equal((await lab.dispatch(labBearer(),{...body,senderUid:bob})).status,'unauthorized');
  assert.equal((await outbox('integrated').get()).data().state,'pending_transport');
  const results=await Promise.all([lab.dispatch(labBearer(),body),lab.dispatch(labBearer(),body)]);
  assert.equal(results.filter(r=>r.status==='accepted_simulated').length,1,JSON.stringify(results));
  assert.deepEqual(lab.stats(),{sends:1,reservations:1});
  assert.equal((await outbox('integrated').get()).data().state,'accepted_simulated');
  assert.equal((await lab.dispatch(labBearer(),body)).reason,'not_pending');
  assert.deepEqual(lab.stats(),{sends:1,reservations:1});
 });
 await test('shared Worker SQL marker blocks prior manual delivery',async t=>{
  await seed('prior-marker');const pub=await service.handle(event('prior-marker'));
  const lab=await createWorkerLab(t,{db,auth,service});
  lab.seedMarker(AUTO_CHAT,'prior-marker',alice);
  const result=await lab.dispatch(labBearer(),{eventKey:pub.eventKey});
  assert.equal(result.workerStatus,'no_devices_or_duplicate');
  assert.equal(result.status,'rejected_simulated');
  assert.deepEqual(lab.stats(),{sends:0,reservations:0});
 });
 await test('real Worker revalidates authorization after SQL reservation',async t=>{
  await seed('after-sql');const pub=await service.handle(event('after-sql'));
  const lab=await createWorkerLab(t,{db,auth,service,afterReservation:()=>d('users/'+bob+'/chatPushAdmission/current').update({status:'revoked'})});
  const result=await lab.dispatch(labBearer(),{eventKey:pub.eventKey});
  assert.equal(result.workerStatus,'authorization_interrupted');
  assert.equal(result.status,'unknown');
  assert.deepEqual(lab.stats(),{sends:0,reservations:1});
 });
 await test('ambiguous FCM transport never retried',async t=>{
  await seed('ambiguous-fcm');const pub=await service.handle(event('ambiguous-fcm'));
  const lab=await createWorkerLab(t,{db,auth,service,fcm:'unknown'});
  const body={eventKey:pub.eventKey};
  const result=await lab.dispatch(labBearer(),body);
  assert.equal(result.workerStatus,'delivery_transport_unknown');
  assert.equal(result.status,'unknown');
  assert.equal((await lab.dispatch(labBearer(),body)).reason,'not_pending');
  assert.deepEqual(lab.stats(),{sends:1,reservations:1});
 });

 await test('v2 creation adapter uses exact canonical creation and never reads event content',async()=>{
  await seed('trigger');
  const snap=await room.collection('messages').doc('trigger').get();
  const makeEvent=(patch={})=>({type:'google.cloud.firestore.document.v1.created',
    project:'demo-atrio-v11',database:databaseId,id:'synthetic-cloud-event',
    document:snap.ref.path,params:{messageId:'trigger'},data:{ref:{path:snap.ref.path},
      createTime:snap.createTime,data(){throw Error('event content must not be read')}},...patch});
  const handler=createAutomaticTriggerLab({enabled:true,service});
  assert.equal(LAB_DOCUMENT,'chats/'+AUTO_CHAT+'/messages/{messageId}');
  assert.equal((await createAutomaticTriggerLab()(makeEvent())).reason,'automation_disabled');
  for(const patch of [
    {project:projectId},{database:'other'},{type:'google.cloud.firestore.document.v1.updated'},
    {params:{messageId:'../invalid'}},{document:'posts/trigger'},{data:undefined},
    {data:{ref:{path:snap.ref.path},createTime:{seconds:snap.createTime.seconds,nanoseconds:-1}}}
  ])assert.equal((await handler(makeEvent(patch))).status,'ignored');
  await absent('trigger');
  const result=await handler(makeEvent());
  assert.equal(result.status,'published_lab');
  assert.equal((await handler(makeEvent({id:'different-delivery-id'}))).status,'ignored');
  assert.equal((await outbox('trigger').get()).data().state,'pending_transport');
 });
 await test('late creation event cannot authorize recreated document at same path',async()=>{
  await seed('recreated');
  const ref=room.collection('messages').doc('recreated'),old=await ref.get();
  await ref.delete();await pause();await newMessage('recreated');
  const handler=createAutomaticTriggerLab({enabled:true,service});
  const envelope=createTime=>({type:'google.cloud.firestore.document.v1.created',
   project:'demo-atrio-v11',database:databaseId,id:'fixture',document:ref.path,
   params:{messageId:'recreated'},data:{ref:{path:ref.path},createTime}});
  assert.equal((await handler(envelope(old.createTime))).status,'ignored');
  await absent('recreated');
  assert.equal((await handler(envelope((await ref.get()).createTime))).status,'published_lab');
 });

 await test('rapid newer message supersedes only unclaimed automatic publication',async()=>{
  await seed('rapid-old');const old=await service.handle(event('rapid-old'));
  assert.equal(old.status,'published_lab');
  await pause();await newMessage('rapid-new');
  const fresh=await service.handle(event('rapid-new'));
  assert.equal(fresh.status,'published_lab');
  assert.equal((await pending.get()).data().messageId,'rapid-new');
  assert.equal((await outbox('rapid-old').get()).data().state,'superseded_lab');
  assert.equal((await receipt('rapid-old').get()).exists,true);
  assert.equal((await service.claim(old.eventKey)).reason,'not_pending');
  assert.equal((await service.claim(fresh.eventKey)).status,'claimed_lab');
  await pause();await newMessage('rapid-third');
  assert.equal((await service.handle(event('rapid-third'))).status,'defer');
  assert.equal((await pending.get()).data().messageId,'rapid-new');
  await absent('rapid-third');
 });
 await test('recreated message cannot claim old outbox even with same path',async()=>{
  await seed('recreate-claim');const pub=await service.handle(event('recreate-claim'));
  assert.equal(pub.status,'published_lab');
  await room.collection('messages').doc('recreate-claim').delete();
  await pause();await newMessage('recreate-claim');
  assert.equal((await service.claim(pub.eventKey)).status,'ignored');
 });
 await test('claim racing newer publication cannot be superseded after reservation',async()=>{
  await seed('race-old');const pub=await service.handle(event('race-old'));
  assert.equal(pub.status,'published_lab');
  // A new message already makes the old one noncanonical, so the old
  // claim must fail regardless of which transaction wins.
  await pause();await newMessage('race-new');
  const [claim,fresh]=await Promise.all([service.claim(pub.eventKey),service.handle(event('race-new'))]);
  assert.equal(claim.status,'ignored');assert.equal(fresh.status,'published_lab');
  assert.equal((await outbox('race-old').get()).data().state,'superseded_lab');
 });
}finally{await deleteApp(app)}
