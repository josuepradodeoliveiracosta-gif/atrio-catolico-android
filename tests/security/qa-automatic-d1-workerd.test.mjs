import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {generateKeyPairSync} from 'node:crypto';
import {resolve} from 'node:path';
import {readFileSync,rmSync} from 'node:fs';
import {buildLocalAutomaticCandidate} from '../../cloudflare/push-worker/scripts/build-automatic-candidate-local.mjs';
import {fileURLToPath} from 'node:url';
import {D1_OUTBOX_LAB_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-outbox-lab.mjs';
import {D1_TRIAL_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-trial-lab.mjs';
import {D1_LAB_BUDGET_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-budget-lab.mjs';
test('local workerd uses WebCrypto and actual Miniflare D1 binding', {timeout:60000},async()=>{
 const root=process.env.ATRIO_MINIFLARE_ROOT;
 assert.ok(root,'explicit isolated Miniflare installation required');
 const {Miniflare}=createRequire(resolve(root,'package.json'))('miniflare');
 const repo=fileURLToPath(new URL('../../',import.meta.url));
 const activatedAt=Date.now()-30000,created=Date.now()-1000;
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const service={project_id:'atrio-catolico-qa-general',client_email:'atrio-qa-general-push@atrio-catolico-qa-general.iam.gserviceaccount.com',
  private_key:privateKey.export({type:'pkcs8',format:'pem'})};
 const mf=new Miniflare({modules:true,modulesRoot:repo,scriptPath:resolve(repo,'tests/security/qa-automatic-d1-workerd-fixture.mjs'),
  compatibilityDate:'2026-07-30',cf:false,host:'127.0.0.1',port:0,
  d1Databases:{PUSH_DB:'atrio-automatic-local-test'},d1Persist:false,
  bindings:{LAB_ONLY:'true',ACTIVATED_AT:String(activatedAt),CREATED_AT:String(created),FIXTURE_SERVICE:JSON.stringify(service)},
  outboundService:async()=>new Response('network denied',{status:403})});
 try{
  const db=await mf.getD1Database('PUSH_DB');
  const schema=D1_OUTBOX_LAB_SCHEMA+D1_LAB_BUDGET_SCHEMA+D1_TRIAL_SCHEMA+'\n'+'CREATE TABLE delivered(event_key TEXT PRIMARY KEY,created_at INTEGER NOT NULL);';
  for(const sql of schema.split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
  const a=await db.prepare('INSERT INTO qa_auto_d1_activation_lab VALUES(1,?,1)').bind(activatedAt).run();
  assert.equal(a.success,true);assert.equal(a.meta.changes,1);
  const clock=await db.prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS ms").first();
  assert.ok(Math.abs(clock.ms-Date.now())<5000);
  // Representative retained history: old slots do not block current work.
  const old=created-300000,gen='00000000-0000-4000-8000-000000000001';
  for(let i=0;i<60;i++)await db.prepare("INSERT INTO qa_auto_d1_outbox_lab(event_key,activated_at,sender_uid,recipient_uid,message_id,sender_generation,recipient_generation,creation_seconds,creation_nanos,expires_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,'pending_transport')")
    .bind(i.toString(16).padStart(64,'0'),activatedAt,'qa-nav-bob','qa-nav-alice','old'+i,gen,gen,Math.floor(old/1000),0,old+60000).run();
  const response=await mf.dispatchFetch('http://localhost/probe');
  const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.signals,1);assert.equal(body.httpCalls,2);
  assert.ok(body.units.calls>0&&body.units.rowsRead>0&&body.units.rowsWritten>0);
  assert.ok(body.units.rowsRead<=1000&&body.units.rowsWritten<=100,'local regression envelope');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM qa_auto_d1_outbox_lab').first()).n,61);
  const row=await db.prepare('SELECT state FROM qa_auto_d1_outbox_lab WHERE event_key=?').bind(body.eventKey).first();
  assert.equal(row.state,'accepted_simulated');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM delivered').first()).n,1);
  const budget=await db.prepare('SELECT discovery,work,notice FROM qa_auto_d1_budget_lab').first();
  assert.deepEqual(budget,{discovery:1,work:2,notice:0});
  console.log('workerd local probe: '+JSON.stringify({status:body.status,signals:body.signals,httpCalls:body.httpCalls,actualD1Binding:true,retainedHistory:60,units:body.units}));
 }finally{await mf.dispose()}
});

// The actual generated entry (not a substitute Worker fixture) in workerd.
// The package is still local-only, with no cron or remote binding.
test('generated QA entry in local workerd preserves shutdown and trial rejection', {timeout:60000},async()=>{
 const root=process.env.ATRIO_MINIFLARE_ROOT;assert.ok(root);
 const {Miniflare}=createRequire(resolve(root,'package.json'))('miniflare');
 const repo=fileURLToPath(new URL('../../',import.meta.url));
 const folder=buildLocalAutomaticCandidate();
 const activatedAt=Date.now()-10000;
 let outbound=0;
 const mf=new Miniflare({modules:true,modulesRoot:repo,scriptPath:resolve(folder,'entry.mjs'),
  compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],cf:false,host:'127.0.0.1',port:0,
  d1Databases:{QA_PUSH_DB:'atrio-generated-entry-local-test'},d1Persist:false,
  bindings:{QA_PUSH_ENABLED:'true',QA_CONVERSATION_PUSH_ENABLED:'true',QA_AUTO_MODE:'automatic',
   QA_AUTO_ACTIVATED_AT:String(activatedAt),QA_FIREBASE_WEB_API_KEY:'fixture',
   QA_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'atrio-catolico-qa-general',
    client_email:'atrio-qa-general-push@atrio-catolico-qa-general.iam.gserviceaccount.com',private_key:'fixture'})},
  outboundService:async()=>{outbound++;return new Response('network denied',{status:403})}});
 try{
  const db=await mf.getD1Database('QA_PUSH_DB');
  // Schema has a leading comment; D1 prepare accepts the SQL after it.
  const schema=readFileSync(resolve(folder,'schema-candidate.sql'),'utf8').replace(/^--[^\n]*\n/,'');
  for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  await db.prepare('INSERT INTO qa_auto_d1_activation_lab VALUES(1,?,1)').bind(activatedAt).run();
  await db.prepare('INSERT INTO qa_auto_d1_trial_lab(singleton,activated_at,ends_at) VALUES(1,?,?)').bind(activatedAt,activatedAt+3600000).run();
  assert.equal((await mf.dispatchFetch('http://localhost/notice')).status,401);
  assert.equal((await mf.dispatchFetch('http://localhost/event',{method:'POST',body:JSON.stringify({type:'chat_message'})})).status,503);
  assert.equal((await mf.dispatchFetch('http://localhost/tick')).status,404);
  assert.equal((await db.prepare('SELECT ticks,notices FROM qa_auto_d1_trial_lab').first()).notices,0);
  assert.equal(outbound,0);
  await db.prepare('UPDATE qa_auto_d1_activation_lab SET enabled=0').run();
  const now=Math.floor(Date.now()/1000),project='atrio-catolico-qa-general';
  const token=Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({
   aud:project,iss:'https://securetoken.google.com/'+project,sub:'qa-nav-alice',email:'alice.navegacao@qa.invalid',
   email_verified:true,auth_time:now-10,iat:now-1,exp:now+300,firebase:{sign_in_provider:'password'}})).toString('base64url')+'.fixture';
  assert.equal((await mf.dispatchFetch('http://localhost/notice',{headers:{Authorization:'Bearer '+token}})).status,503);
  assert.equal(outbound,0);
  assert.deepEqual(await db.prepare('SELECT ticks,notices FROM qa_auto_d1_trial_lab').first(),{ticks:0,notices:0});
 }finally{await mf.dispose();rmSync(folder,{recursive:true,force:true})}
});
