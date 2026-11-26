import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createMeteredScheduledTickLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-scheduled-lab.mjs';
import {createFreeInvocationMeter} from '../../cloudflare/push-worker/scripts/qa-automatic-free-meter-lab.mjs';
import {createFreeClaimLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-claim-lab.mjs';
import {createFreeRecoveryLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-recovery-lab.mjs';
import {createFreeFlowLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-flow-lab.mjs';
import {createFreeSnapshotLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-snapshot-lab.mjs';
import {createFreePublicationLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-publication-lab.mjs';
import {createFreeRestDiscoveryLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-rest-lab.mjs';
import {FREE_BUDGET_SCHEMA,createFreeBudgetLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-budget-lab.mjs';
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



  }finally{sql.close()}
 });
}finally{await deleteApp(app)}
