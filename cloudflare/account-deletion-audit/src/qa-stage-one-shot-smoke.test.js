import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import stage from '../../privacy-freeze-stage/src/index.js';
import consumer from '../../privacy-freeze-stage/src/fixture-consumer.js';
import {runOneShotSmoke} from '../../privacy-freeze-stage/src/one-shot-smoke.js';

const roles=['avatar','guardian','push','admin','reconciler'];
const names={avatar:'STAGE_AVATAR_HMAC',guardian:'STAGE_GUARDIAN_HMAC',
  push:'STAGE_PUSH_HMAC',admin:'STAGE_ADMIN_HMAC',
  reconciler:'STAGE_RECONCILER_HMAC'};
const secret=r=>'qa-only-role-specific-secret-'+r+'-1234567890';
function demo(){
  const raw=new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL(
    '../../privacy-freeze-stage/migrations/0001_fixture_only.sql',import.meta.url),'utf8'));
  raw.exec('CREATE TABLE qa_stage_smoke_runs (run_id TEXT PRIMARY KEY,status TEXT,started_ms INTEGER,completed_ms INTEGER)');
  const db={prepare(query){return {bind(...params){return {
    async first(){return raw.prepare(query).get(...params)||null;},
    async all(){return {results:raw.prepare(query).all(...params)};},
    async run(){const result=raw.prepare(query).run(...params);
      return {success:true,meta:{changes:result.changes}};}
  };}};}};
  const env={ATRIO_PRIVACY_STAGE_ID:'demo-atrio-v11',STAGE_FREEZE_DB:db};
  for(const role of roles)env[names[role]]=secret(role);
  const central={fetch:r=>stage.fetch(r,env)};
  const smokeEnv={ATRIO_QA_SMOKE_MODE:'demo-atrio-v11',
    ATRIO_QA_SMOKE_DB:db};
  for(const role of roles)smokeEnv['QA_'+role.toUpperCase()]={
    fetch:request=>consumer.fetch(request,{
      PRIVACY_FREEZE_STAGE:central,
      ATRIO_QA_CONSUMER_ROLE:role,
      ATRIO_QA_CONSUMER_FIXTURE:'demo-atrio-v11',
      ATRIO_QA_CONSUMER_HMAC:secret(role)
    })
  };
  const status=()=>raw.prepare('SELECT status FROM qa_stage_smoke_runs').get()?.status;
  const tickets=()=>raw.prepare('SELECT COUNT(*) AS n FROM qa_privileged_operations').get().n;
  const nonces=()=>raw.prepare('SELECT COUNT(*) AS n FROM qa_stage_nonces').get().n;
  return {smokeEnv,status,tickets,nonces,close:()=>raw.close()};
}
async function forbidOutbound(action){
  const old=globalThis.fetch;let called=0;
  globalThis.fetch=async()=>{called++;throw Error('external_network_forbidden')};
  try{const result=await action();assert.equal(called,0);return result;}
  finally{globalThis.fetch=old;}
}
test('five original service roles execute one staged HMAC+D1 test without public fetch',async()=>{
  const t=demo();
  try{await forbidOutbound(async()=>{
    assert.deepEqual(await runOneShotSmoke(t.smokeEnv),{status:'passed'});
    assert.equal(t.status(),'passed');
    assert.equal(t.tickets(),0);
    assert.equal(t.nonces(),8);
    assert.deepEqual(await runOneShotSmoke(t.smokeEnv),{status:'already_attempted'});
    assert.equal(t.nonces(),8);
  });}finally{t.close();}
});
test('refusal in one private consumer is persistent fail, no automatic retry',async()=>{
  const t=demo();
  try{
    t.smokeEnv.QA_GUARDIAN={fetch:async()=>new Response('{}',{status:403})};
    assert.deepEqual(await runOneShotSmoke(t.smokeEnv),{status:'failed'});
    assert.equal(t.status(),'failed');
    assert.equal(t.tickets(),1);
    assert.deepEqual(await runOneShotSmoke(t.smokeEnv),{status:'already_attempted'});
    assert.equal(t.tickets(),1);
  }finally{t.close();}
});
test('a missing D1 or binding aborts before writing status',async()=>{
  const t=demo();
  try{
    const wrong={...t.smokeEnv,QA_PUSH:undefined};
    await assert.rejects(runOneShotSmoke(wrong),/qa_smoke_not_configured/);
    assert.equal(t.status(),undefined);
  }finally{t.close();}
});
test('the private smoke Worker HTTP handler never opens a route',async()=>{
  const mod=await import('../../privacy-freeze-stage/src/one-shot-smoke.js');
  const resp=await mod.default.fetch(new Request('https://example.org/'));
  assert.equal(resp.status,403);
});
