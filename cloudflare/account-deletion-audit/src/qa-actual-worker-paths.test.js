import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQaPrivilegedWriteBarrier}
  from './qa-privileged-write-barrier.js';
import {runQaActualWorkerPath,QA_ACTUAL_WORKER_PATHS}
  from './qa-actual-worker-paths.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const caseId='guard_'+'a'.repeat(32);
const ROOT='projects/atrio-catolico/databases/(default)/documents';
const schema=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
const avatarSchema=readFileSync(new URL('../../avatar-worker/schema.sql',import.meta.url),'utf8');
const before=process.env.ATRIO_PRIVILEGED_QA_ONLY;
process.env.ATRIO_PRIVILEGED_QA_ONLY='true';
const sv=v=>({stringValue:v});
async function fixture(fn){
  const dir=mkdtempSync(join(tmpdir(),'atrio-qa-worker-paths-'));
  const sqlite=new DatabaseSync(join(dir,'barrier.sqlite'));
  const avatar=new DatabaseSync(':memory:');
  sqlite.exec(schema);
  avatar.exec(avatarSchema);
  const d1={
    prepare(sql){return {bind(...args){return {
      async run(){
        const result=avatar.prepare(sql).run(...args);
        return {meta:{changes:Number(result.changes)}};
      },
      async first(){return avatar.prepare(sql).get(...args)||null;}
    };}};}
  };
  const barrierDb={
    prepare(sql){return {bind(...args){return {
      async all(){return {results:sqlite.prepare(sql).all(...args)};},
      async first(){return sqlite.prepare(sql).get(...args)||null;}
    };}};}
  };
  let fetchCalls=0,guardianCommits=0,avatarIdentityChecks=0,pushWrites=0;
  let failPush=false, failAvatar=false;
  const guardianDb={
    resource:ROOT,
    async get(path){
      if(path==='guardiao_quarantine/'+caseId)return {
        name:ROOT+'/'+path,updateTime:'2026-10-31T13:00:00Z',
        fields:{status:sv('held'),ownerUid:sv(A),
          targetPath:sv(ROOT+'/posts/qa_post/replies/qa_reply'),
          originalFields:{mapValue:{fields:{uid:sv(A),body:sv('fictitious')}}}}
      };
      if(path==='guardian_cases/'+caseId)return {
        name:ROOT+'/'+path,updateTime:'2026-10-31T13:00:00Z',
        fields:{status:sv('held'),ownerUid:sv(A),
          targetPath:sv('posts/qa_post/replies/qa_reply'),postId:sv('qa_post')}
      };
      throw Error('qa_guardian_unexpected_read');
    },
    async commit(writes){
      assert.equal(Array.isArray(writes),true);
      assert.equal(writes.length,4);
      guardianCommits++;
      return true;
    }
  };
  const fetchMock=async (url,init)=>{
    fetchCalls++;
    if(url.startsWith('https://identitytoolkit.googleapis.com/')){
      avatarIdentityChecks++;
      assert.equal(init.method,'POST');
      if(failAvatar)throw Error('qa_firebase_identity_unavailable');
      return new Response(JSON.stringify({users:[{localId:A,disabled:false}]}),
        {status:200});
    }
    if(url.startsWith('https://firestore.googleapis.com/')){
      assert.ok(url.endsWith('/documents:batchWrite'));
      assert.equal(init.method,'POST');
      const body=JSON.parse(init.body);
      assert.equal(body.writes.length,1);
      assert.equal(body.writes[0].update.name,
        ROOT+'/users/'+A+'/notifications/qa_reply');
      pushWrites++;
      if(failPush)throw Error('qa_firestore_write_unknown');
      return new Response(JSON.stringify({status:[{}]}),{status:200});
    }
    throw Error('qa_unexpected_network');
  };
  const gate=createQaPrivilegedWriteBarrier(barrierDb);
  const adapter=path=>({
    db:path==='avatar_status'?d1:guardianDb,
    fetchMock,
    verify:async outcome=>{
      if(path==='avatar_status')return outcome?.status==='no_pending' &&
        avatar.prepare('SELECT COUNT(*) AS n FROM avatar_mutex').get().n===0 &&
        avatarIdentityChecks>=1;
      if(path==='guardian_review')return outcome?.status==='confirmed' &&
        guardianCommits===1;
      if(path==='push_thread_notice')return outcome?.status==='submitted_to_fake_firestore' && pushWrites===1;
      return false;
    }
  });
  try{
    return await fn({gate,adapter,metrics:()=>({fetchCalls,guardianCommits,avatarIdentityChecks,pushWrites}),
      setFailPush:v=>{failPush=v;},setFailAvatar:v=>{failAvatar=v;}});
  }finally{
    avatar.close();sqlite.close();rmSync(dir,{recursive:true,force:true});
  }
}

