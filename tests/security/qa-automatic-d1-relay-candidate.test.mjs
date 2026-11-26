import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync} from 'node:crypto';
import {D1_SCHEDULE_SCHEMA,createQaScheduledCandidate,QA_AUTO_CRON} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-scheduled-candidate.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
import {D1_TRIAL_SCHEMA,createD1TrialGate} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-trial-lab.mjs';
import {D1_OUTBOX_LAB_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-outbox-lab.mjs';
import {D1_LAB_BUDGET_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-budget-lab.mjs';
import {createQaAutomaticCandidateRelay} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-relay-candidate.mjs';
import {CONTINUOUS_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-continuous-gate.mjs';
const bearer=()=>{const now=Math.floor(Date.now()/1000),p='atrio-catolico-qa-general';return 'Bearer '+Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({aud:p,iss:'https://securetoken.google.com/'+p,sub:'qa-nav-alice',email:'alice.navegacao@qa.invalid',email_verified:true,auth_time:now-30,iat:now-1,exp:now+300,firebase:{sign_in_provider:'password'}})).toString('base64url')+'.fixture'};
const validNotice=()=>new Request('https://qa.invalid/notice',{headers:{Authorization:bearer()}});
const req=(path,body)=>new Request('https://qa.invalid'+path,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(D1_OUTBOX_LAB_SCHEMA+D1_LAB_BUDGET_SCHEMA+D1_TRIAL_SCHEMA);
 const activatedAt=Date.now()-10000,end=activatedAt+3600000;
 sql.prepare('INSERT INTO qa_auto_d1_activation_lab VALUES(1,?,0)').run(activatedAt);
 sql.prepare('INSERT INTO qa_auto_d1_trial_lab(singleton,activated_at,ends_at) VALUES(1,?,?)').run(activatedAt,end);
 const db={prepare(q){return {bind(...args){return {async first(){return sql.prepare(q).get(...args)??null},async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:r.changes}}}}}}}};
 const env={QA_PUSH_ENABLED:'true',QA_CONVERSATION_PUSH_ENABLED:'true',QA_AUTO_ACTIVATED_AT:String(activatedAt),QA_PUSH_DB:db,
 QA_FIREBASE_WEB_API_KEY:'fixture',QA_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'atrio-catolico-qa-general',client_email:'atrio-qa-general-push@atrio-catolico-qa-general.iam.gserviceaccount.com',private_key:'fixture'})};
 let manual=0,network=0;
 const candidate=createQaAutomaticCandidateRelay({manualWorker:{async fetch(r,mapped){manual++;assert.equal(mapped.PUSH_DB,db);return Response.json({status:'manual_fixture'})}},
 fetchImpl:async()=>{network++;throw Error('unexpected_network')}});
 return {sql,db,env,activatedAt,end,candidate,stats:()=>({manual,network}),arm:()=>sql.exec('UPDATE qa_auto_d1_activation_lab SET enabled=1')};
}
test('candidate off by default; explicit manual preserves real relay mapping',async t=>{
 const f=fixture(t),w=f.candidate;
 assert.equal((await w.fetch(req('/notice'),f.env)).status,503);
 assert.equal((await w.fetch(req('/event',{type:'chat_message'}),f.env)).status,503);
 assert.equal((await w.tick(f.env)).result.reason,'trial_unavailable');
 const env={...f.env,QA_AUTO_MODE:'manual'};
 assert.equal((await (await w.fetch(req('/notice'),env)).json()).status,'manual_fixture');
 assert.equal((await (await w.fetch(req('/event',{type:'chat_message'}),env)).json()).status,'manual_fixture');
 f.arm();
 assert.equal((await w.fetch(req('/notice'),env)).status,503);
 assert.deepEqual(f.stats(),{manual:2,network:0});
});
test('automatic rejects public send, wrong epoch, disabled flags and missing schema',async t=>{
 const f=fixture(t);f.arm();const env={...f.env,QA_AUTO_MODE:'automatic'},w=f.candidate;
 assert.equal((await w.fetch(req('/event',{type:'chat_message'}),env)).status,503);
 assert.equal((await w.fetch(req('/notice?uid=qa-nav-alice'),env)).status,503);
 assert.equal((await w.tick({...env,QA_PUSH_ENABLED:'false'})).result.reason,'trial_unavailable');
 assert.equal((await w.tick({...env,QA_AUTO_ACTIVATED_AT:String(f.activatedAt+1)})).result.reason,'trial_unavailable');
 assert.equal((await w.fetch(req('/v1/qa/conversations/example'),env)).status,503);
 assert.equal((await w.fetch(req('/tick'),env)).status,404);
 assert.deepEqual(f.stats(),{manual:0,network:0});
 f.sql.exec('DROP TABLE qa_auto_d1_trial_lab');
 assert.equal((await w.tick(env)).result.reason,'trial_unavailable');
 assert.equal((await w.fetch(validNotice(),env)).status,503);
});
test('lifetime trial reservations are atomic and independent of UTC reset',async t=>{
 const f=fixture(t);f.arm();
 const a=createD1TrialGate({db:f.db,activatedAt:f.activatedAt}),b=createD1TrialGate({db:f.db,activatedAt:f.activatedAt});
 for(const [kind,max] of [['tick',60],['notice',200]]){
  const results=await Promise.all(Array.from({length:max+5},(_,i)=>(i%2?a:b)(kind)));
  assert.equal(results.filter(x=>x===f.end).length,max);
  assert.equal(await a(kind),null);
 }
 assert.equal((await f.candidate.tick({...f.env,QA_AUTO_MODE:'automatic'})).result.reason,'trial_unavailable');
 assert.deepEqual(f.stats(),{manual:0,network:0});
});
test('trial stops before original deadline; no reactivation API or deletion',async t=>{
 const f=fixture(t);f.arm();const gate=createD1TrialGate({db:f.db,activatedAt:f.activatedAt});
 f.sql.prepare('UPDATE qa_auto_d1_trial_lab SET ends_at=?').run(Date.now()+60000);
 assert.equal(await gate('tick'),null);assert.ok(await gate('notice'));
 f.sql.prepare('UPDATE qa_auto_d1_trial_lab SET ends_at=?').run(Date.now()-1);
 assert.equal(await gate('notice'),null);
 assert.equal(await gate('tick'),null);
});
test('manual cannot resume until live outbox drains, expired records retained',async t=>{
 const f=fixture(t),now=Date.now(),s=Math.floor(now/1000),gen='00000000-0000-4000-8000-000000000001';
 f.sql.prepare("INSERT INTO qa_auto_d1_outbox_lab(event_key,activated_at,sender_uid,recipient_uid,message_id,sender_generation,recipient_generation,creation_seconds,creation_nanos,expires_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,'pending_transport')")
 .run('a'.repeat(64),f.activatedAt,'qa-nav-bob','qa-nav-alice','m1',gen,gen,s,0,now+60000);
 const env={...f.env,QA_AUTO_MODE:'manual'};
 assert.equal((await f.candidate.fetch(req('/notice'),env)).status,503);
 f.sql.exec('UPDATE qa_auto_d1_outbox_lab SET expires_at=1');
 assert.equal((await f.candidate.fetch(req('/notice'),env)).status,200);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM qa_auto_d1_outbox_lab').get().n,1);
});

