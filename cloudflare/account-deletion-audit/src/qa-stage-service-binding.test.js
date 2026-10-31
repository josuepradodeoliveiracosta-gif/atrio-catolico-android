import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import stage,{STAGE_READINESS} from '../../privacy-freeze-stage/src/index.js';
import {createStageServiceClient,STAGE_BINDING_READINESS}
  from '../../privacy-freeze-stage/src/client.js';
import {stageSignature,STAGE_HOST,STAGE_ID}
  from '../../privacy-freeze-stage/src/protocol.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const roles=['avatar','guardian','push','admin','reconciler'];
const names={
  avatar:'STAGE_AVATAR_HMAC',guardian:'STAGE_GUARDIAN_HMAC',
  push:'STAGE_PUSH_HMAC',admin:'STAGE_ADMIN_HMAC',
  reconciler:'STAGE_RECONCILER_HMAC'
};
const key=role=>'fixture-only-staging-secret-'+role+'-000000000000000';
const schema=readFileSync(new URL('../../privacy-freeze-stage/migrations/0001_fixture_only.sql',
  import.meta.url),'utf8');
function setup(){
  const folder=mkdtempSync(join(tmpdir(),'atrio-stage-d1-'));
  const filename=join(folder,'coordinator.sqlite');
  const dbs=[];
  const opened=()=>{
    const sqlite=new DatabaseSync(filename);
    dbs.push(sqlite);
    return {prepare(sql){return {bind(...values){return {
      async first(){return sqlite.prepare(sql).get(...values)||null;},
      async all(){return {results:sqlite.prepare(sql).all(...values)};},
      async run(){
        const meta=sqlite.prepare(sql).run(...values);
        return {success:true,meta:{changes:meta.changes}};
      }
    };}};},raw:sqlite};
  };
  const first=opened();
  first.raw.exec(schema);
  const stageEnv={ATRIO_PRIVACY_STAGE_ID:STAGE_ID,STAGE_FREEZE_DB:first};
  for(const role of roles)stageEnv[names[role]]=key(role);
  const binding={fetch:request=>stage.fetch(request,stageEnv)};
  const client=role=>createStageServiceClient({binding,role,secret:key(role)});
  const resetDb=()=>{
    const reopened=opened();
    stageEnv.STAGE_FREEZE_DB=reopened;
    return reopened;
  };
  const pending=()=>stageEnv.STAGE_FREEZE_DB.prepare(
    'SELECT operation_id,uid,kind FROM qa_privileged_operations ORDER BY uid'
  ).all().then(r=>r.results);
  const nonces=()=>stageEnv.STAGE_FREEZE_DB.prepare(
    'SELECT nonce FROM qa_stage_nonces'
  ).all().then(r=>r.results.length);
  const close=()=>{
    for(const conn of dbs)try{conn.raw.close()}catch{}
    rmSync(folder,{recursive:true,force:true});
  };
  return {stageEnv,binding,client,resetDb,pending,nonces,close};
}
const offline=async fn=>{
  const old=globalThis.fetch;
  let n=0;globalThis.fetch=async()=>{n++;throw Error('qa_real_network_forbidden')};
  try{const value=await fn();assert.equal(n,0);return value}
  finally{globalThis.fetch=old}
};
const expectDenied=p=>assert.rejects(p,/qa_stage_client_denied/);
test('service bindings admit three roles, admin drains and independent verifier reconciles',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const av=await f.client('avatar').request('admit',{ownerUid:A});
    const gu=await f.client('guardian').request('admit',{ownerUid:B});
    const pu=await f.client('push').request('admit',{actorUid:A,recipientUid:B});
    assert.equal(av.status,'stage_admitted');
    assert.equal(gu.status,'stage_admitted');
    assert.equal(pu.status,'stage_admitted');
    assert.equal((await f.pending()).length,4);
    assert.deepEqual((await f.client('admin').request('status',{uid:A})).state,'active');
    assert.equal((await f.client('admin').request('drain',{uid:A})).status,'stage_draining');
    await expectDenied(f.client('push').request('admit',{actorUid:A,recipientUid:B}));
    await expectDenied(f.client('admin').request('finalize',{uid:A}));
    const closer=f.client('reconciler');
    await closer.request('close',{operationId:av.operationId,fixtureEvidence:'demo-confirmed'});
    await closer.request('close',{operationId:pu.operationId,fixtureEvidence:'demo-confirmed'});
    assert.equal((await f.client('admin').request('finalize',{uid:A})).status,'stage_frozen');
    assert.equal((await f.client('admin').request('status',{uid:B})).inFlight,1);
    await closer.request('close',{operationId:gu.operationId,fixtureEvidence:'demo-confirmed'});
    assert.equal((await f.client('admin').request('status',{uid:B})).inFlight,0);
  })}finally{f.close()}
});
test('replay with same signed nonce is rejected atomically at D1',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const nonce=crypto.randomUUID();
    const fixed=createStageServiceClient({
      binding:f.binding,role:'avatar',secret:key('avatar'),createNonce:()=>nonce
    });
    assert.equal((await fixed.request('admit',{ownerUid:A})).status,'stage_admitted');
    await expectDenied(fixed.request('admit',{ownerUid:A}));
    assert.equal((await f.pending()).length,1);
    assert.equal(await f.nonces(),1);
  })}finally{f.close()}
});
test('HMAC tampering, impersonation, timestamp expiration and foreign host are denied',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const body=JSON.stringify({ownerUid:A}),nonce=crypto.randomUUID(),ts=Date.now();
    const signature=await stageSignature(key('avatar'),{
      role:'avatar',timestamp:ts,nonce,path:'/v1/admit',body
    });
    const headers={
      'x-atrio-role':'avatar','x-atrio-time':String(ts),
      'x-atrio-nonce':nonce,'x-atrio-signature':signature
    };
    const req=(url,b=body,h=headers)=>new Request(url,{
      method:'POST',headers:h,body:b
    });
    for(const [url,b,h] of [
      [STAGE_HOST+'/v1/admit',JSON.stringify({ownerUid:B}),headers],
      [STAGE_HOST+'/v1/admit',body,{...headers,'x-atrio-role':'admin'}],
      ['https://cloudflare.example/v1/admit',body,headers],
      [STAGE_HOST+'/v1/admit',body,{...headers,'x-atrio-time':String(ts-120000)}],
      [STAGE_HOST+'/v1/admit?redirect=1',body,headers]
    ]){
      assert.equal((await f.binding.fetch(req(url,b,h))).status,403);
    }
    assert.equal((await f.pending()).length,0);
    assert.equal(await f.nonces(),0);
  })}finally{f.close()}
});
test('wrong identities, topics, roles and unauthorized reconciliation cannot touch D1',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const av=f.client('avatar'),admin=f.client('admin');
    for(const [op,payload] of [
      ['admit',{ownerUid:'real-account'}],
      ['admit',{ownerUid:A,external:true}],
      ['admit',{actorUid:A,recipientUid:B}],
      ['close',{operationId:crypto.randomUUID(),fixtureEvidence:'demo-confirmed'}],
      ['admit',{ownerUid:A,topic:'broadcast'}]
    ])await expectDenied(av.request(op,payload));
    await expectDenied(admin.request('admit',{ownerUid:A}));
    await expectDenied(f.client('push').request('admit',{actorUid:A,recipientUid:'real-user'}));
    await expectDenied(f.client('reconciler').request('close',{
      operationId:crypto.randomUUID(),fixtureEvidence:'not-confirmed'
    }));
    assert.equal(await f.nonces(),0);
    assert.equal((await f.pending()).length,0);
  })}finally{f.close()}
});
test('unfinished operation persists between two SQLite D1 connections/restarts',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const admitted=await f.client('push').request('admit',{actorUid:A,recipientUid:B});
    const more=f.resetDb();
    assert.ok(more);
    assert.equal((await f.pending()).length,2);
    await f.client('admin').request('drain',{uid:B});
    await expectDenied(f.client('admin').request('finalize',{uid:B}));
    await expectDenied(f.client('guardian').request('admit',{ownerUid:B}));
    // No fake evidence is automatically assumed after an interrupted Worker.
    assert.equal((await f.client('admin').request('status',{uid:B})).inFlight,1);
    await f.client('reconciler').request('close',{
      operationId:admitted.operationId,fixtureEvidence:'demo-confirmed'
    });
    assert.equal((await f.client('admin').request('finalize',{uid:B})).status,'stage_frozen');
  })}finally{f.close()}
});
test('reconciler cannot close an invented ticket, and only confirms once',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const token=await f.client('avatar').request('admit',{ownerUid:A});
    await expectDenied(f.client('reconciler').request('close',{
      operationId:crypto.randomUUID(),fixtureEvidence:'demo-confirmed'
    }));
    await f.client('reconciler').request('close',{
      operationId:token.operationId,fixtureEvidence:'demo-confirmed'
    });
    await expectDenied(f.client('reconciler').request('close',{
      operationId:token.operationId,fixtureEvidence:'demo-confirmed'
    }));
    assert.equal((await f.pending()).length,0);
  })}finally{f.close()}
});
test('service is fail-closed with missing D1, demo ID or secret',async()=>{
  const f=setup();
  try{
    const client=f.client('avatar');
    delete f.stageEnv.STAGE_FREEZE_DB;
    await expectDenied(client.request('admit',{ownerUid:A}));
    f.stageEnv.STAGE_FREEZE_DB=f.resetDb();
    f.stageEnv.ATRIO_PRIVACY_STAGE_ID='atrio-catolico';
    await expectDenied(client.request('admit',{ownerUid:A}));
    f.stageEnv.ATRIO_PRIVACY_STAGE_ID=STAGE_ID;
    delete f.stageEnv.STAGE_AVATAR_HMAC;
    await expectDenied(client.request('admit',{ownerUid:A}));
  }finally{f.close()}
});
test('staging module makes no production-readiness, public access or deletion claim',()=>{
  assert.equal(STAGE_READINESS.productionIntegrated,false);
  assert.equal(STAGE_READINESS.publicAccessAllowed,false);
  assert.equal(STAGE_READINESS.userUidsAllowed,false);
  assert.equal(STAGE_BINDING_READINESS.IAMFullyVerified,false);
});
