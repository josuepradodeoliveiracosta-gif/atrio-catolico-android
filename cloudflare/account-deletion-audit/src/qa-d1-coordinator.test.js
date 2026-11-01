import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQaD1Coordinator,QA_D1_PHASES} from './qa-d1-coordinator.js';

const schema=readFileSync(new URL('../qa-d1-schema.sql',import.meta.url),'utf8');
async function inDb(fn){
  const dir=mkdtempSync(join(tmpdir(),'atrio-qa-d1-'));
  const filename=join(dir,'qa.sqlite');
  const opened=[];
  const connect=()=>{
    const db=new DatabaseSync(filename);
    opened.push(db);
    return {
      prepare(sql){return {
        bind(...args){return {
          async first(){return db.prepare(sql).get(...args)||null;}
        };}
      };}
    };
  };
  const raw=()=>opened.at(-1);
  try{
    const db=connect();
    raw().exec(schema);
    return await fn({db,connect,raw,filename});
  }finally{
    for(const db of opened)try{db.close();}catch(_){}
    rmSync(dir,{recursive:true,force:true});
  }
}
const yes={verified:async()=>true};

test('schema is QA-only with a hard-coded fixture guard',async()=>inDb(async({db,raw})=>{
  const a=createQaD1Coordinator(db,{now:()=>1000});
  assert.deepEqual(await a.status(),{exists:false,phaseCount:0,completed:false});
  assert.equal(raw().prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='qa_privacy_runs'").get().sql.includes('qa-delete-alice'),true);
  assert.throws(()=>raw().prepare(
    'INSERT INTO qa_privacy_runs VALUES (?,?,?,?,?,?)'
  ).run('real-user-1','any',1,10000,0,1000),/CHECK constraint/);
}));

test('first claimant owns lease; other runner cannot start while active',async()=>inDb(async({db,connect})=>{
  let clock=1000;
  const a=createQaD1Coordinator(db,{now:()=>clock});
  const b=createQaD1Coordinator(connect(),{now:()=>clock});
  const lock=await a.acquire({ttlMs:2000});
  assert.equal(lock.generation,1);
  assert.equal(lock.lastStep,0);
  await assert.rejects(b.acquire(),/qa_busy_or_already_complete/);
  assert.equal((await a.status()).leased,true);
  assert.equal(await a.release(lock),true);
  assert.equal((await b.acquire()).generation,2);
}));

test('checkpoints are step-by-step, require verification, and do not skip Auth',async()=>inDb(async({db})=>{
  const a=createQaD1Coordinator(db,{now:()=>1000});
  const lease=await a.acquire();
  await assert.rejects(a.acknowledge(lease,'remove_auth_stub_last',yes),
    /qa_stale_or_out_of_order/);
  await assert.rejects(a.acknowledge(lease,'freeze_writes'),
    /qa_verification_missing/);
  await assert.rejects(a.acknowledge(lease,'freeze_writes',{verified:async()=>false}),
    /qa_phase_unverified/);
  for(let i=0;i<QA_D1_PHASES.length;i++){
    const item=await a.acknowledge(lease,QA_D1_PHASES[i],yes);
    assert.equal(item.lastStep,i+1);
  }
  assert.deepEqual(await a.status(),{
    exists:true,phaseCount:8,completed:true,leased:true
  });
  await a.release(lease);
  await assert.rejects(a.acquire(),/qa_busy_or_already_complete/);
}));

test('closing and reopening D1-compatible database keeps progress and generation',async()=>inDb(async({db,connect,raw})=>{
  let clock=1000;
  const first=createQaD1Coordinator(db,{now:()=>clock});
  const lease=await first.acquire({ttlMs:1000});
  await first.acknowledge(lease,'freeze_writes',yes);
  raw().close(); // Simulated process restart and new D1 connection.
  clock=2500;
  const next=createQaD1Coordinator(connect(),{now:()=>clock});
  const restarted=await next.acquire({ttlMs:2000});
  assert.equal(restarted.generation,2);
  assert.equal(restarted.lastStep,1);
  await next.acknowledge(restarted,'remove_nested',yes);
  assert.equal((await next.status()).phaseCount,2);
}));

test('expired lease loses right to write and later runner takes over via fencing',async()=>inDb(async({db,connect})=>{
  let clock=1000;
  const a=createQaD1Coordinator(db,{now:()=>clock});
  const b=createQaD1Coordinator(connect(),{now:()=>clock});
  const old=await a.acquire({ttlMs:1000});
  clock=2100;
  const newer=await b.acquire({ttlMs:2000});
  assert.ok(newer.generation>old.generation);
  await assert.rejects(a.acknowledge(old,'freeze_writes',yes),
    /qa_stale_or_out_of_order/);
  await assert.rejects(a.renew(old),/qa_stale_lease/);
  assert.equal(await a.release(old),false);
  assert.equal((await b.acknowledge(newer,'freeze_writes',yes)).lastStep,1);
  assert.equal((await b.status()).phaseCount,1);
}));

test('a slow verification callback losing its lease cannot write a checkpoint',async()=>inDb(async({db,connect})=>{
  let clock=1000;
  const a=createQaD1Coordinator(db,{now:()=>clock});
  const b=createQaD1Coordinator(connect(),{now:()=>clock});
  const stale=await a.acquire({ttlMs:1000});
  await assert.rejects(a.acknowledge(stale,'freeze_writes',{
    verified:async()=>{
      clock=2100;
      const fresh=await b.acquire({ttlMs:1000});
      assert.ok(fresh.generation>stale.generation);
      return true;
    }
  }),/qa_stale_or_out_of_order/);
  assert.equal((await a.status()).phaseCount,0);
}));

test('renewal extends lock only for its current owner',async()=>inDb(async({db,connect})=>{
  let clock=1000;
  const a=createQaD1Coordinator(db,{now:()=>clock});
  const b=createQaD1Coordinator(connect(),{now:()=>clock});
  const lease=await a.acquire({ttlMs:1500});
  clock=2000;
  assert.equal(await a.renew(lease,{ttlMs:3000}),true);
  clock=2900;
  await assert.rejects(b.acquire(),/qa_busy_or_already_complete/);
  clock=5001;
  const acquired=await b.acquire();
  assert.ok(acquired.generation>lease.generation);
  await assert.rejects(a.renew(lease),/qa_stale_lease/);
}));

test('releasing old token cannot release new owner, even if step unchanged',async()=>inDb(async({db,connect})=>{
  let clock=1000;
  const a=createQaD1Coordinator(db,{now:()=>clock});
  const b=createQaD1Coordinator(connect(),{now:()=>clock});
  const old=await a.acquire({ttlMs:1000});
  clock=2100;
  const current=await b.acquire({ttlMs:5000});
  assert.equal(await a.release(old),false);
  await assert.rejects(a.acquire(),/qa_busy_or_already_complete/);
  await b.acknowledge(current,'freeze_writes',yes);
}));

test('no extra UID, arbitrary phase, forged token or invalid time accepted',async()=>inDb(async({db})=>{
  const a=createQaD1Coordinator(db,{now:()=>1000});
  const lease=await a.acquire();
  await assert.rejects(a.acknowledge({...lease,token:'evil'},'freeze_writes',yes),
    /qa_invalid_lease/);
  await assert.rejects(a.acknowledge(lease,'erase_every_user',yes),
    /qa_unknown_phase/);
  await assert.rejects(a.acquire({ttlMs:-1}),/qa_invalid_ttl/);
  await assert.rejects(a.renew(lease,{ttlMs:1}),/qa_invalid_ttl/);
  assert.throws(()=>createQaD1Coordinator({}),/qa_invalid_d1_binding/);
  const bad=createQaD1Coordinator(db,{now:()=>-1});
  await assert.rejects(bad.acquire(),/qa_invalid_clock/);
}));

test('verification error never acknowledges an external service failure',async()=>inDb(async({db})=>{
  const a=createQaD1Coordinator(db,{now:()=>1000});
  const lease=await a.acquire();
  await assert.rejects(a.acknowledge(lease,'freeze_writes',{
    verified:async()=>{throw Error('fake_cloudinary_outage');}
  }),/fake_cloudinary_outage/);
  assert.equal((await a.status()).phaseCount,0);
}));