test('malformed notice traffic cannot consume trial reservations or invoke provider',async t=>{
 const f=fixture(t);f.arm();const env={...f.env,QA_AUTO_MODE:'automatic'};
 for(let i=0;i<210;i++)assert.equal((await f.candidate.fetch(req('/notice'),env)).status,401);
 assert.equal(f.sql.prepare('SELECT notices FROM qa_auto_d1_trial_lab').get().notices,0);
 assert.deepEqual(f.stats(),{manual:0,network:0});
});

test('continuous mode is explicit, blocks manual during lease and rejects expired state',async t=>{
 const f=fixture(t),now=Date.now(),epoch=f.activatedAt+1,w=f.candidate;
 f.sql.exec(CONTINUOUS_SCHEMA+"CREATE TABLE atrio_qa_identity(project_id TEXT); INSERT INTO atrio_qa_identity VALUES('atrio-catolico-qa-general')");
 f.sql.prepare('INSERT INTO qa_auto_d1_continuous_epoch VALUES(?,1,?,?)').run(epoch,now,now+600000);
 const env={...f.env,QA_AUTO_MODE:'continuous',QA_AUTO_ACTIVATED_AT:String(epoch)};
 assert.equal((await w.tick(env)).result.reason,'trial_unavailable');
 const armed={...env,QA_AUTO_CONTINUOUS_ENABLED:'true'};
 assert.equal((await w.fetch(req('/event',{type:'chat_message'}),armed)).status,503);
 assert.equal((await w.fetch(req('/notice'),armed)).status,401);
 assert.equal((await w.fetch(req('/notice'),{...armed,QA_AUTO_MODE:'manual'})).status,503);
 f.sql.prepare('UPDATE qa_auto_d1_continuous_epoch SET quota_valid_until=?').run(now+1000);
 assert.equal((await w.tick(armed)).result.reason,'trial_unavailable');
 assert.equal((await w.fetch(validNotice(),armed)).status,503);
 f.sql.exec('UPDATE qa_auto_d1_continuous_epoch SET enabled=0');
 assert.equal((await w.fetch(req('/notice'),{...armed,QA_AUTO_MODE:'manual'})).status,200);
 assert.deepEqual(f.stats(),{manual:1,network:0});
});

