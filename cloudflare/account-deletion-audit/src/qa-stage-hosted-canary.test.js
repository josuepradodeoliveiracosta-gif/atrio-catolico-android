/**
 * Hosted canary contract: same Worker fetch() / Service Binding / D1
 * code as the actual QA deployment, using SQLite only in CI.
 * The operational hosted proof is recorded separately by querying QA D1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import stage from '../../privacy-freeze-stage/src/index.js';
import consumer from '../../privacy-freeze-stage/src/fixture-consumer.js';
import {createStageServiceClient} from '../../privacy-freeze-stage/src/client.js';
import {stageSignature,STAGE_ID,STAGE_HOST}
  from '../../privacy-freeze-stage/src/protocol.js';

const ROLES=['avatar','guardian','push'];
const UID={avatar:'qa-freeze-alice',
  guardian:'qa-freeze-bob',push:'qa-freeze-alice'};
const KEY=role=>'fixture-hosted-HMAC-'+role+'-20261103-very-long-secret';
const when=Date.parse('2026-11-03T20:39:00Z');
function setup(){
  const sqlite=new DatabaseSync(':memory:');
  for(const filename of ['0001_fixture_only.sql','0002_qa_deletion_cases.sql',
    '0003_qa_hosted_canary.sql',
    '0006_qa_role_hmac_probes.sql']){
    sqlite.exec(readFileSync(new URL(
      '../../privacy-freeze-stage/migrations/'+filename,import.meta.url),'utf8'));
  }
  const d1={prepare(sql){return {bind(...args){return{
    async all(){return {results:sqlite.prepare(sql).all(...args)};},
    async first(){return sqlite.prepare(sql).get(...args)||null;},
    async run(){const r=sqlite.prepare(sql).run(...args);return{
      success:true,meta:{changes:r.changes}
    };}
  };}};}};
  const stageEnv={ATRIO_PRIVACY_STAGE_ID:STAGE_ID,STAGE_FREEZE_DB:d1,
    STAGE_AVATAR_HMAC:KEY('avatar'),
    STAGE_GUARDIAN_HMAC:KEY('guardian'),
    STAGE_PUSH_HMAC:KEY('push'),
    STAGE_ADMIN_HMAC:KEY('admin'),
    STAGE_RECONCILER_HMAC:KEY('reconciler')};
  const binding={fetch:req=>stage.fetch(req,stageEnv)};
  const consumerEnv=role=>({
    ATRIO_QA_CONSUMER_ROLE:role,
    ATRIO_QA_CONSUMER_FIXTURE:STAGE_ID,
    ATRIO_QA_CONSUMER_HMAC:KEY(role),
    PRIVACY_FREEZE_STAGE:binding
  });
  const admin=createStageServiceClient({binding,role:'admin',secret:KEY('admin')});
  const counts=()=>({
    canaries:sqlite.prepare('SELECT COUNT(*) AS n FROM qa_stage_hosted_canaries')
      .get().n,
    pending:sqlite.prepare('SELECT COUNT(*) AS n FROM qa_privileged_operations')
      .get().n,
    nonces:sqlite.prepare('SELECT COUNT(*) AS n FROM qa_stage_nonces')
      .get().n
  });
  const scheduled=(role,overrides={})=>consumer.scheduled(
    {cron:'* * * * *',scheduledTime:when,...overrides},consumerEnv(role));
  return {sqlite,binding,stageEnv,consumerEnv,scheduled,admin,counts,
    close:()=>sqlite.close()};
}
const noNetwork=async fn=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('real_network_forbidden');};
  try{return await fn();}finally{globalThis.fetch=old;}
};
test('three scheduled QA Workers authenticate and close admission via real barrier SQL',async()=>{
  const t=setup();
  try{await noNetwork(async()=>{
    for(const role of ROLES)await t.scheduled(role);
    const rows=t.sqlite.prepare(
      'SELECT role,uid,run_id,result FROM qa_stage_hosted_canaries ORDER BY role'
    ).all();
    assert.deepEqual(rows.map(r=>r.role),[...ROLES].sort());
    assert.equal(rows.length,3);
    for(const r of rows){
      assert.equal(r.uid,UID[r.role]);
      assert.equal(r.run_id,'qa-hosted-20261103-a');
      assert.equal(r.result,'completed');
    }
    assert.deepEqual(t.counts(),{canaries:3,pending:0,nonces:3});
    assert.equal((await t.admin.request('status',{uid:'qa-freeze-alice'})).state,
      'active');
    assert.equal((await t.admin.request('status',{uid:'qa-freeze-bob'})).state,
      'active');
  })}finally{t.close()}
});
test('at-least-once cron delivery never admits a second QA canary',async()=>{
  const t=setup();
  try{
    await Promise.all([t.scheduled('avatar'),t.scheduled('avatar')]);
    assert.deepEqual(t.counts(),{canaries:1,pending:0,nonces:1});
    await t.scheduled('avatar');
    assert.deepEqual(t.counts(),{canaries:1,pending:0,nonces:1});
  }finally{t.close()}
});
test('freeze of QA recipient blocks guardian and push from completing hosted admission',async()=>{
  const t=setup();
  try{
    await t.admin.request('drain',{uid:'qa-freeze-bob'});
    await t.admin.request('finalize',{uid:'qa-freeze-bob'});
    await t.scheduled('guardian');
    await t.scheduled('push');
    assert.equal(t.counts().canaries,0);
    assert.equal(t.counts().pending,0);
    await t.scheduled('avatar');
    assert.equal(t.counts().canaries,1);
  }finally{t.close()}
});
test('Cron is ignored outside exact QA time window or with missing stage binding',async()=>{
  const t=setup();
  try{
    await t.scheduled('avatar',{cron:'0 0 1 1 *'});
    await t.scheduled('avatar',{scheduledTime:Date.parse('2026-11-05T00:00:00Z')});
    await t.scheduled('avatar',{scheduledTime:Date.parse('2026-11-02T00:00:00Z')});
    const env=t.consumerEnv('avatar');
    delete env.PRIVACY_FREEZE_STAGE;
    await consumer.scheduled({cron:'* * * * *',scheduledTime:when},env);
    assert.deepEqual(t.counts(),{canaries:0,pending:0,nonces:0});
  }finally{t.close()}
});
test('signed real UID and cross-role impersonation never create a hosted record',async()=>{
  const t=setup();
  try{
    const path='/v1/canary',moment=Date.now();
    const data={uid:'uid-of-a-customer',runId:'qa-hosted-20261103-a'},
      body=JSON.stringify(data),nonce=crypto.randomUUID();
    const signature=await stageSignature(KEY('avatar'),{
      role:'avatar',timestamp:moment,nonce,path,body
    });
    const headers={'x-atrio-role':'avatar',
      'x-atrio-time':String(moment),'x-atrio-nonce':nonce,
      'x-atrio-signature':signature};
    const request=(body,headers)=>new Request(STAGE_HOST+path,{
      method:'POST',body,headers
    });
    assert.equal((await t.binding.fetch(request(body,headers))).status,403);
    const fakeBody=JSON.stringify({uid:'qa-freeze-bob',runId:data.runId});
    assert.equal((await t.binding.fetch(request(fakeBody,headers))).status,403);
    assert.deepEqual(t.counts(),{canaries:0,pending:0,nonces:0});
  }finally{t.close()}
});
test('no public URL or client fetch permission, only private scheduled handler',async()=>{
  const t=setup();
  try{
    const env=t.consumerEnv('avatar');
    assert.equal((await consumer.fetch(new Request('https://example.org/__qa/admit',{
      method:'POST'
    }),env)).status,403);
    assert.equal((await consumer.fetch(new Request('https://qa-only.invalid/__qa/admit',{
      method:'GET'
    }),env)).status,403);
    assert.equal(t.counts().canaries,0);
  }finally{t.close()}
});

test('read-only per-role HMAC probe crosses Service Binding but never opens a ticket',async()=>{
  const t=setup();
  try{await noNetwork(async()=>{
    // First prove the target of the old canary is already frozen while a
    // neighbor is still active. This matches the hosted QA fixture state.
    await t.admin.request('drain',{uid:'qa-freeze-alice'});
    await t.admin.request('finalize',{uid:'qa-freeze-alice'});
    const prior=t.counts();
    const at=Date.parse('2026-11-04T13:05:00Z');
    for(const role of ROLES)await t.scheduled(role,{scheduledTime:at});
    const after=t.counts();
    assert.equal(after.canaries,prior.canaries);
    assert.equal(after.pending,0);
    assert.equal(after.nonces,prior.nonces+3);
    const proofs=t.sqlite.prepare(
      'SELECT role,uid,observed_state,in_flight FROM qa_stage_hmac_role_proofs ORDER BY role'
    ).all().map(row=>({...row}));
    assert.deepEqual(proofs,[
      {role:'avatar',uid:'qa-freeze-alice',observed_state:'frozen',in_flight:0},
      {role:'guardian',uid:'qa-freeze-bob',observed_state:'active',in_flight:0},
      {role:'push',uid:'qa-freeze-alice',observed_state:'frozen',in_flight:0}
    ]);
    for(const nonce of [
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666'
    ]){
      assert.equal(t.sqlite.prepare(
        'SELECT COUNT(*) AS n FROM qa_stage_nonces WHERE nonce=?'
      ).get(nonce).n,1);
    }
    assert.equal((await t.admin.request('status',{uid:'qa-freeze-alice'})).state,
      'frozen');
    assert.equal((await t.admin.request('status',{uid:'qa-freeze-bob'})).state,
      'active');
    for(const role of ROLES)await t.scheduled(role,{scheduledTime:at+60000});
    assert.equal(t.counts().nonces,after.nonces+2);
    // The two additional D1 nonces above are from the admin status calls,
    // NOT from replaying a fixed per-role probe.
    assert.equal(t.counts().pending,0);
    assert.equal(t.sqlite.prepare(
      'SELECT COUNT(*) AS n FROM qa_stage_hmac_role_proofs'
    ).get().n,3);
  })}finally{t.close();}
});
test('per-role probes reject cross-UID reads and cannot inherit admin authority',async()=>{
  const t=setup();
  try{
    for(const [role,wrong] of [['avatar','qa-freeze-bob'],
      ['guardian','qa-freeze-alice'],['push','qa-freeze-bob']]){
      await assert.rejects(createStageServiceClient({
        binding:t.binding,role,secret:KEY(role)
      }).request('roleStatus',{uid:wrong}),/qa_stage_client_denied/);
    }
    await assert.rejects(t.admin.request('roleStatus',{uid:'qa-freeze-alice'}),
      /qa_stage_client_denied/);
    assert.deepEqual(t.counts(),{canaries:0,pending:0,nonces:0});
  }finally{t.close();}
});
test('private probe is disabled after its single UTC fixture day',async()=>{
  const t=setup();
  try{
    await t.scheduled('avatar',{scheduledTime:Date.parse('2026-11-05T00:00:00Z')});
    await t.scheduled('guardian',{scheduledTime:Date.parse('2026-11-06T13:00:00Z')});
    await t.scheduled('push',{cron:'0 0 * * *',scheduledTime:Date.parse('2026-11-04T13:00:00Z')});
    assert.deepEqual(t.counts(),{canaries:0,pending:0,nonces:0});
  }finally{t.close();}
});

test('nonce consumed during rejected probe must never masquerade as successful readback',async()=>{
  const t=setup();
  try{
    const api=createStageServiceClient({
      binding:t.binding,role:'avatar',secret:KEY('avatar'),
      createNonce:()=> '44444444-4444-4444-8444-444444444444'
    });
    // Alice is ACTIVE, not frozen. The new probe must fail after nonce
    // authentication and without inserting any successful proof.
    await assert.rejects(api.request('roleStatus',{uid:'qa-freeze-alice'}),
      /qa_stage_client_denied/);
    assert.equal(t.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM qa_stage_nonces WHERE nonce='44444444-4444-4444-8444-444444444444'"
    ).get().n,1);
    assert.equal(t.sqlite.prepare(
      'SELECT COUNT(*) AS n FROM qa_stage_hmac_role_proofs'
    ).get().n,0);
    await assert.rejects(api.request('roleStatus',{uid:'qa-freeze-alice'}),
      /qa_stage_client_denied/);
  }finally{t.close();}
});
test('role HMAC receipts cannot be forged or bypass single-account scope constraints',async()=>{
  const t=setup();
  try{
    await assert.rejects(t.admin.request('roleStatus',{uid:'qa-freeze-alice'}),
      /qa_stage_client_denied/);
    assert.throws(()=>t.sqlite.prepare(
      "INSERT INTO qa_stage_hmac_role_proofs VALUES ('push','qa-freeze-bob',"+
      "'66666666-6666-4666-8666-666666666666','frozen',0,2000000000000)"
    ).run(),/CHECK constraint failed/);
    assert.equal(t.sqlite.prepare(
      'SELECT COUNT(*) AS n FROM qa_stage_hmac_role_proofs'
    ).get().n,0);
  }finally{t.close();}
});
test('a pending ticket prevents HMAC proof even when a stale readback reports success',async()=>{
  const t=setup();
  try{
    await t.admin.request('drain',{uid:'qa-freeze-alice'});
    await t.admin.request('finalize',{uid:'qa-freeze-alice'});
    t.sqlite.prepare('INSERT INTO qa_privileged_operations VALUES (?,?,?)')
      .run(crypto.randomUUID(),'qa-freeze-bob','guardian_content_write');
    const client=createStageServiceClient({
      binding:t.binding,role:'avatar',secret:KEY('avatar'),
      createNonce:()=> '44444444-4444-4444-8444-444444444444'
    });
    await assert.rejects(client.request('roleStatus',{uid:'qa-freeze-alice'}),
      /qa_stage_client_denied/);
    assert.equal(t.sqlite.prepare(
      'SELECT COUNT(*) AS n FROM qa_stage_hmac_role_proofs'
    ).get().n,0);
    assert.equal(t.sqlite.prepare(
      'SELECT COUNT(*) AS n FROM qa_privileged_operations'
    ).get().n,1);
  }finally{t.close();}
});
