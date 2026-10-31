import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {QaSqliteLease} from './qa-deletion-sqlite-lease.mjs';

function setup(fn){
  const dir=mkdtempSync(join(tmpdir(),'atrio-qa-lease-'));
  const file=join(dir,'checkpoints.sqlite');
  const connections=[];
  const connect=()=>{const x=new DatabaseSync(file);connections.push(x);return x;};
  return Promise.resolve().then(()=>fn({connect,file})).finally(()=>{
    for(const db of connections)try{db.close();}catch(_){}
    rmSync(dir,{recursive:true,force:true});
  });
}

test('lock excludes another runner and release allows the next generation',async()=>setup(({connect})=>{
  let now=1000;
  const a=new QaSqliteLease(connect(),{now:()=>now});
  const b=new QaSqliteLease(connect(),{now:()=>now});
  const lease1=a.acquire({ttlMs:5000});
  assert.throws(()=>b.acquire({ttlMs:5000}),/qa_lease_busy/);
  a.assertOwned(lease1);
  a.release(lease1);
  const lease2=b.acquire({ttlMs:5000});
  assert.notEqual(lease1.token,lease2.token);
  b.assertOwned(lease2);
  b.release(lease2);
}));

test('a simulated process restart reads durable lease and prevents takeover',async()=>setup(({connect})=>{
  const a=connect();
  const first=new QaSqliteLease(a,{now:()=>1000});
  first.acquire({ttlMs:5000});
  a.close();
  const b=new QaSqliteLease(connect(),{now:()=>2000});
  assert.throws(()=>b.acquire({ttlMs:5000}),/qa_lease_busy/);
}));

test('stale lease can be taken over with fencing; old runner cannot renew, commit or release',async()=>setup(({connect})=>{
  let now=1000;
  const a=new QaSqliteLease(connect(),{now:()=>now});
  const b=new QaSqliteLease(connect(),{now:()=>now});
  const old=a.acquire({ttlMs:300});
  now=1400;
  assert.throws(()=>a.assertOwned(old),/qa_lease_lost/);
  const current=b.acquire({ttlMs:1000});
  assert.ok(current.generation>old.generation);
  assert.throws(()=>a.renew(old),/qa_lease_lost/);
  a.release(old);
  b.assertOwned(current);
  b.renew(current,{ttlMs:2000});
  now=2500;
  b.assertOwned(current);
  b.release(current);
}));

test('expired/invalid ttl and forged tokens cannot grant ownership',async()=>setup(({connect})=>{
  const a=new QaSqliteLease(connect(),{now:()=>1000});
  for(const ttlMs of [-1,0,99,200000,NaN])assert.throws(
    ()=>a.acquire({ttlMs}),/invalid_qa_lease_ttl/);
  const lease=a.acquire();
  assert.throws(()=>a.assertOwned({...lease,token:'forged'}),/qa_lease_lost/);
  assert.throws(()=>a.assertOwned({...lease,generation:999}),/qa_lease_lost/);
  a.release({token:'forged',generation:lease.generation});
  a.assertOwned(lease);
  a.release(lease);
}));

test('lease cannot be falsely renewed after expiration',async()=>setup(({connect})=>{
  let now=1000;
  const a=new QaSqliteLease(connect(),{now:()=>now});
  const lease=a.acquire({ttlMs:200});
  now=1300;
  assert.throws(()=>a.renew(lease),/qa_lease_lost/);
}));

test('checkpoint row survives disconnect/reconnect independently of the lease',async()=>setup(({connect})=>{
  const db=connect();
  new QaSqliteLease(db,{now:()=>1000});
  db.exec('CREATE TABLE qa_deletion_checkpoints (step TEXT PRIMARY KEY, finished INTEGER)');
  db.prepare('INSERT INTO qa_deletion_checkpoints VALUES (?,1)').run('freeze_writes');
  db.close();
  const restarted=connect();
  assert.deepEqual(restarted.prepare('SELECT step FROM qa_deletion_checkpoints').all()
    .map(row=>row.step),['freeze_writes']);
}));


test('atomic checkpoint requires current lease generation in same SQLite transaction',async()=>setup(({connect})=>{
  let now=1000;
  const dbA=connect(),dbB=connect();
  dbA.exec('CREATE TABLE qa_deletion_checkpoints (step TEXT PRIMARY KEY, finished INTEGER)');
  const a=new QaSqliteLease(dbA,{now:()=>now});
  const b=new QaSqliteLease(dbB,{now:()=>now});
  const old=a.acquire({ttlMs:200});
  now=1300;
  const current=b.acquire({ttlMs:1500});
  assert.throws(()=>a.commitCheckpoint(old,'freeze_writes'),/qa_lease_lost/);
  assert.equal(dbA.prepare('SELECT COUNT(*) AS n FROM qa_deletion_checkpoints').get().n,0);
  b.commitCheckpoint(current,'freeze_writes');
  assert.equal(dbB.prepare('SELECT COUNT(*) AS n FROM qa_deletion_checkpoints').get().n,1);
  a.release(old);
  b.assertOwned(current);
  assert.throws(()=>b.commitCheckpoint(current,'invalid/step'),/invalid_qa_checkpoint/);
  b.release(current);
}));
