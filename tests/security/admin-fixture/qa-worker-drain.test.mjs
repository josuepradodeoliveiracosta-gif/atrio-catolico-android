import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQaWorkerDrainAdapter} from './qa-worker-drain.mjs';

const A='qa-delete-alice',B='qa-delete-bob';
async function fixture(run){
  const dir=mkdtempSync(join(tmpdir(),'atrio-qa-drain-unit-'));
  const file=join(dir,'drain.sqlite');
  const opened=[];
  const connect=()=>{
    const db=new DatabaseSync(file);
    opened.push(db);
    return {db,gate:createQaWorkerDrainAdapter(db)};
  };
  try{return await run(connect);}
  finally{
    for(const db of opened)try{db.close();}catch{}
    rmSync(dir,{recursive:true,force:true});
  }
}
test('persisted pending effects block freeze across two SQLite connections',async()=>fixture(async connect=>{
  const a=connect().gate,b=connect().gate;
  const ticket=a.beginFanout(A,[A]);
  assert.deepEqual(b.status(A),{state:'active',pending:1});
  assert.throws(()=>b.seal(A),/qa_worker_drain_pending_privileged_effect/);
  assert.deepEqual(b.status(A),{state:'draining',pending:1});
  assert.throws(()=>a.begin(A,'avatar_upload'),
    /qa_worker_drain_privileged_effect_blocked/);
  assert.throws(()=>b.verify(A),/qa_worker_drain_not_quiescent/);
  assert.equal(await a.completeFanout(ticket,{verify:async()=>true}),true);
  assert.equal(b.seal(A),true);
  assert.equal(a.verify(A),true);
  assert.deepEqual(connect().gate.status(A),{state:'frozen',pending:0});
}));
test('unknown external effect NEVER releases ticket or permits Auth delete',async()=>fixture(async connect=>{
  const gate=connect().gate;
  const pending=gate.begin(A,'guardian_commit');
  await assert.rejects(gate.complete(pending,{verify:async()=>false}),
    /qa_worker_drain_effect_not_reconciled/);
  assert.throws(()=>gate.seal(A),/qa_worker_drain_pending_privileged_effect/);
  await assert.rejects(gate.complete(pending,{verify:async()=>{
    throw Error('qa_sink_unreachable');
  }}),/qa_sink_unreachable/);
  assert.equal(gate.status(A).pending,1);
  assert.throws(()=>gate.verify(A),/qa_worker_drain_not_quiescent/);
}));
test('Alice frozen does not block an independent Bob operation',async()=>fixture(async connect=>{
  const gate=connect().gate;
  assert.equal(gate.seal(A),true);
  const bob=gate.begin(B,'avatar_upload');
  assert.deepEqual(gate.status(B),{state:'active',pending:1});
  await gate.complete(bob,{verify:async()=>true});
  assert.deepEqual(gate.status(B),{state:'active',pending:0});
  assert.equal(gate.verify(A),true);
  assert.throws(()=>gate.seal(B),/qa_worker_drain_only_alice_delete_fixture/);
}));
test('forged, completed, unknown UID and kind fail before effects',async()=>fixture(async connect=>{
  const gate=connect().gate;
  assert.throws(()=>gate.begin('real-uid','push_fanout'),
    /qa_worker_drain_unlisted_uid/);
  assert.throws(()=>gate.begin(A,'all_users'),
    /qa_worker_drain_unlisted_sink/);
  assert.throws(()=>gate.begin(A,'push_fanout'),
    /qa_worker_drain_fanout_scope_required/);
  const t=gate.beginFanout(A,[A]);
  await assert.rejects(gate.completeFanout({...t,uid:B},{verify:async()=>true}),
    /qa_worker_drain_already_completed_or_forged/);
  assert.equal(gate.status(A).pending,1);
  await assert.rejects(gate.completeFanout({...t,otherUid:B},{verify:async()=>true}),
    /qa_worker_drain_invalid_fanout_completion/);
  await gate.completeFanout(t,{verify:async()=>true});
  await assert.rejects(gate.completeFanout(t,{verify:async()=>true}),
    /qa_worker_drain_already_completed_or_forged/);
  assert.equal(gate.seal(A),true);
}));
test('tampered freeze state fails closed, even with zero pending',async()=>fixture(async connect=>{
  const {db,gate}=connect();
  gate.seal(A);
  db.prepare("UPDATE qa_worker_drain_accounts SET state='active' WHERE uid=?").run(A);
  assert.throws(()=>gate.verify(A),/qa_worker_drain_not_quiescent/);
}));
test('unsafe environment rejects every new write and freeze',async()=>fixture(async connect=>{
  const gate=connect().gate;
  const original=process.env.FIRESTORE_EMULATOR_HOST;
  try{
    process.env.FIRESTORE_EMULATOR_HOST='firestore.googleapis.com:443';
    assert.throws(()=>gate.beginFanout(A,[A]),
      /qa_worker_drain_nonlocal_environment/);
    assert.throws(()=>gate.seal(A),/qa_worker_drain_nonlocal_environment/);
  }finally{process.env.FIRESTORE_EMULATOR_HOST=original;}
  assert.equal(gate.seal(A),true);
}));