for(const permanent of [false,true])test((permanent?'permanent':'finite')+' continuous scheduled relay sends one synthetic refresh, reads notice, and fails closed after disarm',async t=>{
 const at=Math.floor(Date.now()/60000)*60000,now=at+5000,activatedAt=at-60000,created=at-1000;
 t.mock.method(Date,'now',()=>now);
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(D1_OUTBOX_LAB_SCHEMA+D1_LAB_BUDGET_SCHEMA+D1_TRIAL_SCHEMA+D1_SCHEDULE_SCHEMA+CONTINUOUS_SCHEMA+
  "CREATE TABLE atrio_qa_identity(project_id TEXT); INSERT INTO atrio_qa_identity VALUES('atrio-catolico-qa-general'); CREATE TABLE delivered(event_key TEXT PRIMARY KEY,created_at INTEGER NOT NULL);");
 sql.prepare('INSERT INTO qa_auto_d1_activation_lab VALUES(1,?,0)').run(activatedAt-600000);
 sql.prepare('INSERT INTO qa_auto_d1_trial_lab(singleton,activated_at,ends_at) VALUES(1,?,?)').run(activatedAt-600000,activatedAt-300000);
 sql.prepare('INSERT INTO qa_auto_d1_continuous_epoch VALUES(?,1,?,?)').run(activatedAt,permanent?activatedAt:now,permanent?now-1:now+600000);
 if(permanent)sql.prepare('INSERT INTO qa_auto_d1_permanent_authorization VALUES(?,?,1)').run(activatedAt,now);
 sql.prepare('INSERT INTO qa_auto_d1_continuous_schedule(activated_at) VALUES(?)').run(activatedAt);
 const db={prepare(q){return {bind(...args){return {
  async first(){return sql.prepare(q.replaceAll("CAST(unixepoch('subsec')*1000 AS INTEGER)",String(now))).get(...args)??null},
  async run(){const r=sql.prepare(q.replaceAll("CAST(unixepoch('subsec')*1000 AS INTEGER)",String(now))).run(...args);return {success:true,meta:{changes:r.changes}}}
 }}}}};
 const {projectId,databaseId,roundId,ageMode}=identity,alice='qa-nav-alice',bob='qa-nav-bob',chat=alice+'__'+bob;
 const root='projects/'+projectId+'/databases/'+databaseId+'/documents/',room='chats/'+chat,message=room+'/messages/continuous-fixture';
 const str=stringValue=>({stringValue}),bool=booleanValue=>({booleanValue}),int=n=>({integerValue:String(n)}),ts=n=>({timestampValue:new Date(n).toISOString()}),nil={nullValue:null};
 const map=fields=>({mapValue:{fields}}),arr=a=>({arrayValue:{values:a.map(str)}}),iso=n=>new Date(n).toISOString();
 const docs=new Map();
 const add=(path,fields,time=created)=>docs.set(root+path,{name:root+path,createTime:iso(time),updateTime:iso(time),fields});
 add('app_config/conversations',{enabled:bool(true),qaSimpleDirectEnabled:bool(true),minorPolicyApproved:bool(true),version:str('2026-11-v1'),safetyReviewVersion:str('2026-11-safety-v1'),pushPilot:map({enabled:bool(true),projectId:str(projectId),databaseId:str(databaseId),roundId:str(roundId),ageMode:str(ageMode),expiresAt:nil})});
 add(room,{status:str('accepted'),lastMessageId:str('continuous-fixture'),lastSenderUid:str(bob),participants:arr([alice,bob]),requesterUid:str(alice),recipientUid:str(bob),unreadRequester:int(1),unreadRecipient:int(0)});
 add(message,{uid:str(bob),kind:str('text'),createdAt:ts(created)});
 for(const [i,uid] of [alice,bob].entries()){
  add('users/'+uid+'/chatPushAdmission/current',{status:str('active'),email:str(identity.accounts[uid]),roundId:str(roundId),generation:str('00000000-0000-4000-8000-00000000000'+(i+1)),admittedAt:ts(created-2000),expiresAt:nil},created-2000);
  add('users/'+uid+'/chatAgeEligibility/current',{status:str('eligible'),minimumAge:int(18),policyVersion:str('2026-11-18plus-qa-v1'),reviewExpiresAt:ts(created+300000)},created-3000);
 }
 const devicePath='users/'+alice+'/pushDevices/fixture';
 add(devicePath,{token:str('synthetic-not-an-fcm-token'),updatedAt:ts(created)});
 const account=uid=>({localId:uid,email:identity.accounts[uid],emailVerified:true,validSince:'1'});
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 let signals=0;const calls=[];
 const fetchImpl=async(url,init)=>{
  calls.push(url);assert.equal(init.redirect,'manual');
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-token',token_type:'Bearer',expires_in:3600});
  if(url.includes('/accounts:lookup?key='))return Response.json({users:[account(alice)]});
  if(url.endsWith('/accounts:lookup'))return Response.json({users:[account(alice),account(bob)]});
  if(url.endsWith(':beginTransaction'))return Response.json({transaction:'fixture-tx'});
  if(url.endsWith(':rollback'))return Response.json({});
  if(url.endsWith(':batchGet'))return Response.json(JSON.parse(init.body).documents.map(name=>docs.has(name)?{found:docs.get(name),readTime:iso(now)}:{missing:name,readTime:iso(now)}));
  if(url.endsWith('/users/'+alice+':runQuery'))return Response.json([{document:docs.get(root+devicePath),readTime:iso(now)}]);
  if(url.endsWith('/users/'+alice+'/pushDevices?pageSize=6'))return Response.json({documents:[docs.get(root+devicePath)]});
  if(url==='https://fcm.googleapis.com/v1/projects/'+projectId+'/messages:send'){
   signals++;assert.deepEqual(JSON.parse(init.body).message.data,{signal:'refresh'});return Response.json({name:'projects/'+projectId+'/messages/fixture'});
  }
  throw Error('unexpected synthetic destination');
 };
 const candidate=createQaAutomaticCandidateRelay({manualWorker:{fetch:()=>{throw Error('unexpected manual')}},fetchImpl});
 const env={QA_PUSH_ENABLED:'true',QA_CONVERSATION_PUSH_ENABLED:'true',QA_AUTO_MODE:'continuous',QA_AUTO_CONTINUOUS_ENABLED:'true',
  QA_AUTO_SCHEDULE_ENABLED:'true',QA_AUTO_ACTIVATED_AT:String(activatedAt),QA_PUSH_DB:db,QA_FIREBASE_WEB_API_KEY:'fixture',
  QA_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:projectId,client_email:'atrio-qa-general-push@'+projectId+'.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})})};
 const schedule=createQaScheduledCandidate({candidate}),controller={cron:QA_AUTO_CRON,scheduledTime:at};
 const first=await schedule(controller,env);
 assert.equal(first.outcome,'provider_accepted',JSON.stringify(first));
 assert.equal(signals,1);
 assert.ok(first.externalAttempts<=35);
 assert.equal((await schedule(controller,env)).reason,'schedule_reservation_unavailable');
 assert.equal(signals,1);
 const n=await candidate.fetch(validNotice(),env);
 assert.equal(n.status,200);assert.deepEqual(await n.json(),{conversationId:chat,messageId:'continuous-fixture',senderUid:bob});
 assert.equal(sql.prepare('SELECT state FROM qa_auto_d1_outbox_lab').get().state,'accepted_simulated');
 assert.equal(sql.prepare('SELECT count(*) AS n FROM delivered').get().n,1);
 assert.deepEqual({...sql.prepare('SELECT discovery,work,notice FROM qa_auto_d1_budget_lab').get()},{discovery:1,work:1,notice:1});
 const before=calls.length;sql.exec('UPDATE qa_auto_d1_continuous_epoch SET enabled=0');
 assert.equal((await candidate.fetch(validNotice(),env)).status,503);
 assert.equal((await candidate.tick(env)).result.reason,'trial_unavailable');
 assert.equal(calls.length,before);
 assert.equal(sql.prepare('SELECT ticks,notices FROM qa_auto_d1_trial_lab').get().ticks,0);
});
