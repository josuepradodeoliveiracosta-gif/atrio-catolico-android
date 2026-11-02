import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  collectQaBatchInventory,planQaBatch,simulateQaBatch,
  createQaBatchReconciler,QA_BATCH_READINESS
} from './qa-broadcast-batches.js';

const ACTOR='qa-batch-00';
const request='qa-broadcast-demo-001';
const schema=readFileSync(new URL('../qa-broadcast-batches-fixture.sql',import.meta.url),'utf8');
const uid=n=>'qa-batch-'+String(n).padStart(2,'0');
const token=n=>'qa-fcm-fixture-'+String(n).padStart(2,'0');
const allRows=()=>Array.from({length:9},(_,n)=>({
  uid:uid(n),optedIn:n!==0,token:n===0?null:token(n)
}));
function pages(rows=allRows(),revision='qa-revision-v1'){
  return async cursor=>{
    const index=cursor===null?0:Number(String(cursor).replace('qa-page-',''));
    if(!Number.isSafeInteger(index)||index<0)throw Error('unexpected_cursor');
    const slice=rows.slice(index*3,index*3+3);
    const complete=(index+1)*3>=rows.length;
    return structuredClone({
      revision,pageIndex:index,expectedTotal:rows.length,
      rows:slice,complete,nextCursor:complete?null:'qa-page-'+(index+1)
    });
  };
}
async function fixture(fn){
  const dir=mkdtempSync(join(tmpdir(),'atrio-batch-fixture-'));
  const pathname=join(dir,'qa.sqlite');
  const dbs=[];
  const connect=()=>{
    const db=new DatabaseSync(pathname);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');
    dbs.push(db);return db;
  };
  try{
    const db=connect();db.exec(schema);
    return await fn({db,connect,ledger:()=>createQaBatchReconciler(db)});
  }finally{
    for(const db of dbs)try{db.close()}catch{}
    rmSync(dir,{recursive:true,force:true});
  }
}
async function offline(fn){
  const old=globalThis.fetch;
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error('network_not_allowed');};
  try{const x=await fn();assert.equal(calls,0);return x;}
  finally{globalThis.fetch=old;}
}
const sendAccepted=async ()=>({status:'qa_simulated_accepted'});
const states=db=>db.prepare(
  'SELECT recipient_uid,state FROM qa_bcast_deliveries WHERE request_id=? ORDER BY recipient_uid'
).all(request);
const countJobs=db=>db.prepare('SELECT COUNT(*) AS n FROM qa_bcast_jobs').get().n;

