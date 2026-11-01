/**
 * Original THREE Workers using an authenticated, signed Service Binding into
 * one SQL-backed staging coordinator (still 100% offline and fixture-only).
 * This does NOT exercise normal production write paths or real Cloudflare D1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import avatar from '../../avatar-worker/src/index.js';
import guardian from '../../guardian-worker/src/index.js';
import push from '../../push-worker/src/index.js';
import stage from '../../privacy-freeze-stage/src/index.js';
import {createStageServiceClient} from '../../privacy-freeze-stage/src/client.js';

const roles=['avatar','guardian','push'];
const workers={avatar,guardian,push};
const scope={avatar:{ownerUid:'qa-freeze-alice'},
  guardian:{ownerUid:'qa-freeze-bob'},
  push:{actorUid:'qa-freeze-alice',recipientUid:'qa-freeze-bob'}};
const keys={avatar:'STAGE_AVATAR_HMAC',guardian:'STAGE_GUARDIAN_HMAC',
  push:'STAGE_PUSH_HMAC',admin:'STAGE_ADMIN_HMAC',
  reconciler:'STAGE_RECONCILER_HMAC'};
const secret=r=>'long-fictional-qa-role-key-'+r+'-not-deployable';
const sql=readFileSync(new URL('../../privacy-freeze-stage/migrations/0001_fixture_only.sql',
  import.meta.url),'utf8');
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(sql);
  const d1={prepare(query){return {bind(...params){return {
    async all(){return {results:db.prepare(query).all(...params)};},
    async first(){return db.prepare(query).get(...params)||null;},
    async run(){const value=db.prepare(query).run(...params);
      return {success:true,meta:{changes:value.changes}};}
  };}};}};
  const stageEnv={ATRIO_PRIVACY_STAGE_ID:'demo-atrio-v11',STAGE_FREEZE_DB:d1};
  for(const role of [...roles,'admin','reconciler'])
    stageEnv[keys[role]]=secret(role);
  const binding={fetch:req=>stage.fetch(req,stageEnv)};
  const service=role=>createStageServiceClient({binding,role,secret:secret(role)});
  const env=(role,bind=binding)=>({
    ATRIO_PRIVACY_QA_SHARED_MODE:'true',
    ATRIO_QA_PRIVACY_FIXTURE:'demo-atrio-v11',
    ATRIO_QA_PRIVACY_STAGE_BINDING:bind,
    ATRIO_QA_PRIVACY_STAGE_SECRET:secret(role)
  });
  const execute=async(role,options=env(role),body=scope[role])=>{
    const req=new Request('https://qa-only.invalid/__qa/shared-freeze/'+role,{
      method:'POST',body:JSON.stringify(body)
    });
    const res=await workers[role].fetch(req,options);
    return {code:res.status,...await res.json()};
  };
  const pending=()=>db.prepare(
    'SELECT operation_id,uid FROM qa_privileged_operations ORDER BY uid'
  ).all();
  return {service,env,execute,pending,stageEnv,db,close:()=>db.close()};
}
async function noNetwork(action){
  const old=globalThis.fetch;let n=0;
  globalThis.fetch=async()=>{n++;throw Error('external_io_forbidden')};
  try{const result=await action();assert.equal(n,0);return result}
  finally{globalThis.fetch=old}
}
test('real Avatar, Guardian and Push QA entries call one HMAC service binding',async()=>{
  const f=fixture();
  try{await noNetwork(async()=>{
    const ids=[];
    for(const role of roles){
      const result=await f.execute(role);
      assert.equal(result.code,200);
      assert.equal(result.status,'qa_stage_admitted');
      assert.match(result.operationId,/^[a-f0-9-]{36}$/);
      ids.push(result.operationId);
    }
    assert.equal(f.pending().length,4);
    await f.service('admin').request('drain',{uid:'qa-freeze-alice'});
    assert.equal((await f.execute('avatar')).code,503);
    assert.equal((await f.execute('push')).code,503);
    // Bob-only Guardian remains eligible.
    const bob=await f.execute('guardian');
    assert.equal(bob.code,200);
    await assert.rejects(f.service('admin').request('finalize',{uid:'qa-freeze-alice'}),
      /qa_stage_client_denied/);
    for(const id of ids){
      await f.service('reconciler').request('close',{
        operationId:id,fixtureEvidence:'demo-confirmed'
      });
    }
    assert.equal((await f.service('admin').request('finalize',{uid:'qa-freeze-alice'})).status,
      'stage_frozen');
    assert.equal((await f.service('admin').request('status',{uid:'qa-freeze-bob'})).inFlight,1);
    await f.service('reconciler').request('close',{
      operationId:bob.operationId,fixtureEvidence:'demo-confirmed'
    });
    assert.equal(f.pending().length,0);
  })}finally{f.close()}
});
test('bad role key or a production credential rejects without reaching D1',async()=>{
  const f=fixture();
  try{await noNetwork(async()=>{
    for(const role of roles){
      const wrong=f.env(role);
      wrong.ATRIO_QA_PRIVACY_STAGE_SECRET=secret('admin');
      const result=await f.execute(role,wrong);
      assert.equal(result.code,503);
      const contaminated=f.env(role);
      let secretReads=0;
      Object.defineProperty(contaminated,'FIREBASE_SERVICE_ACCOUNT_JSON',{
        get(){secretReads++;throw Error('secret_read_forbidden')}
      });
      assert.equal((await f.execute(role,contaminated)).code,503);
      assert.equal(secretReads,0);
    }
    assert.equal(f.pending().length,0);
  })}finally{f.close()}
});
test('lost Service Binding response after D1 admission leaves unverified ticket',async()=>{
  const f=fixture();
  try{await noNetwork(async()=>{
    const dropped={fetch:async request=>{
      const result=await stage.fetch(request,f.stageEnv);
      assert.equal(result.status,200);
      throw Error('qa_binding_transport_timeout');
    }};
    const reply=await f.execute('push',f.env('push',dropped));
    assert.equal(reply.code,503);
    assert.equal(f.pending().length,2);
    await f.service('admin').request('drain',{uid:'qa-freeze-bob'});
    await assert.rejects(f.service('admin').request('finalize',{uid:'qa-freeze-bob'}),
      /qa_stage_client_denied/);
    assert.equal((await f.execute('guardian')).code,503);
    assert.equal((await f.service('admin').request('status',{uid:'qa-freeze-bob'})).inFlight,1);
  })}finally{f.close()}
});
test('service binding stages only fixture UIDs, not topic fanout or real accounts',async()=>{
  const f=fixture();
  try{await noNetwork(async()=>{
    for(const role of roles){
      const result=await f.execute(role,f.env(role),{ownerUid:'real-user'});
      assert.equal(result.code,503);
    }
    assert.equal((await f.execute('push',f.env('push'),{
      actorUid:'qa-freeze-alice',recipientUid:'qa-freeze-bob',
      topic:'atrio_comunicados_v1'
    })).code,503);
    assert.equal(f.pending().length,0);
  })}finally{f.close()}
});