test('three allowed operations execute exported, real Worker functions with mocks',async()=>{
  await fixture(async({gate,adapter,metrics})=>{
    assert.deepEqual(QA_ACTUAL_WORKER_PATHS,
      ['avatar_status','guardian_review','push_thread_notice']);
    for(const path of QA_ACTUAL_WORKER_PATHS){
      const result=await runQaActualWorkerPath(gate,path,adapter(path));
      assert.equal(result.status,'qa_actual_worker_path_verified');
      assert.equal(result.productionReady,false);
    }
    assert.deepEqual(await gate.status(A),{state:'active',inFlight:0});
    const m=metrics();
    assert.equal(m.avatarIdentityChecks,1);
    assert.equal(m.guardianCommits,1);
    assert.equal(m.pushWrites,1);
  });
});

test('draining denies ALL three actual Worker paths BEFORE any side effect',async()=>{
  await fixture(async({gate,adapter,metrics})=>{
    await gate.beginFreeze(A);
    const first=metrics();
    for(const path of QA_ACTUAL_WORKER_PATHS){
      await assert.rejects(runQaActualWorkerPath(gate,path,adapter(path)),
        /qa_privileged_write_blocked/);
    }
    assert.deepEqual(metrics(),first);
    assert.equal(await gate.finalizeFreeze(A),'frozen');
  });
});

test('frozen account remains blocked across subsequent attempts',async()=>{
  await fixture(async({gate,adapter,metrics})=>{
    await gate.beginFreeze(A);
    await gate.finalizeFreeze(A);
    for(let round=0;round<2;round++){
      for(const path of QA_ACTUAL_WORKER_PATHS)
        await assert.rejects(runQaActualWorkerPath(gate,path,adapter(path)),
          /qa_privileged_write_blocked/);
    }
    assert.equal(metrics().fetchCalls,0);
  });
});

test('unknown Firebase result keeps ticket open and prevents final freeze',async()=>{
  await fixture(async({gate,adapter,setFailAvatar})=>{
    setFailAvatar(true);
    await assert.rejects(runQaActualWorkerPath(gate,'avatar_status',
      adapter('avatar_status')),/qa_avatar_actual_path_unexpected/);
    assert.equal((await gate.status(A)).inFlight,1);
    await gate.beginFreeze(A);
    await assert.rejects(gate.finalizeFreeze(A),/qa_inflight_or_not_draining/);
  });
});

test('unknown Firestore batchWrite result keeps push ticket open',async()=>{
  await fixture(async({gate,adapter,setFailPush,metrics})=>{
    setFailPush(true);
    await assert.rejects(runQaActualWorkerPath(gate,'push_thread_notice',
      adapter('push_thread_notice')),/qa_firestore_write_unknown/);
    assert.equal(metrics().pushWrites,1);
    await gate.beginFreeze(A);
    await assert.rejects(gate.finalizeFreeze(A),/qa_inflight_or_not_draining/);
  });
});

test('verification failure does not turn an actual Worker call into completed ticket',async()=>{
  await fixture(async({gate,adapter})=>{
    const invalid={...adapter('guardian_review'),verify:async()=>false};
    await assert.rejects(runQaActualWorkerPath(gate,'guardian_review',invalid),
      /qa_unverified_external_effect/);
    assert.equal((await gate.status(A)).inFlight,1);
  });
});

test('unrecognized Worker path, missing QA mode or remote credentials fail first',async()=>{
  await fixture(async({gate,adapter,metrics})=>{
    await assert.rejects(runQaActualWorkerPath(gate,'push_free_all',adapter('avatar_status')),
      /qa_unknown_worker_path/);
    const previous=process.env.ATRIO_PRIVILEGED_QA_ONLY;
    try{
      delete process.env.ATRIO_PRIVILEGED_QA_ONLY;
      await assert.rejects(runQaActualWorkerPath(gate,'avatar_status',adapter('avatar_status')),
        /qa_worker_harness_environment_denied/);
    }finally{process.env.ATRIO_PRIVILEGED_QA_ONLY=previous;}
    const original=process.env.GOOGLE_APPLICATION_CREDENTIALS;
    try{
      process.env.GOOGLE_APPLICATION_CREDENTIALS='/tmp/qa-will-not-read.json';
      await assert.rejects(runQaActualWorkerPath(gate,'guardian_review',adapter('guardian_review')),
        /qa_worker_harness_environment_denied/);
    }finally{
      if(original===undefined)delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      else process.env.GOOGLE_APPLICATION_CREDENTIALS=original;
    }
    assert.deepEqual(metrics(),{
      fetchCalls:0,guardianCommits:0,avatarIdentityChecks:0,pushWrites:0
    });
  });
});

test('QA integration stops if the Guardian DB adapter is unavailable',async()=>{
  await fixture(async({gate,adapter})=>{
    const broken={...adapter('guardian_review'),db:{}};
    await assert.rejects(runQaActualWorkerPath(gate,'guardian_review',broken),
      /qa_invalid_guardian_db/);
    assert.equal((await gate.status(A)).inFlight,1);
  });
});