test('nine fixture accounts: verify three pages, claim three bounded batches, no topic or network',async()=>fixture(async({db,ledger})=>offline(async()=>{
  let reads=0;
  const readPage=pages();
  const plan=await planQaBatch({db,actorUid:ACTOR,requestId:request,
    readPage:async cursor=>{reads++;return readPage(cursor);}});
  assert.equal(reads,3);
  assert.equal(plan.queued,8);
  const delivered=[];
  const sendFixture=async value=>{delivered.push(value);return sendAccepted();};
  const first=await simulateQaBatch({db,requestId:request,sendFixture});
  const second=await simulateQaBatch({db,requestId:request,sendFixture});
  const third=await simulateQaBatch({db,requestId:request,sendFixture});
  const empty=await simulateQaBatch({db,requestId:request,sendFixture});
  assert.deepEqual([first.attempted,second.attempted,third.attempted],[3,3,2]);
  assert.equal(empty.status,'qa_batch_no_new_recipients');
  assert.equal(delivered.length,8);
  assert.deepEqual(delivered.map(x=>x.recipientUid),
    Array.from({length:8},(_,i)=>uid(i+1)));
  assert.ok(delivered.every(x=>x.kind==='qa_broadcast_fixture'&&
    x.fakeToken.startsWith('qa-fcm-')&&!Object.hasOwn(x,'topic')));
  assert.ok(states(db).every(x=>x.state==='acked'));
  assert.deepEqual(ledger().status(ACTOR),{state:'active',inFlight:8});
  assert.equal(QA_BATCH_READINESS.productionIntegrated,false);
  assert.equal(QA_BATCH_READINESS.realFcmEnabled,false);
}));

test('persistent request dedup across restart; changed inventory fails closed',async()=>fixture(async({db,connect})=>{
  assert.equal((await planQaBatch({db,actorUid:ACTOR,requestId:request,
    readPage:pages()})).status,'qa_planned');
  const reopened=connect();
  assert.equal((await planQaBatch({db:reopened,actorUid:ACTOR,requestId:request,
    readPage:pages()})).status,'qa_duplicate_plan');
  assert.equal(countJobs(reopened),1);
  assert.equal(states(reopened).length,8);
  await assert.rejects(planQaBatch({db:reopened,actorUid:ACTOR,requestId:request,
    readPage:pages(allRows(),'qa-revision-v2')}),/qa_batch_idempotency_conflict/);
  assert.equal(countJobs(reopened),1);
  assert.equal(states(reopened).length,8);
}));

test('unknown simulated result halts remaining cohort and blocks replay after reopen',async()=>fixture(async({db,connect,ledger})=>offline(async()=>{
  await planQaBatch({db,actorUid:ACTOR,requestId:request,readPage:pages()});
  let attempts=0;
  const first=await simulateQaBatch({db,requestId:request,
    sendFixture:async()=>{
      attempts++;
      if(attempts===2)throw Error('uncertain_effect');
      return sendAccepted();
    }});
  assert.equal(first.status,'qa_batch_ambiguous_pending_review');
  assert.equal(first.attempted,2);
  assert.deepEqual(states(db).slice(0,3).map(x=>x.state),
    ['acked','ambiguous','queued']);
  const reopened=connect();
  assert.equal((await simulateQaBatch({db:reopened,requestId:request,
    sendFixture:async()=>{attempts++;throw Error('no_retry');}})).status,
  'qa_batch_not_admitted');
  assert.equal(attempts,2);
  const officer=createQaBatchReconciler(reopened);
  officer.beginFreeze(ACTOR);
  assert.throws(()=>officer.finalizeFreeze(ACTOR),/qa_batch_inflight_or_queued/);
  assert.throws(()=>officer.reconcile({requestId:request,recipientUid:uid(2),
    evidence:'qa-unreviewed'}),/qa_batch_independent_evidence_required/);
  assert.throws(()=>officer.reconcile({requestId:request,recipientUid:uid(2),
    evidence:'qa-reviewed-never-started'}),/qa_batch_evidence_scope_mismatch/);
  officer.reconcile({requestId:request,recipientUid:uid(2),
    evidence:'qa-reviewed-synthetic-effect'});
  assert.equal((await simulateQaBatch({db:reopened,requestId:request,
    sendFixture:async()=>{attempts++;return sendAccepted();}})).status,
    'qa_batch_frozen_or_denied');
  assert.equal(attempts,2,'frozen actor cannot send another simulated token');
  assert.equal(ledger().status(ACTOR).state,'draining');
}));

test('freeze between planning and claim prevents side effects; no-send evidence closes ticket',async()=>fixture(async({db,ledger})=>offline(async()=>{
  const recipients=[allRows()[0],allRows()[1]];
  await planQaBatch({db,actorUid:ACTOR,requestId:request,readPage:pages(recipients)});
  ledger().beginFreeze(uid(1));
  let calls=0;
  const result=await simulateQaBatch({db,requestId:request,
    sendFixture:async()=>{calls++;return sendAccepted();}});
  assert.equal(result.status,'qa_batch_frozen_or_denied');
  assert.equal(calls,0);
  assert.throws(()=>ledger().finalizeFreeze(uid(1)),/qa_batch_inflight_or_queued/);
  ledger().reconcile({requestId:request,recipientUid:uid(1),
    evidence:'qa-reviewed-never-started'});
  assert.equal(ledger().finalizeFreeze(uid(1)),'frozen');
  assert.equal(ledger().status(uid(1)).inFlight,0);
}));

test('independent reconciliation of all simulated tokens allows freeze; not before',async()=>fixture(async({db,ledger})=>{
  await planQaBatch({db,actorUid:ACTOR,requestId:request,readPage:pages()});
  for(let n=0;n<3;n++)await simulateQaBatch({db,requestId:request,
    sendFixture:sendAccepted});
  ledger().beginFreeze(uid(4));
  assert.throws(()=>ledger().finalizeFreeze(uid(4)),/qa_batch_inflight_or_queued/);
  ledger().reconcile({requestId:request,recipientUid:uid(4),
    evidence:'qa-reviewed-synthetic-effect'});
  assert.equal(ledger().finalizeFreeze(uid(4)),'frozen');
  ledger().beginFreeze(ACTOR);
  assert.throws(()=>ledger().finalizeFreeze(ACTOR),/qa_batch_inflight_or_queued/);
  for(let n=1;n<=8;n++)if(n!==4)ledger().reconcile({
    requestId:request,recipientUid:uid(n),
    evidence:'qa-reviewed-synthetic-effect'});
  assert.equal(ledger().finalizeFreeze(ACTOR),'frozen');
  assert.deepEqual(ledger().status(ACTOR),{state:'frozen',inFlight:0});
}));

test('simultaneous workers cannot lease the same batch',async()=>fixture(async({db,connect})=>offline(async()=>{
  await planQaBatch({db,actorUid:ACTOR,requestId:request,readPage:pages()});
  const peer=connect();
  let enter,release;
  const entered=new Promise(r=>{enter=r;});
  const hold=new Promise(r=>{release=r;});
  const sent=[];
  const running=simulateQaBatch({db,requestId:request,
    sendFixture:async payload=>{sent.push(payload);if(sent.length===1){enter();await hold;}
      return sendAccepted();}});
  await entered;
  const contender=await simulateQaBatch({db:peer,requestId:request,
    sendFixture:async()=>{throw Error('duplicate_worker_send');}});
  assert.equal(contender.status,'qa_batch_not_admitted');
  release();
  assert.equal((await running).attempted,3);
  assert.equal(sent.length,3);
}));

test('paged inventory refuses truncated, duplicate, unordered and mismatched snapshots',async()=>fixture(async({db})=>{
  const original=pages();
  const bad=[
    async cursor=>{const p=await original(cursor);if(p.pageIndex===2)p.rows.pop();return p;},
    async cursor=>{const p=await original(cursor);if(p.pageIndex===1)p.rows[0]=allRows()[1];return p;},
    async cursor=>{const p=await original(cursor);if(p.pageIndex===1)p.revision='qa-revision-x2';return p;},
    async cursor=>{const p=await original(cursor);if(p.pageIndex===1)p.nextCursor='qa-page-9';return p;},
    async cursor=>{const p=await original(cursor);if(p.pageIndex===0)p.expectedTotal=8;return p;},
    async cursor=>{const p=await original(cursor);if(p.pageIndex===0)p.rows[1].token='real-fcm-token';return p;},
    async cursor=>{const p=await original(cursor);if(p.pageIndex===1)p.rows[0].uid='real-user';return p;}
  ];
  for(const readPage of bad)await assert.rejects(
    planQaBatch({db,actorUid:ACTOR,requestId:request,readPage}),
    /qa_batch_inventory_unverified/);
  assert.equal(countJobs(db),0);
}));

test('opt-outs are never planned, and the schema rejects actual customer IDs',async()=>fixture(async({db})=>{
  const rows=allRows().map((r,i)=>i%2===0&&i>0?
    {uid:r.uid,optedIn:false,token:null}:r);
  const plan=await planQaBatch({db,actorUid:ACTOR,requestId:request,
    readPage:pages(rows)});
  assert.equal(plan.queued,4);
  assert.deepEqual(states(db).map(x=>x.recipient_uid),[uid(1),uid(3),uid(5),uid(7)]);
  assert.throws(()=>db.prepare('INSERT INTO qa_bcast_accounts(uid) VALUES (?)')
    .run('real-customer-uid'),/CHECK constraint/);
  await assert.rejects(collectQaBatchInventory({actorUid:'real-customer-uid',
    readPage:pages()}),/qa_batch_inventory_unverified/);
}));
