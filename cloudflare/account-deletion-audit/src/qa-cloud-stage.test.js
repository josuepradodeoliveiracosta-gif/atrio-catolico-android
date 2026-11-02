import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import worker,{QA_STAGE_ID,QA_STAGE_HOST,QA_CLOUD_STAGE_READINESS}
  from '../../privacy-batch-stage/src/index.js';
import {preflightBatchStage,auditBatchStageRepo,assessQaCloudflareIsolation}
  from '../../privacy-batch-stage/scripts/preflight.mjs';
const migration=readFileSync(
  new URL('../../privacy-batch-stage/migrations/0001_fixture_only.sql',import.meta.url),'utf8');
const template=readFileSync(
  new URL('../../privacy-batch-stage/wrangler.staging.example.toml',import.meta.url),'utf8');
const secrets={
  push:'fixture-qa-batch-push-scope-only-000000000000',
  admin:'fixture-qa-batch-admin-scope-only-00000000000',
  reconciler:'fixture-qa-batch-reconciler-only-00000000'
};
const roleEnv={
  QA_BATCH_PUSH_HMAC:secrets.push,QA_BATCH_ADMIN_HMAC:secrets.admin,
  QA_BATCH_RECONCILER_HMAC:secrets.reconciler
};
const requestId='qa-broadcast-sandbox-01';
const uid=i=>'qa-batch-'+String(i).padStart(2,'0');
function store(){
  const dir=mkdtempSync(join(tmpdir(),'atrio-d1-qa-cloud-'));
  const file=join(dir,'stage.sqlite');
  const sqlites=[];
  function open(){
    const sqlite=new DatabaseSync(file);
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000');
    sqlites.push(sqlite);
    // Matches D1 prepared statement interface, without remote D1 I/O.
    const prepare=sql=>({
      bind(...args){
        const statement=sqlite.prepare(sql);
        const run=()=>{const r=statement.run(...args);
          return {success:true,meta:{changes:r.changes}};};
        return {
          async first(){return statement.get(...args)||null;},
          async all(){return {success:true,results:statement.all(...args)};},
          async run(){return run();},
          _run:run
        };
      }
    });
    return {
      prepare,
      async batch(statements){
        sqlite.exec('BEGIN IMMEDIATE');
        try{
          const r=statements.map(x=>x._run());
          sqlite.exec('COMMIT');
          return r;
        }catch(error){sqlite.exec('ROLLBACK');throw error;}
      }
    };
  }
  const db=open();
  sqlites[0].exec(migration);
  const env={
    ATRIO_QA_BATCH_STAGE_ID:QA_STAGE_ID,QA_BATCH_MODE:'fixture-only',
    QA_BATCH_STAGE_DB:db,...roleEnv
  };
  function close(){for(const d of sqlites)try{d.close()}catch{}
    rmSync(dir,{force:true,recursive:true});}
  const raw=()=>sqlites[0];
  return {env,open,close,raw};
}
async function signed(env,role,path,body,{nonce=crypto.randomUUID(),
  at=Date.now(),secret=secrets[role],url=QA_STAGE_HOST+path}={}){
  const raw=JSON.stringify(body);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const message=[QA_STAGE_ID,role,String(at),nonce,path,raw].join('\n');
  const bytes=new Uint8Array(await crypto.subtle.sign(
    'HMAC',key,new TextEncoder().encode(message)));
  const mac=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  return new Request(url,{method:'POST',headers:{
    'X-Qa-Role':role,'X-Qa-Time':String(at),'X-Qa-Nonce':nonce,
    'X-Qa-Signature':mac},body:raw});
}
const call=async (env,role,path,body)=>worker.fetch(
  await signed(env,role,path,body),env
);
const denied=async response=>assert.deepEqual({
  code:response.status,body:await response.json()
},{code:403,body:{status:'qa_cloud_stage_denied'}});
const offline=async fn=>{
  const old=globalThis.fetch;
  let attempted=0;
  globalThis.fetch=async()=>{attempted++;throw Error('real_network_forbidden');};
  try{let result=await fn();assert.equal(attempted,0);return result;}
  finally{globalThis.fetch=old;}
};
const delivery=s=>s.raw().prepare(
  'SELECT recipient_uid,state FROM qa_bcast_deliveries WHERE request_id=? ORDER BY recipient_uid'
).all(requestId);
test('offline config template requires new D1, has no public routes or live service binding',()=>{
  const v=auditBatchStageRepo();
  assert.equal(v.templateSafe,true,JSON.stringify(v.blocked));
  assert.equal(v.ready,false);
  const samples=[
    template.replace('workers_dev = false','workers_dev = true'),
    template.replace('preview_urls = false','preview_urls = true'),
    template.replace('REPLACE_WITH_NEW_DEDICATED_QA_D1_ID','11111111-1111-4111-8111-111111111111'),
    template+'\nroutes = ["live.example.com/*"]\n',
    template+'\n[triggers]\ncrons = ["*/5 * * * *"]\n',
    template+'\nQA_BATCH_PUSH_HMAC = "secret-leak"\n'
  ];
  for(const sample of samples)assert.equal(
    preflightBatchStage({template:sample,schema:migration}).templateSafe,false);
  assert.equal(preflightBatchStage({template,schema:migration,
    liveConfigs:{push:'QA_BATCH_STAGE_DB = "LIVE"'}}).templateSafe,false);
  assert.equal(preflightBatchStage({template,schema:migration,
    activeFiles:['wrangler.toml']}).templateSafe,false);
});
test('HMAC roles plan nine local identities and batch mock state 3+3+2 without FCM',async()=>{
  const s=store();try{await offline(async()=>{
    let r=await call(s.env,'push','/v1/plan',{requestId});
    assert.equal(r.status,200);
    assert.equal((await r.json()).queued,8);
    r=await call(s.env,'push','/v1/plan',{requestId});
    assert.equal((await r.json()).status,'qa_duplicate_plan');
    for(const wanted of [3,3,2,0]){
      const resp=await call(s.env,'push','/v1/process',{requestId,mode:'qa-accept'});
      assert.equal(resp.status,200);
      assert.equal((await resp.json()).attempted,wanted);
    }
    assert.equal(delivery(s).length,8);
    assert.ok(delivery(s).every(x=>x.state==='acked'));
    assert.equal(QA_CLOUD_STAGE_READINESS.deployed,false);
    assert.equal(QA_CLOUD_STAGE_READINESS.FcmEnabled,false);
  })}finally{s.close()}
});
test('bad actor, unsigned, expired, tampered or cross-role requests never reserve nonce',async()=>{
  const s=store();try{await offline(async()=>{
    const at=Date.now(),n=crypto.randomUUID();
    const valid=await signed(s.env,'push','/v1/plan',{requestId},{nonce:n,at});
    const headers=Object.fromEntries(valid.headers);
    const bads=[
      new Request(QA_STAGE_HOST+'/v1/plan',{method:'POST',body:'{}'}),
      new Request(QA_STAGE_HOST+'/v1/plan',{method:'POST',headers,body:'{"requestId":"qa-broadcast-other"}'}),
      await signed(s.env,'push','/v1/plan',{requestId},{nonce:n,at:at-120000}),
      await signed(s.env,'push','/v1/plan',{requestId},{url:'https://public.invalid/v1/plan'}),
      await signed(s.env,'push','/v1/plan',{requestId},{url:QA_STAGE_HOST+'/v1/plan?bypass=1'}),
      await signed(s.env,'push','/v1/plan',{requestId,realUid:'actual-customer'}),
      await signed(s.env,'push','/v1/reconcile',{
        requestId,recipientUid:uid(1),fixtureEvidence:'qa-reviewed-synthetic-effect'
      }),
    ];
    for(const req of bads)await denied(await worker.fetch(req,s.env));
    assert.equal(s.raw().prepare('SELECT COUNT(*) AS n FROM qa_bcast_nonces').get().n,0);
    assert.equal(s.raw().prepare('SELECT COUNT(*) AS n FROM qa_bcast_jobs').get().n,0);
  })}finally{s.close()}
});
test('same HMAC nonce cannot replay across restarted D1 client',async()=>{
  const s=store();try{await offline(async()=>{
    const at=Date.now(),nonce=crypto.randomUUID();
    const req=()=>signed(s.env,'push','/v1/plan',{requestId},{nonce,at});
    assert.equal((await worker.fetch(await req(),s.env)).status,200);
    s.env.QA_BATCH_STAGE_DB=s.open();
    await denied(await worker.fetch(await req(),s.env));
    assert.equal(s.raw().prepare('SELECT COUNT(*) AS n FROM qa_bcast_jobs').get().n,1);
    assert.equal(s.raw().prepare('SELECT COUNT(*) AS n FROM qa_bcast_nonces').get().n,1);
  })}finally{s.close()}
});
test('simulated uncertain token halts and independently reconciled recovery survives restart',async()=>{
  const s=store();try{await offline(async()=>{
    assert.equal((await call(s.env,'push','/v1/plan',{requestId})).status,200);
    const a=await call(s.env,'push','/v1/process',{requestId,mode:'qa-ambiguous-at-2'});
    assert.deepEqual(await a.json(),{
      status:'qa_batch_ambiguous_pending_review',attempted:2,productionReady:false
    });
    assert.deepEqual(delivery(s).slice(0,3).map(x=>x.state),['acked','ambiguous','queued']);
    s.env.QA_BATCH_STAGE_DB=s.open();
    assert.equal((await (await call(s.env,'push','/v1/process',{
      requestId,mode:'qa-accept'})).json()).status,'qa_batch_not_admitted');
    await denied(await call(s.env,'push','/v1/reconcile',{
      requestId,recipientUid:uid(2),fixtureEvidence:'qa-reviewed-synthetic-effect'
    }));
    await denied(await call(s.env,'reconciler','/v1/release',{
      requestId,fixtureEvidence:'qa-reviewed-lease'
    }));
    assert.equal((await call(s.env,'reconciler','/v1/reconcile',{
      requestId,recipientUid:uid(2),fixtureEvidence:'qa-reviewed-synthetic-effect'
    })).status,200);
    assert.equal((await call(s.env,'reconciler','/v1/release',{
      requestId,fixtureEvidence:'qa-reviewed-lease'
    })).status,200);
    const b=await call(s.env,'push','/v1/process',{requestId,mode:'qa-accept'});
    assert.equal((await b.json()).attempted,3);
    assert.equal(delivery(s).filter(x=>x.state==='acked').length,4);
  })}finally{s.close()}
});
test('freeze races with claims: no simulated send while recipient draining',async()=>{
  const s=store();try{await offline(async()=>{
    await call(s.env,'push','/v1/plan',{requestId});
    assert.equal((await call(s.env,'admin','/v1/drain',{uid:uid(1)})).status,200);
    const batch=await call(s.env,'push','/v1/process',{
      requestId,mode:'qa-accept'
    });
    assert.equal((await batch.json()).status,'qa_batch_frozen_or_denied');
    assert.equal(delivery(s)[0].state,'queued');
    await denied(await call(s.env,'admin','/v1/finalize',{uid:uid(1)}));
    assert.equal((await call(s.env,'reconciler','/v1/reconcile',{
      requestId,recipientUid:uid(1),fixtureEvidence:'qa-reviewed-never-started'
    })).status,200);
    assert.equal((await call(s.env,'admin','/v1/finalize',{uid:uid(1)})).status,200);
  })}finally{s.close()}
});
test('missing env ID, D1 or HMAC fails closed with no database or network side effects',async()=>{
  const s=store();try{await offline(async()=>{
    for(const mutation of [
      env=>{env.ATRIO_QA_BATCH_STAGE_ID='atrio-catolico';},
      env=>{env.QA_BATCH_STAGE_DB=null;},
      env=>{env.QA_BATCH_PUSH_HMAC='too-short';},
      env=>{env.QA_BATCH_MODE='production';}
    ]){
      const other={...s.env};mutation(other);
      await denied(await worker.fetch(await signed(other,'push','/v1/plan',{requestId}),other));
    }
    assert.equal(s.raw().prepare('SELECT COUNT(*) AS n FROM qa_bcast_nonces').get().n,0);
  })}finally{s.close()}
});

