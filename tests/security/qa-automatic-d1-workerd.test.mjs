import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {generateKeyPairSync} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {D1_OUTBOX_LAB_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-outbox-lab.mjs';
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
  const schema=D1_OUTBOX_LAB_SCHEMA+D1_LAB_BUDGET_SCHEMA+'CREATE TABLE delivered(event_key TEXT PRIMARY KEY,created_at INTEGER NOT NULL);';
  for(const sql of schema.split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
  const a=await db.prepare('INSERT INTO qa_auto_d1_activation_lab VALUES(1,?,1)').bind(activatedAt).run();
  assert.equal(a.success,true);assert.equal(a.meta.changes,1);
  const clock=await db.prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS ms").first();
  assert.ok(Math.abs(clock.ms-Date.now())<5000);
  const response=await mf.dispatchFetch('http://localhost/probe');
  const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.signals,1);assert.equal(body.httpCalls,2);
  const row=await db.prepare('SELECT state FROM qa_auto_d1_outbox_lab WHERE event_key=?').bind(body.eventKey).first();
  assert.equal(row.state,'accepted_simulated');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM delivered').first()).n,1);
  const budget=await db.prepare('SELECT discovery,work,notice FROM qa_auto_d1_budget_lab').first();
  assert.deepEqual(budget,{discovery:1,work:2,notice:0});
  console.log('workerd local probe: '+JSON.stringify({status:body.status,signals:body.signals,httpCalls:body.httpCalls,actualD1Binding:true}));
 }finally{await mf.dispose()}
});
