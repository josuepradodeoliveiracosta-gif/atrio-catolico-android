import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createD1HttpCandidateLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-http-lab.mjs';
import {createMeteredD1Lab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-metered-lab.mjs';
import {D1_LAB_BUDGET_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-budget-lab.mjs';
import {createD1ModeLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-mode-lab.mjs';
import {readFileSync} from 'node:fs';
import {renderConversationPushPilotWorker} from '../../cloudflare/push-worker/scripts/conversation-push-pilot.mjs';
import {createD1DispatchLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-dispatch-lab.mjs';
import {createD1ReadAuthorizationLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-read-lab.mjs';
import {D1_OUTBOX_LAB_SCHEMA,createD1OutboxLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-outbox-lab.mjs';
import {createMeteredScheduledTickLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-scheduled-lab.mjs';
import {createFreeInvocationMeter} from '../../cloudflare/push-worker/scripts/qa-automatic-free-meter-lab.mjs';
import {createFreeClaimLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-claim-lab.mjs';
import {createFreeRecoveryLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-recovery-lab.mjs';
import {createFreeFlowLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-flow-lab.mjs';
import {createFreeSnapshotLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-snapshot-lab.mjs';
import {createFreePublicationLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-publication-lab.mjs';
import {createFreeRestDiscoveryLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-rest-lab.mjs';
import {FREE_BUDGET_SCHEMA,createFreeBudgetLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-budget-lab.mjs';
import {createHash,generateKeyPairSync,verify} from 'node:crypto';
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
const retryRow=id=>d('qaPushAutomaticRetries/'+hash(id));
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
  await pending.update({expiresAt:new Date(Date.now()+2000)});
  await newMessage('two');
  const deferred=await service.handle(event('two'));
  assert.equal(deferred.status,'defer');
  assert.equal(deferred.retryStatus,'scheduled_lab');
  await absent('two');
  assert.equal((await pending.get()).data().messageId,'one');
  const scheduled=(await retryRow('two').get()).data();
  assert.equal(scheduled.attempts,1);
  assert.equal((await service.handle(event('two'))).reason,'retry_already_recorded');
  assert.equal((await make(true).retry(deferred.eventKey)).reason,'retry_not_due');
  await new Promise(r=>setTimeout(r,Math.max(0,scheduled.nextAt.toMillis()-Date.now()+150)));
  const results=await Promise.all([make(true).retry(deferred.eventKey),make(true).retry(deferred.eventKey)]);
  assert.equal(results.filter(r=>r.status==='published_lab').length,1);
  assert.equal((await retryRow('two').get()).data().state,'published_lab');
  assert.ok((await pending.get()).data().expiresAt.toMillis()<=scheduled.deadline.toMillis());
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

 async function deferFixture(id){
  await seed(id);
  // Existing manual slot, no automatic outbox to coalesce.
  await pending.set({unread:true,expiresAt:new Date(Date.now()+2000),
    messageId:'manual-old',kind:'chat_message',conversationId:AUTO_CHAT,senderUid:bob,
    roundId,senderGeneration:gen(1),recipientGeneration:gen(0)});
  const first=await service.handle(event(id));
  assert.equal(first.retryStatus,'scheduled_lab');
  return first;
 }
 async function waitDue(id){
  const row=(await retryRow(id).get()).data();
  await new Promise(r=>setTimeout(r,Math.max(0,row.nextAt.toMillis()-Date.now()+150)));
  return row;
 }
 await test('durable retry budget is shared across instances; never reset or extend deadline',async()=>{
  const first=await deferFixture('retry-budget');
  const original=(await retryRow('retry-budget').get()).data().deadline.toMillis();
  for(let attempt=1;attempt<=3;attempt++){
   const row=await waitDue('retry-budget');
   assert.equal(row.attempts,attempt);
   await pending.update({expiresAt:new Date(Date.now()+1500)});
   const result=await make(true).retry(first.eventKey);
   assert.equal(result.status,'defer');
   const next=(await retryRow('retry-budget').get()).data();
   assert.equal(next.deadline.toMillis(),original);
   if(attempt<3){assert.equal(next.state,'scheduled_lab');assert.equal(next.attempts,attempt+1)}
   else {assert.equal(next.state,'stopped_lab');assert.equal(next.attempts,3)}
   assert.equal((await service.handle(event('retry-budget'))).reason,'retry_already_recorded');
  }
  assert.equal((await service.retry(first.eventKey)).reason,'retry_not_scheduled');
  await absent('retry-budget');
 });
 await test('due retry with superseded canonical message stops and cannot be restarted',async()=>{
  const first=await deferFixture('retry-stale');
  await newMessage('retry-newer');
  await waitDue('retry-stale');
  assert.equal((await service.retry(first.eventKey)).status,'ignored');
  assert.equal((await retryRow('retry-stale').get()).data().state,'stopped_lab');
  await absent('retry-stale');
 });
 await test('due drain respects persisted expiry and publishes one eligible event',async()=>{
  const first=await deferFixture('retry-drain');
  await waitDue('retry-drain');
  const results=await make(true).drainDue();
  assert.ok(results.some(r=>r.status==='published_lab'&&r.eventKey===first.eventKey));
  assert.equal((await retryRow('retry-drain').get()).data().state,'published_lab');
  assert.equal((await service.retry(first.eventKey)).reason,'retry_not_scheduled');
 });
 await test('expired retry is terminal even after pending removed',async()=>{
  const first=await deferFixture('retry-expired');
  await retryRow('retry-expired').update({deadline:new Date(Date.now()-1)});
  await pending.delete();
  assert.equal((await service.retry(first.eventKey)).reason,'retry_expired');
  assert.equal((await retryRow('retry-expired').get()).data().state,'stopped_lab');
  await absent('retry-expired');
 });

 await test('REST discovery and transactional publication through actual local emulator',async t=>{
  const host=process.env.FIRESTORE_EMULATOR_HOST;
  assert.match(host,/^127\.0\.0\.1:\d+$/);
  const remote='projects/'+projectId+'/databases/(default)/documents';
  const local='projects/demo-atrio-v11/databases/(default)/documents';
  const requests=[];
  const localFetch=globalThis.fetch;
  const transport=async req=>{
   const u=new URL(req.url);
   assert.equal(u.origin,'https://firestore.googleapis.com');
   assert.ok(u.pathname.startsWith('/v1/'+remote));
   assert.equal(req.method,'POST');assert.equal(req.redirect,'error');
   requests.push({path:u.pathname,transaction:req.body.transaction});
   const response=await localFetch('http://'+host+u.pathname.replace(remote,local),{
    method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},
    body:JSON.stringify(req.body).replaceAll(remote,local)});
   const raw=await response.text();
   let body;
   try{body=JSON.parse(raw.replaceAll(local,remote))}catch{body=null}
   // Diagnostics only: no document contents, credentials or transaction token.
   requests.at(-1).status=response.status;
   return {status:response.status,body};
  };
  let accountLookups=0;
  const lookupAccounts=async uids=>{
   accountLookups+=uids.length;
   return Object.fromEntries(await Promise.all(uids.map(async uid=>{
    const a=await auth.getUser(uid);
    return [uid,{uid:a.uid,email:a.email,emailVerified:a.emailVerified,disabled:a.disabled}];
   })));
  };
  const sql=new DatabaseSync(':memory:');
  try{
   sql.exec(FREE_BUDGET_SCHEMA);
   const budget=createFreeBudgetLab({enabled:true,db:{prepare(q){return {bind(...args){return {async run(){
    const result=sql.prepare(q).run(...args);return {success:true,meta:{changes:result.changes}};
   }}}}}}});
   const discover=createFreeRestDiscoveryLab({transport,reserveDiscovery:budget.reserveDiscovery});
   const readSnapshot=createFreeSnapshotLab({transport,lookupAccounts});
   const publish=createFreePublicationLab({transport,reserveBudget:budget.reservePublication,readSnapshot});
   const restClaim=createFreeClaimLab({enabled:true,transport,readSnapshot});
   const input={enabled:true,projectId,activatedAt:Date.now()-10000};
   await seed('rest-real');
   const candidate=await discover(input);
   assert.equal(candidate.status,'candidate',JSON.stringify({result:candidate,requests:requests.map(({path,status})=>({path,status}))}));
   const result=await publish({enabled:true,candidate});
   assert.equal(result.status,'published_lab',JSON.stringify({result,requests:requests.map(({path,status})=>({path,status}))}));
   assert.equal((await pending.get()).data().messageId,'rest-real');
   assert.equal((await receipt('rest-real').get()).exists,true);
   assert.equal((await outbox('rest-real').get()).data().state,'pending_transport');
   assert.equal((await service.claim(result.eventKey)).status,'claimed_lab');
   const txRequests=requests.filter(r=>r.transaction);
   assert.equal(txRequests.length,4);
   assert.equal(new Set(txRequests.map(r=>r.transaction)).size,1);
   assert.equal((await publish({enabled:true,candidate})).status,'ignored');
   await seed('rest-revoked');
   const denied=await discover(input);
   assert.equal(denied.status,'candidate');
   await d('users/'+bob+'/chatPushAdmission/current').update({status:'revoked'});
   const beforeDenied=requests.length,beforeAccounts=accountLookups;
   assert.equal((await publish({enabled:true,candidate:denied})).status,'ignored');
   assert.equal(accountLookups,beforeAccounts,'revoked admission must not query Auth');
   assert.equal(requests.slice(beforeDenied).some(r=>r.path.endsWith(':runQuery')),false,'revoked admission must not query devices');
   await absent('rest-revoked');
   assert.equal((await pending.get()).exists,false);
   const totals=sql.prepare('SELECT * FROM qa_auto_daily_budget_lab').get();
   assert.equal(totals.discovery,2);assert.equal(totals.publication,3);
   await seed('rest-worker');
   const meteredTransport=(meter,stage)=>async req=>{
    meter.beforeHttp(stage,req.url,req);
    return transport(req);
   };
   // Auth SDK calls are charged as logical requests before invocation;
   // underlying SDK retry traffic is not measured by this lab.
   const meteredAccounts=(meter,stage)=>async uids=>{
    meter.charge(stage,{requests:uids.length});
    return lookupAccounts(uids);
   };
   const createMeteredService=meter=>{
    const claimTransport=meteredTransport(meter,'claim');
    const finTransport=meteredTransport(meter,'finish');
    const claimService=createFreeClaimLab({enabled:true,transport:claimTransport,
     readSnapshot:createFreeSnapshotLab({transport:claimTransport,lookupAccounts:meteredAccounts(meter,'claim')})});
    const finishService=createFreeClaimLab({enabled:true,transport:finTransport,readSnapshot});
    return {claim:claimService.claim,finish:finishService.finish};
   };
   const readClaimed=async(claim,meter)=>{
    const name=remote+'/qaPushAutomaticOutbox/'+claim.eventKey;
    const r=await meteredTransport(meter,'worker')({url:'https://firestore.googleapis.com/v1/'+remote+':batchGet',
     method:'POST',redirect:'error',body:{documents:[name],mask:{fieldPaths:['state','claimId','expiresAt','conversationId','messageId','senderUid']}}});
    const row=r.body?.[0],f=row?.found?.fields;
    if(r.status!==200||r.body.length!==1||row.found?.name!==name||!f)return null;
    return {state:f.state?.stringValue,claimId:f.claimId?.stringValue,expiresAt:Date.parse(f.expiresAt?.timestampValue),
     conversationId:f.conversationId?.stringValue,messageId:f.messageId?.stringValue,senderUid:f.senderUid?.stringValue};
   };
   const workerLab=await createWorkerLab(t,{db,auth,service:restClaim,createMeteredService,readClaimed});
   const recover=createFreeRecoveryLab({transport,reserveRecovery:budget.reserveRecovery});
   const tickDeps={enabled:true,activatedAt:input.activatedAt,budget,transport,lookupAccounts,
    dispatch:workerLab.dispatchInternal};
   const first=await createMeteredScheduledTickLab(tickDeps)();
   assert.equal(first.result.status,'published_waiting_next_tick_lab',JSON.stringify(first));
   const publication={status:'published_lab',eventKey:first.result.eventKey};
   assert.equal(first.usage.discovery.reads,2);assert.equal(first.usage.recovery.reads,1);
   assert.equal(first.usage.publication.writes,3);
   assert.equal(first.usage.claim.requests+first.usage.worker.requests+first.usage.finish.requests,0);
   assert.ok(Object.values(first.usage).reduce((n,v)=>n+v.requests,0)<=13);
   assert.deepEqual(workerLab.stats(),{sends:0,reservations:0});
   // New tick and meter; persistent SQL/outbox survive the boundary.
   const restarted=createMeteredScheduledTickLab(tickDeps);
   const cpuStart=process.cpuUsage();
   const second=await restarted();
   const cpu=process.cpuUsage(cpuStart);
   const delivered=second.result;
   assert.equal(second.usage.publication.requests,0);
   assert.equal(second.usage.discovery.reads,2);assert.equal(second.usage.recovery.reads,1);
   assert.ok(Object.values(second.usage).reduce((n,v)=>n+v.requests,0)<=50,JSON.stringify(second.usage));
   console.log('Scheduled lab publication and delivery units: '+JSON.stringify({first:first.usage,second:second.usage}));
   const flow=createFreeFlowLab({enabled:true,activatedAt:input.activatedAt,discover,publish,recover,
    reserveTransport:budget.reserveTransport,dispatch:workerLab.dispatchInternal});
   assert.equal(delivered.status,'accepted_simulated',JSON.stringify(delivered));
   assert.deepEqual(workerLab.stats(),{sends:1,reservations:1});
   assert.equal((await outbox('rest-worker').get()).data().state,'accepted_simulated');
   const measured=workerLab.metrics();
   const metered=workerLab.budget();
   assert.equal(metered.worker.requests,measured.externalRequests+1);
   assert.equal(metered.worker.d1,measured.d1Calls);
   assert.equal(metered.claim.writes,1);assert.equal(metered.finish.writes,1);
   assert.ok(metered.claim.reads>0&&metered.finish.reads===1);
   const totalHttp=metered.claim.requests+metered.worker.requests+metered.finish.requests;
   assert.ok(totalHttp<=45,JSON.stringify(metered));
   console.log('REST transport lab total reserved (logical Auth, not billing): '+JSON.stringify(metered));
   console.log('Node host process CPU diagnostic microseconds (NOT Workers CPU): '+JSON.stringify(cpu));
   assert.ok(metered.worker.reads>=measured.firestoreDocuments);
   console.log('Worker lab reserved operation units: '+JSON.stringify(metered.worker));
   assert.ok(measured.externalRequests>0&&measured.externalRequests<=50,JSON.stringify(measured));
   assert.ok(measured.firestoreRequests>0&&measured.d1Calls>0);
   console.log('REST Worker lab operation counts (not billing or CPU): '+JSON.stringify(measured));
   assert.equal((await restarted()).result.reason,'not_recoverable');
   assert.equal((await flow.transport(publication)).reason,'not_pending');
   assert.deepEqual(workerLab.stats(),{sends:1,reservations:1});
   assert.equal((await flow.transport({status:'publication_unknown_lab',eventKey:publication.eventKey})).reason,'publication_not_confirmed');
   const deniedFlow=createFreeFlowLab({enabled:true,activatedAt:input.activatedAt,discover,publish,recover,
    reserveTransport:async()=>false,dispatch:async()=>{throw Error('must not dispatch')}});
   assert.equal((await deniedFlow.transport(publication)).reason,'transport_budget_unavailable');
   assert.equal(sql.prepare('SELECT attempts FROM qa_auto_transport_budget_lab').get().attempts,2);
   assert.equal(sql.prepare('SELECT attempts FROM qa_auto_recovery_budget_lab').get().attempts,3);
   assert.equal(sql.prepare('SELECT publication FROM qa_auto_daily_budget_lab').get().publication,4);
   await seed('rest-claim-race');
   const race=await publish({enabled:true,candidate:await discover(input)});
   assert.equal(race.status,'published_lab');
   // A competing SDK claim remains a valid concurrency adversary.
   const claims=await Promise.allSettled([restClaim.claim(race.eventKey),service.claim(race.eventKey)]);
   const winners=claims.filter(r=>r.status==='fulfilled'&&r.value.status==='claimed_lab');
   assert.equal(winners.length,1,JSON.stringify(claims));
   const claim=winners[0].value;
   assert.equal((await restClaim.finish({...claim,claimId:crypto.randomUUID(),outcome:'accepted_simulated'})).reason,'claim_mismatch');
   assert.equal((await restClaim.finish({...claim,outcome:'unknown'})).status,'unknown');
   assert.equal((await restClaim.claim(race.eventKey)).reason,'not_pending');
   await seed('rest-claim-revoked');
   const revoked=await publish({enabled:true,candidate:await discover(input)});
   assert.equal(revoked.status,'published_lab');
   await d('users/'+bob+'/chatPushAdmission/current').update({status:'revoked'});
   assert.equal((await restClaim.claim(revoked.eventKey)).status,'ignored');
   assert.equal((await outbox('rest-claim-revoked').get()).data().state,'pending_transport');
   await seed('rest-claim-ambiguous');
   const uncertain=await publish({enabled:true,candidate:await discover(input)});
   assert.equal(uncertain.status,'published_lab');
   const ambiguousTransport=async req=>{
    const result=await transport(req);
    if(req.url.endsWith(':commit'))throw Error('lost response after commit');
    return result;
   };
   const ambiguous=createFreeClaimLab({enabled:true,transport:ambiguousTransport,readSnapshot});
   assert.equal((await ambiguous.claim(uncertain.eventKey)).status,'claim_unknown_lab');
   assert.equal((await outbox('rest-claim-ambiguous').get()).data().state,'claimed_lab');
   assert.equal((await restClaim.claim(uncertain.eventKey)).reason,'not_pending');
   await outbox('rest-claim-ambiguous').update({expiresAt:new Date(Date.now()-1)});
   assert.equal((await restClaim.expireClaim(uncertain.eventKey)).status,'unknown');
   // Firestore stores integers and timestamps as distinct value types.
   // Mutate AFTER discovery to exercise the transactional decoder, not
   // just the stricter discovery adapter.
   for(const [label,mutate] of [
    ['grant-time',async()=>d('users/'+bob+'/chatPushAdmission/current').update({admittedAt:Date.now()-5000})],
    ['proof-expiry',async()=>d('users/'+alice+'/chatAgeEligibility/current').update({reviewExpiresAt:Date.now()+300000})],
    ['room-unread',async()=>room.update({unreadRequester:new Date(1000)})],
    ['pilot-expiry',async()=>d('app_config/conversations').update({'pushPilot.expiresAt':Date.now()+300000})],
    ['device-time',async()=>d('users/'+alice+'/pushDevices/fake').update({updatedAt:Date.now()})],
    ['message-time',async id=>room.collection('messages').doc(id).update({createdAt:Date.now()})]
   ]){
    const id='rest-type-'+label;await seed(id);
    const candidate=await discover(input);assert.equal(candidate.status,'candidate');
    await mutate(id);
    assert.equal((await publish({enabled:true,candidate})).status,'ignored',label);
    await absent(id);assert.equal((await pending.get()).exists,false,label);
   }
   await seed('rest-type-claim');
   const typed=await publish({enabled:true,candidate:await discover(input)});
   assert.equal(typed.status,'published_lab');
   const expiry=(await pending.get()).data().expiresAt.toMillis();
   await pending.update({expiresAt:expiry});
   assert.equal((await restClaim.claim(typed.eventKey)).status,'ignored');
   assert.equal((await outbox('rest-type-claim').get()).data().state,'pending_transport');

   await t.test('D1 outbox uses only read-only Firestore transactions and real emulator Auth',async()=>{
    sql.exec(D1_OUTBOX_LAB_SCHEMA);
    const activatedAt=Date.now()-10000;
    sql.prepare('INSERT INTO qa_auto_d1_activation_lab VALUES(1,?,1)').run(activatedAt);
    const bridge={prepare(q){return {bind(...args){return {
     async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:r.changes}}},
     async first(){return sql.prepare(q).get(...args)??null}
    }}}}};
    const reads=[];
    const readonly=async req=>{
     const suffix=new URL(req.url).pathname.slice(('/v1/'+remote).length);
     assert.ok([':beginTransaction',':batchGet',':rollback','/users/'+alice+':runQuery','/users/'+bob+':runQuery'].includes(suffix));
     if(suffix===':beginTransaction')assert.deepEqual(req.body,{options:{readOnly:{}}});
     reads.push(suffix);
     return transport(req);
    };
    const readAuthorization=createD1ReadAuthorizationLab({transport:readonly,lookupAccounts});
    const d1=createD1OutboxLab({db:bridge,enabled:true,activatedAt,readAuthorization});
    const candidateFor=async id=>{
     await seed(id);
     const result=await discover({enabled:true,projectId,activatedAt});
     assert.equal(result.status,'candidate');
     return result;
    };
    const candidate=await candidateFor('d1-real');
    const start=reads.length,accountsStart=accountLookups;
    const published=await d1.publish(candidate);
    assert.equal(published.status,'published_lab',JSON.stringify({published,reads:reads.slice(start)}));
    assert.equal(reads.length-start,5);assert.equal(accountLookups-accountsStart,2);
    await absent('d1-real');assert.equal((await pending.get()).exists,false);
    const c=await d1.claim(published.eventKey);
    assert.equal(c.status,'claimed_lab');
    assert.equal((await d1.authorizeClaim(c)).status,'authorized_lab');
    assert.deepEqual(await d1.readNotice(alice),{status:'notice_lab',conversationId:AUTO_CHAT,messageId:'d1-real',senderUid:bob});
    assert.equal((await d1.readNotice(bob)).reason,'no_notice');
    // Authorization changes between D1 claim and transport must close.
    await d('users/'+bob+'/chatPushAdmission/current').update({status:'revoked'});
    assert.equal((await d1.authorizeClaim(c)).status,'ignored');
    assert.equal((await d1.readNotice(alice)).status,'ignored');
    assert.equal((await d1.finish({...c,outcome:'unknown'})).status,'terminal_lab');
    assert.equal((await d1.claim(published.eventKey)).reason,'not_pending');
    await absent('d1-real');assert.equal((await pending.get()).exists,false);
    // Expiry for the earlier slot is advanced only in SQLite test setup.
    sql.prepare('UPDATE qa_auto_d1_outbox_lab SET expires_at=? WHERE event_key=?').run(Date.now()-1,published.eventKey);
    for(const [label,mutate] of [
     ['blocked',()=>d('users/'+bob+'/blockedMembers/'+alice).set({})],
     ['mute',()=>d('users/'+alice+'/chatBox/'+AUTO_CHAT).set({muted:true})],
     ['read',()=>room.update({unreadRequester:0})],
     ['deleted',id=>room.collection('messages').doc(id).update({deletedForAll:true})],
     ['auth',()=>auth.updateUser(bob,{disabled:true})],
     ['manual',()=>pending.set({unread:true,expiresAt:new Date(Date.now()+30000)})],
     ['legacy',id=>outbox(id).set({state:'unknown'})]
    ]){
     const id='d1-denied-'+label,candidate=await candidateFor(id);
     try{
      await mutate(id);
      assert.equal((await d1.publish(candidate)).status,'ignored',label);
      assert.equal(sql.prepare('SELECT count(*) AS n FROM qa_auto_d1_outbox_lab').get().n,1,label);
      assert.equal((await receipt(id).get()).exists,false,label);
      if(label!=='legacy')assert.equal((await outbox(id).get()).exists,false,label);
      if(label!=='manual')assert.equal((await pending.get()).exists,false,label);
     }finally{if(label==='auth')await auth.updateUser(bob,{disabled:false})}
    }
    // Reuse actual generated Worker device selection, without changing its
    // identity boundary or passing the canonical sender as a Firebase user.
    // The additional exports exist ONLY in this in-memory test module.
    const generated=renderConversationPushPilotWorker(readFileSync(new URL('../../cloudflare/push-worker/src/index.js',import.meta.url),'utf8'));
    const {devices:workerDevices,verifyIdentity:workerVerify,default:manualWorker}=await import('data:text/javascript;base64,'+Buffer.from(generated+'\nexport {devices};\n').toString('base64'));
    sql.exec('CREATE TABLE delivered(event_key TEXT PRIMARY KEY,created_at INTEGER NOT NULL)');
    const sendCandidate=await candidateFor('d1-dispatch');
    const sent=await d1.publish(sendCandidate);
    assert.equal(sent.status,'published_lab');
    let signals=0;
    // The parent Worker fixture intercepts global fetch and uses the same
    // emulator Firestore. FCM is deliberately synthetic for this experiment.
    const dispatch=createD1DispatchLab({enabled:true,db:bridge,outbox:d1,
     reserveAttempt:budget.reserveTransport,
     listDevices:uid=>workerDevices('fixture-access-token',uid),
     sendRefresh:async message=>{
      signals++;
      assert.equal(message.token,'synthetic-not-an-fcm-token');
      assert.deepEqual(message.data,{signal:'refresh'});
      assert.ok(Number.parseInt(message.android.ttl)<=60);
      return Response.json({name:'projects/'+projectId+'/messages/synthetic-d1'});
     }});
    const delivered=await dispatch(sent.eventKey);
    assert.equal(delivered.transportStatus,'accepted_simulated',JSON.stringify(delivered));
    assert.equal(sql.prepare('SELECT state FROM qa_auto_d1_outbox_lab WHERE event_key=?').get(sent.eventKey).state,'accepted_simulated');
    assert.equal(signals,1);
    assert.equal((await dispatch(sent.eventKey)).reason,'not_pending');
    assert.equal(sql.prepare('SELECT event_key FROM delivered').get().event_key,'chat:'+AUTO_CHAT+':d1-dispatch:'+alice);
    await absent('d1-dispatch');assert.equal((await pending.get()).exists,false);
    assert.equal((await d1.readNotice(alice)).messageId,'d1-dispatch');
    // Exercise the generated verifier unchanged. Only external Identity
    // Toolkit is simulated: exact fixture bearer -> current emulator account.
    // No claim is trusted as authentication, no real QA token is used.
    const bearerFor=(uid,project=projectId)=>'Bearer '+Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+
     Buffer.from(JSON.stringify({aud:project,iss:'https://securetoken.google.com/'+project,sub:uid})).toString('base64url')+'.fixture-signature';
    const tokens=new Map([alice,bob].map(uid=>[bearerFor(uid).slice(7),uid]));
    const previousFetch=globalThis.fetch;
    globalThis.fetch=async(url,init={})=>{
     const u=new URL(url);
     if(u.origin==='https://identitytoolkit.googleapis.com'&&u.pathname==='/v1/accounts:lookup'){
      const uid=tokens.get(JSON.parse(init.body).idToken);
      if(!uid)return Response.json({error:{code:401}},{status:401});
      const a=await auth.getUser(uid);
      return Response.json({users:[{localId:a.uid,email:a.email,emailVerified:a.emailVerified,disabled:a.disabled}]});
     }
     return previousFetch(url,init);
    };
    try{
     const env={PUSH_DB:bridge,PUSH_ENABLED:'true',FIREBASE_WEB_API_KEY:'fixture',FIREBASE_SERVICE_ACCOUNT_JSON:'fixture'};
     const mode=createD1ModeLab({db:bridge,mode:'automatic',activatedAt,manualWorker,verifyIdentity:workerVerify,
      readAuthorization,listDevices:uid=>workerDevices('fixture-access-token',uid),reserveAttempt:budget.reserveTransport,
      sendRefresh:async()=>{throw Error('must not dispatch from HTTP')}});
     const notice=authorization=>mode.fetch(new Request('https://qa.invalid/notice',{headers:authorization?{Authorization:authorization}:{}}),env);
     const accepted=await notice(bearerFor(alice));
     assert.equal(accepted.status,200);assert.equal(accepted.headers.get('cache-control'),'no-store');
     assert.deepEqual(await accepted.json(),{conversationId:AUTO_CHAT,messageId:'d1-dispatch',senderUid:bob});
     assert.equal((await notice(bearerFor(bob))).status,404);
     assert.equal((await notice()).status,401);
     assert.equal((await notice(bearerFor(alice,'production'))).status,401);
     assert.equal((await notice(bearerFor(alice)+'invalid')).status,401);
     assert.equal((await mode.fetch(new Request('https://qa.invalid/event',{method:'POST',headers:{Authorization:bearerFor(bob)}}),env)).status,503);
     await auth.updateUser(alice,{disabled:true});
     try{assert.equal((await notice(bearerFor(alice))).status,401)}
     finally{await auth.updateUser(alice,{disabled:false})}
     await d('users/'+alice+'/chatBox/'+AUTO_CHAT).set({muted:true});
     assert.equal((await notice(bearerFor(alice))).status,404);

     sql.exec(D1_LAB_BUDGET_SCHEMA);
     sql.prepare('UPDATE qa_auto_d1_outbox_lab SET expires_at=? WHERE event_key=?').run(Date.now()-1,sent.eventKey);
     await seed('d1-metered');
     let meteredSignals=0;
     const metered=createMeteredD1Lab({db:bridge,enabled:true,activatedAt,transport:readonly,lookupAccounts,
      manualWorker,verifyIdentity:workerVerify,listDevices:uid=>workerDevices('fixture-access-token',uid),
      sendRefresh:async msg=>{meteredSignals++;assert.deepEqual(msg.data,{signal:'refresh'});return Response.json({name:'projects/'+projectId+'/messages/d1-metered'})}});
     // Discovery uses masked batchGet, allowed by readonly adapter.
     const tick=await metered.tick(env);
     assert.equal(tick.result.transportStatus,'accepted_simulated',JSON.stringify(tick));
     assert.equal(meteredSignals,1);
     assert.ok(tick.usage.externalReserved<=35&&tick.usage.d1Calls<=24);
     const n=await metered.notice(new Request('https://qa.invalid/notice',{headers:{Authorization:bearerFor(alice)}}),env);
     assert.equal(n.response.status,200);
     assert.equal((await n.response.json()).messageId,'d1-metered');
     assert.ok(n.usage.externalReserved<=10&&n.usage.d1Calls<=10);
     assert.equal((await metered.tick(env)).result.reason,'not_pending');
     const limits=sql.prepare('SELECT discovery,work,notice FROM qa_auto_d1_budget_lab').get();
     assert.equal(limits.discovery,2);assert.equal(limits.work,1);assert.equal(limits.notice,1);
     await absent('d1-metered');assert.equal((await pending.get()).exists,false);
     console.log('D1 single tick reserved units: '+JSON.stringify({tick:tick.usage,notice:n.usage}));
    }finally{globalThis.fetch=previousFetch}

    await t.test('full HTTP candidate: cold OAuth, read-only emulator, D1 and synthetic FCM',async()=>{
     const keys=generateKeyPairSync('rsa',{modulusLength:2048});
     const email='atrio-qa-general-push@'+projectId+'.iam.gserviceaccount.com';
     const serviceAccount={project_id:projectId,client_email:email,private_key:keys.privateKey.export({type:'pkcs8',format:'pem'})};
     const env={PUSH_DB:bridge,PUSH_ENABLED:'true',FIREBASE_WEB_API_KEY:'fixture',FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(serviceAccount)};
     const authTime=Math.floor(Date.now()/1000)-30;
     const bearer=uid=>'Bearer '+Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+
      Buffer.from(JSON.stringify({aud:projectId,iss:'https://securetoken.google.com/'+projectId,sub:uid,exp:authTime+300,auth_time:authTime})).toString('base64url')+'.fixture';
     const recognized=new Map([alice,bob].map(uid=>[bearer(uid).slice(7),uid]));
     let calls=[],signals=0,lost=false,revoked=false;
     const providerAccount=async uid=>{
      const a=await auth.getUser(uid);
      return {localId:a.uid,email:a.email,emailVerified:a.emailVerified,disabled:a.disabled,validSince:revoked?String(authTime+1):'1'};
     };
     const fetchImpl=async(url,init)=>{
      calls.push(new URL(url).origin);
      assert.equal(init.redirect,'manual');assert.ok(init.signal);
      if(url==='https://oauth2.googleapis.com/token'){
       const [h,p,s]=new URLSearchParams(init.body).get('assertion').split('.');
       assert.ok(verify('RSA-SHA256',Buffer.from(h+'.'+p),keys.publicKey,Buffer.from(s,'base64url')));
       const claim=JSON.parse(Buffer.from(p,'base64url'));
       assert.equal(claim.iss,email);assert.equal(claim.aud,url);
       return Response.json({access_token:'fixture-http-token',token_type:'Bearer',expires_in:3600});
      }
      if(url==='https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=fixture'){
       const uid=recognized.get(JSON.parse(init.body).idToken);
       return uid?Response.json({users:[await providerAccount(uid)]}):Response.json({}, {status:401});
      }
      assert.equal(init.headers.Authorization,'Bearer fixture-http-token');
      if(url==='https://identitytoolkit.googleapis.com/v1/projects/'+projectId+'/accounts:lookup'){
       const ids=JSON.parse(init.body).localId;
       assert.deepEqual([...ids].sort(),[alice,bob].sort());
       return Response.json({users:await Promise.all(ids.map(providerAccount))});
      }
      if(url==='https://fcm.googleapis.com/v1/projects/'+projectId+'/messages:send'){
       const {message}=JSON.parse(init.body);signals++;
       assert.equal(message.token,'synthetic-not-an-fcm-token');assert.deepEqual(message.data,{signal:'refresh'});
       assert.ok(Number.parseInt(message.android.ttl)>=10&&Number.parseInt(message.android.ttl)<=60);
       if(lost)throw Error('simulated lost response');
       return Response.json({name:'projects/'+projectId+'/messages/http-fixture'});
      }
      const u=new URL(url);
      assert.equal(u.origin,'https://firestore.googleapis.com');
      assert.ok(u.pathname.startsWith('/v1/'+remote));
      const suffix=u.pathname.slice(('/v1/'+remote).length);
      if(init.method==='POST'){
       assert.ok([':beginTransaction',':rollback',':batchGet','/users/'+alice+':runQuery','/users/'+bob+':runQuery'].includes(suffix));
       if(suffix===':beginTransaction')assert.deepEqual(JSON.parse(init.body),{options:{readOnly:{}}});
       assert.equal(u.search,'');
      }else{
       assert.equal(init.method,'GET');
       assert.ok(['/users/'+alice+'/pushDevices','/users/'+bob+'/pushDevices'].includes(suffix));
       assert.equal(u.search,'?pageSize=6');
      }
      const reply=await localFetch('http://'+host+u.pathname.replace(remote,local)+u.search,{
       method:init.method,headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},
       redirect:'error',...(init.body?{body:init.body.replaceAll(remote,local)}:{})});
      return new Response((await reply.text()).replaceAll(local,remote),{status:reply.status,headers:{'Content-Type':'application/json'}});
     };
     const candidate=createD1HttpCandidateLab({db:bridge,enabled:true,activatedAt,fetchImpl,manualWorker});
     const disabled=createD1HttpCandidateLab({db:bridge,activatedAt,fetchImpl,manualWorker});
     assert.equal((await disabled.tick(env)).result.reason,'automation_disabled');assert.equal(calls.length,0);
     sql.prepare('UPDATE qa_auto_d1_outbox_lab SET expires_at=? WHERE event_key=?').run(Date.now()-1,hash('d1-metered'));
     await seed('d1-http-complete');
     const result=await candidate.tick(env);
     assert.equal(result.result.transportStatus,'accepted_simulated',JSON.stringify(result));
     assert.equal(result.httpUsage.actualExternalAttempts,calls.length);
     assert.equal(result.httpUsage.actualExternalAttempts,30);
     assert.equal(calls.filter(x=>x==='https://oauth2.googleapis.com').length,1);
     assert.equal(signals,1);
     assert.equal(sql.prepare('SELECT state FROM qa_auto_d1_outbox_lab WHERE event_key=?').get(hash('d1-http-complete')).state,'accepted_simulated');
     assert.equal(sql.prepare('SELECT count(*) AS n FROM delivered WHERE event_key=?').get('chat:'+AUTO_CHAT+':d1-http-complete:'+alice).n,1);
     await absent('d1-http-complete');assert.equal((await pending.get()).exists,false);
     const notice=uid=>candidate.notice(new Request('https://qa.invalid/notice',{headers:{Authorization:bearer(uid)}}),env);
     calls=[];
     const n=await notice(alice);
     assert.equal(n.response.status,200);assert.equal(n.response.headers.get('cache-control'),'no-store');
     assert.deepEqual(await n.response.json(),{conversationId:AUTO_CHAT,messageId:'d1-http-complete',senderUid:bob});
     assert.equal(n.httpUsage.actualExternalAttempts,calls.length);assert.equal(calls.length,8);
     assert.equal((await notice(bob)).response.status,404);
     revoked=true;assert.equal((await notice(alice)).response.status,401);revoked=false;
     await d('users/'+bob+'/chatPushAdmission/current').update({status:'revoked'});
     assert.equal((await notice(alice)).response.status,404);
     assert.equal((await candidate.tick(env)).result.reason,'not_pending');assert.equal(signals,1);
     // An uncertain FCM response preserves both terminal outbox and marker.
     sql.prepare('UPDATE qa_auto_d1_outbox_lab SET expires_at=? WHERE event_key=?').run(Date.now()-1,hash('d1-http-complete'));
     await seed('d1-http-unknown');lost=true;
     const unknown=await candidate.tick(env);
     assert.equal(unknown.result.status,'terminal_lab',JSON.stringify(unknown));
     assert.equal(sql.prepare('SELECT state FROM qa_auto_d1_outbox_lab WHERE event_key=?').get(hash('d1-http-unknown')).state,'unknown');
     assert.equal(sql.prepare('SELECT count(*) AS n FROM delivered WHERE event_key=?').get('chat:'+AUTO_CHAT+':d1-http-unknown:'+alice).n,1);
     assert.equal((await candidate.tick(env)).result.reason,'not_pending');assert.equal(signals,2);
     assert.equal((await notice(alice)).response.status,404);
     await absent('d1-http-unknown');assert.equal((await pending.get()).exists,false);
     console.log('D1 full HTTP candidate: '+JSON.stringify({tick:result.httpUsage,notice:n.httpUsage,firestoreWritesByAdapter:0}));
    });
    assert.ok(reads.length>0);
    console.log('D1 read authorization lab: '+JSON.stringify({readOnlyRequests:reads.length,firestoreWritesByAdapter:0}));
   });



  }finally{sql.close()}
 });
}finally{await deleteApp(app)}