test('read-only Cloudflare account inventory requires a genuinely separate QA account',()=>{
  const productionId='a'.repeat(32),qaId='b'.repeat(32);
  const oneAccount=assessQaCloudflareIsolation({
    qaAccountId:productionId,operationalAccountIds:[productionId],
    workersByAccount:{[productionId]:['atrio-push','atrio-privacy-freeze-qa-internal']},
    d1ByAccount:{[productionId]:['atrio-push-delivery','atrio-privacy-freeze-stage-fixtures']}
  });
  assert.equal(oneAccount.distinctAccountEvidenced,false);
  assert.ok(oneAccount.blockers.includes('qa_account_must_be_separate'));
  assert.ok(oneAccount.blockers.includes('operational_workers_in_qa_account'));
  assert.equal(oneAccount.provisioningAuthorized,false);
  assert.equal(oneAccount.deployAuthorized,false);
  const unknown=assessQaCloudflareIsolation({
    qaAccountId:qaId,operationalAccountIds:[productionId]
  });
  assert.equal(unknown.distinctAccountEvidenced,false);
  assert.ok(unknown.blockers.includes('qa_d1_inventory_missing'));
  const cleanFixture=assessQaCloudflareIsolation({
    qaAccountId:qaId,operationalAccountIds:[productionId],
    workersByAccount:{[qaId]:[]},d1ByAccount:{[qaId]:[]}
  });
  assert.equal(cleanFixture.distinctAccountEvidenced,true);
  assert.equal(cleanFixture.provisioningAuthorized,false);
  assert.equal(cleanFixture.deployAuthorized,false);
  const collisions=assessQaCloudflareIsolation({
    qaAccountId:qaId,operationalAccountIds:[productionId],
    workersByAccount:{[qaId]:['atrio-qa-broadcast-cloud-internal']},
    d1ByAccount:{[qaId]:['atrio-qa-broadcast-fixture-only']}
  });
  assert.equal(collisions.distinctAccountEvidenced,false);
  assert.ok(collisions.blockers.includes('target_worker_must_not_exist'));
  assert.ok(collisions.blockers.includes('target_qa_d1_must_not_exist'));
});

test('reconciler cannot release a processing lease between individual claims',async()=>{
  const s=store();try{await offline(async()=>{
    assert.equal((await call(s.env,'push','/v1/plan',{requestId})).status,200);
    // Simulate a worker in a live lease between two D1 claims: no inflight row.
    const changed=s.raw().prepare(
      "UPDATE qa_bcast_jobs SET state='processing' WHERE request_id=?"
    ).run(requestId);
    assert.equal(changed.changes,1);
    await denied(await call(s.env,'reconciler','/v1/release',{
      requestId,fixtureEvidence:'qa-reviewed-lease'
    }));
    assert.equal((await call(s.env,'push','/v1/process',{
      requestId,mode:'qa-accept'
    })).status,200);
    assert.equal(s.raw().prepare(
      'SELECT state FROM qa_bcast_jobs WHERE request_id=?'
    ).get(requestId).state,'processing');
    assert.equal(delivery(s).filter(d=>d.state==='queued').length,8);
    // Without proof of owner death/epoch fencing, this job stays unavailable.
  })}finally{s.close()}
});