test('cross-account fanout admits actor and recipients atomically on two DB handles',async()=>fixture(async connect=>{
  const owner=connect().gate,other=connect().gate;
  const fanout=owner.beginFanout(B,[A]);
  assert.deepEqual(other.status(A),{state:'active',pending:1});
  assert.deepEqual(other.status(B),{state:'active',pending:1});
  assert.throws(()=>other.seal(A),/qa_worker_drain_pending_privileged_effect/);
  assert.deepEqual(other.status(A),{state:'draining',pending:1});
  assert.throws(()=>owner.beginFanout(B,[A]),
    /qa_worker_drain_privileged_effect_blocked/);
  const unrelated=owner.begin(B,'avatar_upload');
  assert.equal(await other.completeFanout(fanout,{verify:async()=>true}),true);
  assert.deepEqual(owner.status(A),{state:'draining',pending:0});
  assert.deepEqual(owner.status(B),{state:'active',pending:1});
  assert.equal(other.seal(A),true);
  assert.throws(()=>owner.beginFanout(B,[A]),
    /qa_worker_drain_privileged_effect_blocked/);
  await other.complete(unrelated,{verify:async()=>true});
  assert.deepEqual(owner.status(B),{state:'active',pending:0});
  assert.equal(connect().gate.verify(A),true);
}));

test('multi-user ticket cannot be completed by a partial or forged recipient set',async()=>fixture(async connect=>{
  const a=connect().gate,b=connect().gate;
  const t=a.beginFanout(A,[B,A]);
  await assert.rejects(b.completeFanout({...t,recipients:[A]},{
    verify:async()=>true
  }),/qa_worker_drain_already_completed_or_forged/);
  await assert.rejects(b.completeFanout({...t,recipients:[B,B]},{
    verify:async()=>true
  }),/qa_worker_drain_invalid_fanout_completion/);
  await assert.rejects(b.complete(t,{verify:async()=>true}),
    /qa_worker_drain_invalid_completion/);
  assert.deepEqual(a.status(A),{state:'active',pending:1});
  assert.deepEqual(a.status(B),{state:'active',pending:1});
  await assert.rejects(b.completeFanout(t,{verify:async()=>false}),
    /qa_worker_drain_effect_not_reconciled/);
  assert.throws(()=>a.seal(A),/qa_worker_drain_pending_privileged_effect/);
  assert.equal(await b.completeFanout(t,{verify:async()=>true}),true);
  assert.equal(a.seal(A),true);
}));

test('fanout rejects unknown, missing and duplicated recipients before ledger write',async()=>fixture(async connect=>{
  const a=connect().gate;
  for(const recipients of [[],[B,B],['real-user'],[B,'real-user'],[A,B,A]]){
    assert.throws(()=>a.beginFanout(A,recipients),
      /qa_worker_drain_(invalid_fanout|unlisted_uid)/);
  }
  assert.throws(()=>a.beginFanout('real-user',[A]),/qa_worker_drain_unlisted_uid/);
  assert.deepEqual(a.status(A),{state:'active',pending:0});
  assert.deepEqual(a.status(B),{state:'active',pending:0});
}));

test('uncertain fanout delivery keeps both accounts blocked across restarts',async()=>fixture(async connect=>{
  const a=connect().gate,b=connect().gate;
  const t=a.beginFanout(B,[A]);
  await assert.rejects(a.completeFanout(t,{verify:async()=>{
    throw Error('qa_unknown_remote_effect');
  }}),/qa_unknown_remote_effect/);
  assert.throws(()=>b.seal(A),/qa_worker_drain_pending_privileged_effect/);
  assert.deepEqual(connect().gate.status(A),{state:'draining',pending:1});
  assert.throws(()=>b.beginFanout(B,[A]),/qa_worker_drain_privileged_effect_blocked/);
  assert.equal(await connect().gate.completeFanout(t,{verify:async()=>true}),true);
  assert.equal(connect().gate.seal(A),true);
}));

test('legacy single-owner ledger schema is refused until review',async()=>fixture(async connect=>{
  const {db}=connect();
  const old=new DatabaseSync(':memory:');
  try{
    old.exec("CREATE TABLE qa_worker_drain_effects ("+
      "id TEXT PRIMARY KEY,uid TEXT NOT NULL,kind TEXT NOT NULL)");
    assert.throws(()=>createQaWorkerDrainAdapter(old),
      /qa_worker_drain_legacy_schema_requires_review/);
  }finally{old.close();}
}));

test('legacy single-UID Push API cannot bypass required multi-account admission',async()=>fixture(async connect=>{
  const a=connect().gate;
  assert.throws(()=>a.begin(A,'push_fanout'),
    /qa_worker_drain_fanout_scope_required/);
  const allowed=a.beginFanout(B,[A]);
  await assert.rejects(a.complete({
    id:allowed.id,kind:'push_fanout',uid:B
  },{verify:async()=>true}),/qa_worker_drain_invalid_completion/);
  assert.deepEqual(a.status(A),{state:'active',pending:1});
  assert.deepEqual(a.status(B),{state:'active',pending:1});
  await a.completeFanout(allowed,{verify:async()=>true});
  assert.equal(a.status(A).pending,0);
  assert.equal(a.status(B).pending,0);
}));
