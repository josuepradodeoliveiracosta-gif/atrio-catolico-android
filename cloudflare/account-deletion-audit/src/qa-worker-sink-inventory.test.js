import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  QA_WORKERS,extractQaWorkerSinks,compareQaWorkerSinks
} from './qa-worker-sink-inventory.js';

const manifest=JSON.parse(readFileSync(
  new URL('../qa-worker-sink-manifest.json',import.meta.url),'utf8'
));
const root=new URL('../../',import.meta.url);
const workerSource=worker=>readFileSync(
  new URL(worker+'/src/index.js',root),'utf8'
);
const inventory=()=>QA_WORKERS.flatMap(w=>extractQaWorkerSinks(w,workerSource(w)));
test('exactly the three existing privileged Workers are tracked',()=>{
  assert.deepEqual([...QA_WORKERS],['avatar-worker','guardian-worker','push-worker']);
  assert.equal(manifest.productionProtected,false);
  assert.equal(manifest.requiresHumanReview,true);
  assert.equal(manifest.baselinePr,87);
  assert.ok(manifest.snapshots.every(x=>QA_WORKERS.includes(x.worker)));
});
test('all 59 known privileged sink candidates match the pinned baseline',()=>{
  const observed=inventory();
  const result=compareQaWorkerSinks(observed,manifest.snapshots);
  assert.deepEqual(result,{reviewNeeded:false,newlyObserved:[],
    missingFromSource:[],totalObserved:59,totalApproved:59,
    productionProtected:false});
  const counts=Object.fromEntries(QA_WORKERS.map(worker=>[
    worker,observed.filter(x=>x.worker===worker).length
  ]));
  assert.deepEqual(counts,{'avatar-worker':30,'guardian-worker':3,'push-worker':26});
});
test('new REST/FCM fetch or new D1 statement requires manual review',()=>{
  const observed=inventory();
  const network=extractQaWorkerSinks('push-worker',
    workerSource('push-worker')+
    "\nasync function newSend(){return await fetch('https://fcm.googleapis.com/v1/demo', {method:'POST'})}\n");
  const merged=observed.filter(x=>x.worker!=='push-worker').concat(network);
  const result=compareQaWorkerSinks(merged,manifest.snapshots);
  assert.equal(result.reviewNeeded,true);
  assert.ok(result.newlyObserved.some(x=>x.includes('newSend')));
  const sql=extractQaWorkerSinks('avatar-worker',
    workerSource('avatar-worker')+"\nawait env.AVATAR_DB.prepare('DELETE FROM avatar_pending WHERE uid=?').bind(uid).run()\n");
  const sqlResult=compareQaWorkerSinks(
    observed.filter(x=>x.worker!=='avatar-worker').concat(sql),
    manifest.snapshots);
  assert.equal(sqlResult.reviewNeeded,true);
  assert.ok(sqlResult.newlyObserved.some(x=>x.includes('AVATAR_DB')));
});
test('missing Firestore commit path also raises a review requirement',()=>{
  const existing=inventory();
  const removed=existing.filter((x,i)=>
    !(x.worker==='guardian-worker'&&x.kind==='firestore_commit' &&
      existing.findIndex(y=>JSON.stringify(y)===JSON.stringify(x))===i));
  const result=compareQaWorkerSinks(removed,manifest.snapshots);
  assert.equal(result.reviewNeeded,true);
  assert.ok(result.missingFromSource.length>0);
});
test('new call to existing mutator requires review even without a new fetch',()=>{
  const changed=extractQaWorkerSinks('avatar-worker',
    workerSource('avatar-worker')+
    "\nawait cloudSigned(env,'rename',{type:'upload'},null,'promote')\n");
  const observed=inventory().filter(x=>x.worker!=='avatar-worker').concat(changed);
  const result=compareQaWorkerSinks(observed,manifest.snapshots);
  assert.equal(result.reviewNeeded,true);
  assert.ok(result.newlyObserved.some(x=>x.includes("cloudSigned(env,'rename'")));
});
test('pure commentary changes do not alter a snapshot',()=>{
  const changed=extractQaWorkerSinks('guardian-worker',
    workerSource('guardian-worker')+"\n// A user asked for more tests, not an endpoint.\n");
  const observed=inventory().filter(x=>x.worker!=='guardian-worker').concat(changed);
  assert.equal(compareQaWorkerSinks(observed,manifest.snapshots).reviewNeeded,false);
});
test('no source inventory can attest actual enforcement',()=>{
  const result=compareQaWorkerSinks(inventory(),manifest.snapshots);
  assert.equal(result.productionProtected,false);
  assert.equal(manifest.productionProtected,false);
});
test('unknown Worker, invalid source, and malformed approval are rejected',()=>{
  assert.throws(()=>extractQaWorkerSinks('another-worker','await fetch("/")'),
    /qa_invalid_source/);
  assert.throws(()=>extractQaWorkerSinks('avatar-worker',null),/qa_invalid_source/);
  assert.throws(()=>compareQaWorkerSinks({},[]),/qa_invalid_sink_manifest/);
  assert.throws(()=>compareQaWorkerSinks([],[{worker:'invalid',code:'a',kind:'b'}]),
    /qa_invalid_sink_manifest/);
});
