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
import {collectQaBroadcastInventory,runQaBroadcast,QA_BROADCAST_READINESS}
  from './qa-broadcast-inventory.js';
import {QA_STAGE_WRITE_ROUTES,QA_STAGE_WRITE_COVERAGE,qaStageWriteGrant}
  from '../../privacy-freeze-stage/src/write-route-grants.js';
import {QA_MUTATION_ROUTES,qaCoverageSummary}
  from './qa-worker-coverage-contract.js';
import {runQaTicketedFixtureEffect,reconcileQaTicketedFixtureEffect,
  QA_FIXTURE_EFFECT_READINESS}
  from '../../privacy-freeze-stage/src/qa-ticketed-fixture-effect.js';

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
  const pending=()=>Promise.resolve(stageEnv.STAGE_FREEZE_DB.raw.prepare(
    'SELECT operation_id,uid,kind FROM qa_privileged_operations ORDER BY uid'
  ).all());
  const nonces=()=>Promise.resolve(stageEnv.STAGE_FREEZE_DB.raw.prepare(
    'SELECT nonce FROM qa_stage_nonces'
  ).all().length);
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

test('signed but unauthorized operation cannot consume nonce or mutate fixture ledger',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const body=JSON.stringify({ownerUid:'qa-freeze-alice'});
    const timestamp=Date.now();
    const nonce=crypto.randomUUID();
    const role='avatar',path='/v1/finalize';
    const signature=await stageSignature(key(role),{
      role,timestamp,nonce,path,body
    });
    const response=await f.binding.fetch(new Request(STAGE_HOST+path,{
      method:'POST',
      headers:{
        'x-atrio-role':role,'x-atrio-time':String(timestamp),
        'x-atrio-nonce':nonce,'x-atrio-signature':signature
      },
      body
    }));
    assert.equal(response.status,403);
    assert.equal(await f.nonces(),0);
    assert.equal((await f.pending()).length,0);
  })}finally{f.close()}
});
test('service rejects duplicated roles secrets before any D1 operation',async()=>{
  const f=setup();
  try{await offline(async()=>{
    f.stageEnv.STAGE_GUARDIAN_HMAC=f.stageEnv.STAGE_AVATAR_HMAC;
    await expectDenied(f.client('avatar').request('admit',{ownerUid:A}));
    assert.equal(await f.nonces(),0);
    assert.equal((await f.pending()).length,0);
  })}finally{f.close()}
});
test('signed bogus real UID cannot consume D1 nonce',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const timestamp=Date.now(),nonce=crypto.randomUUID();
    const body=JSON.stringify({ownerUid:'real-customer-id'});
    const signature=await stageSignature(key('avatar'),{
      role:'avatar',timestamp,nonce,path:'/v1/admit',body
    });
    const response=await f.binding.fetch(new Request(STAGE_HOST+'/v1/admit',{
      method:'POST',
      headers:{
        'x-atrio-role':'avatar','x-atrio-time':String(timestamp),
        'x-atrio-nonce':nonce,'x-atrio-signature':signature
      },
      body
    }));
    assert.equal(response.status,403);
    assert.equal(await f.nonces(),0);
    assert.equal((await f.pending()).length,0);
  })}finally{f.close()}
});

test('internal broadcast binding serializes admit, drain and reconciliation',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const push=f.client('push'),admin=f.client('admin');
    const ticket=await push.request('admit',{actorUid:A,recipientUids:[B]});
    assert.equal(ticket.status,'stage_admitted');
    assert.equal((await f.pending()).length,2);
    f.resetDb();
    await admin.request('drain',{uid:B});
    await expectDenied(push.request('admit',{actorUid:A,recipientUids:[B]}));
    await expectDenied(admin.request('finalize',{uid:B}));
    await f.client('reconciler').request('close',{
      operationId:ticket.operationId,fixtureEvidence:'demo-confirmed'});
    assert.equal((await admin.request('finalize',{uid:B})).status,'stage_frozen');
    await expectDenied(push.request('admit',{actorUid:A,recipientUids:[B]}));
    assert.equal((await f.pending()).length,0);
  })}finally{f.close()}
});
test('internal broadcast binding rejects real, repeated and incomplete cohorts',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const push=f.client('push');
    for(const recipients of [[],[A],[B,B],['real-user'],[B,'real-user']])
      await expectDenied(push.request('admit',{actorUid:A,recipientUids:recipients}));
    await expectDenied(push.request('admit',{actorUid:'real-user',recipientUids:[B]}));
    assert.equal((await f.pending()).length,0);
    assert.equal(await f.nonces(),0);
  })}finally{f.close()}
});

const qaRows={
  first:{revision:'qa-revision-a1',pageIndex:0,expectedTotal:2,
    rows:[{uid:A,optedIn:false,token:null}],
    nextCursor:'qa-cursor-page2',complete:false},
  second:{revision:'qa-revision-a1',pageIndex:1,expectedTotal:2,
    rows:[{uid:B,optedIn:true,token:'qa-fcm-fixture-bob'}],
    nextCursor:null,complete:true}
};
const qaPages=(first=qaRows.first,second=qaRows.second)=>
  async cursor=>{
    if(cursor===null)return structuredClone(first);
    if(cursor==='qa-cursor-page2')return structuredClone(second);
    throw Error('unexpected_qa_page_cursor');
  };

test('two-page complete inventory admits HMAC/D1 and sends one fixture token only',async()=>{
  const f=setup(),sent=[],cursors=[];
  try{await offline(async()=>{
    const outcome=await runQaBroadcast({
      actorUid:A,requestId:'qa-broadcast-fixture-001',
      readPage:async cursor=>{cursors.push(cursor);return qaPages()(cursor);},
      pushClient:f.client('push'),
      sendFixture:async payload=>{
        sent.push(payload);return {status:'qa_simulated_accepted'};
      }
    });
    assert.deepEqual(cursors,[null,'qa-cursor-page2']);
    assert.equal(outcome.status,'qa_fake_send_pending_reconciliation');
    assert.equal(outcome.productionReady,false);
    assert.deepEqual(sent,[{kind:'qa_broadcast',requestId:'qa-broadcast-fixture-001',
      recipientUid:B,fakeToken:'qa-fcm-fixture-bob'}]);
    assert.equal((await f.pending()).length,2);
    assert.deepEqual((await f.client('admin').request('status',{uid:B})),
      {status:'stage_status',uid:B,state:'active',inFlight:1});
    await f.client('admin').request('drain',{uid:B});
    await expectDenied(f.client('admin').request('finalize',{uid:B}));
    // Independent fixture reconciler, never the sender, closes the ticket.
    await f.client('reconciler').request('close',{
      operationId:outcome.operationId,fixtureEvidence:'demo-confirmed'
    });
    assert.equal((await f.client('admin').request('finalize',{uid:B})).status,
      'stage_frozen');
    assert.equal((await f.pending()).length,0);
    assert.equal(QA_BROADCAST_READINESS.realFcmEnabled,false);
  })}finally{f.close()}
});

test('missing, duplicate, reordered or mixed-revision pages never admit or send',async()=>{
  const bad=[
    [{...qaRows.first,expectedTotal:1},qaRows.second],
    [qaRows.first,{...qaRows.second,expectedTotal:1}],
    [qaRows.first,{...qaRows.second,revision:'qa-revision-b2'}],
    [qaRows.first,{...qaRows.second,rows:[qaRows.first.rows[0]]}],
    [{...qaRows.first,pageIndex:1},qaRows.second],
    [qaRows.first,{...qaRows.second,complete:false,
      nextCursor:'qa-cursor-page2'}],
    [qaRows.first,{...qaRows.second,rows:[{uid:'real-user',
      optedIn:true,token:'qa-fcm-fixture-real'}]}],
    [qaRows.first,{...qaRows.second,rows:[{uid:B,optedIn:true,
      token:'real-production-token'}]}]
  ];
  let permits=0,sends=0;
  for(const [first,second] of bad){
    await assert.rejects(runQaBroadcast({
      actorUid:A,requestId:'qa-broadcast-fixture-002',
      readPage:qaPages(first,second),
      pushClient:{request:async()=>{permits++;throw Error('permit_called');}},
      sendFixture:async()=>{sends++;throw Error('send_called');}
    }),/qa_broadcast_inventory_unverified/);
  }
  assert.equal(permits,0);
  assert.equal(sends,0);
});

test('subscriber opt-out means no admission, D1 change or FCM fixture effect',async()=>{
  const f=setup();
  let sends=0;
  try{await offline(async()=>{
    const second={...qaRows.second,
      rows:[{uid:B,optedIn:false,token:null}]};
    const outcome=await runQaBroadcast({
      actorUid:A,requestId:'qa-broadcast-fixture-003',
      readPage:qaPages(qaRows.first,second),
      pushClient:f.client('push'),
      sendFixture:async()=>{sends++;throw Error('must not send');}
    });
    assert.equal(outcome.status,'qa_no_opted_in_recipients');
    assert.equal(sends,0);
    assert.equal((await f.pending()).length,0);
    assert.equal(await f.nonces(),0);
  })}finally{f.close()}
});

test('frozen recipient blocks admission before any individual fake send',async()=>{
  const f=setup();
  let sends=0;
  try{await offline(async()=>{
    await f.client('admin').request('drain',{uid:B});
    await expectDenied(runQaBroadcast({
      actorUid:A,requestId:'qa-broadcast-fixture-004',
      readPage:qaPages(),
      pushClient:f.client('push'),
      sendFixture:async()=>{sends++;return {status:'qa_simulated_accepted'};}
    }));
    assert.equal(sends,0);
    assert.equal((await f.pending()).length,0);
  })}finally{f.close()}
});

test('uncertain fake FCM effect retains both tickets; never automatically retries',async()=>{
  const f=setup();
  let attempted=0;
  try{await offline(async()=>{
    const outcome=await runQaBroadcast({
      actorUid:A,requestId:'qa-broadcast-fixture-005',
      readPage:qaPages(),
      pushClient:f.client('push'),
      sendFixture:async()=>{attempted++;throw Error('synthetic_timeout');}
    });
    assert.equal(outcome.status,'qa_ambiguous_effect_pending_reconciliation');
    assert.equal(attempted,1);
    assert.equal((await f.pending()).length,2);
    await f.client('admin').request('drain',{uid:A});
    await expectDenied(f.client('admin').request('finalize',{uid:A}));
    assert.equal((await f.client('admin').request('status',{uid:A})).inFlight,1);
    // Independent evidence is required; never close on the sender's assertion.
    await expectDenied(f.client('push').request('close',{
      operationId:outcome.operationId,fixtureEvidence:'demo-confirmed'
    }));
    assert.equal((await f.pending()).length,2);
  })}finally{f.close()}
});

test('QA-only inventory cannot accept a real actor or unsafe request identifiers',async()=>{
  let calls=0;
  for(const [actorUid,requestId] of [['real-user','qa-broadcast-fixture'],
    [A,'production-123']]){
    await assert.rejects(runQaBroadcast({actorUid,requestId,
      readPage:async()=>{calls++;throw Error('must_not_read');},
      pushClient:{request:async()=>{throw Error('must_not_admit');}},
      sendFixture:async()=>{throw Error('must_not_send');}
    }),/qa_broadcast_invalid_request/);
  }
  assert.equal(calls,0);
  await assert.rejects(collectQaBroadcastInventory({actorUid:A,
    readPage:async()=>({...qaRows.first,rows:[{uid:A,optedIn:true,
      token:'production-fcm-token'}]})}),/qa_broadcast_inventory_unverified/);
});


const qaWritePayload=(route,owner='qa-freeze-alice',peer='qa-freeze-bob')=>{
  const grant=QA_STAGE_WRITE_ROUTES[route];
  if(!grant)throw Error('qa_unreviewed_write_route');
  const scope={};
  for(const field of grant.keys.split(',')){
    if(field==='ownerUid')scope[field]=owner;
    else if(field==='actorUid')scope[field]=grant.keys.includes('ownerUid')?peer:owner;
    else if(field==='recipientUid')scope[field]=peer;
    else if(field==='recipientUids')scope[field]=[peer];
  }
  return {route,scope};
};
test('15 candidate privileged write entrypoints have scoped QA-only grants',()=>{
  const routes=Object.keys(QA_STAGE_WRITE_ROUTES);
  assert.equal(routes.length,15);
  assert.equal(routes.length,QA_MUTATION_ROUTES.length);
  for(const role of ['avatar','guardian','push'])
    assert.equal(routes.filter(route=>QA_STAGE_WRITE_ROUTES[route].role===role).length,
      QA_MUTATION_ROUTES.filter(x=>x.service===role).length);
  const counts=arr=>arr.reduce((a,x)=>(a[x.kind]=(a[x.kind]||0)+1,a),{});
  assert.deepEqual(counts(Object.values(QA_STAGE_WRITE_ROUTES)),counts(QA_MUTATION_ROUTES));
  assert.equal(QA_STAGE_WRITE_COVERAGE.knownCandidateRoutes,15);
  assert.equal(QA_STAGE_WRITE_COVERAGE.productionIntegrated,false);
  assert.equal(QA_STAGE_WRITE_COVERAGE.allLiveWritePathsFenced,false);
  assert.equal(QA_STAGE_WRITE_COVERAGE.externalEffectApproval,false);
  assert.equal(qaCoverageSummary().unprotectedWriteEntries,15);
});
test('HMAC Service Binding admits each of 15 QA routes; independent verifier closes D1 tickets',async()=>{
  const f=setup();
  try{await offline(async()=>{
    for(const [route,grant] of Object.entries(QA_STAGE_WRITE_ROUTES)){
      const response=await f.client(grant.role).request('writeAdmit',qaWritePayload(route));
      assert.equal(response.status,'stage_admitted',route);
      const records=(await f.pending()).filter(x=>x.operation_id===response.operationId);
      const expectedAccounts=grant.keys.includes('actorUid')?2:1;
      assert.equal(records.length,expectedAccounts,route);
      assert.ok(records.every(x=>x.kind===grant.kind),route);
      await f.client('reconciler').request('close',{
        operationId:response.operationId,fixtureEvidence:'demo-confirmed'
      });
      assert.equal((await f.pending()).length,0);
    }
    assert.equal(await f.nonces(),30);
  })}finally{f.close()}
});
test('QA write grants never permit cross-role operations, extra fields or real accounts',async()=>{
  const f=setup();
  try{await offline(async()=>{
    for(const [route,grant] of Object.entries(QA_STAGE_WRITE_ROUTES)){
      for(const role of ['avatar','guardian','push'].filter(r=>r!==grant.role))
        await expectDenied(f.client(role).request('writeAdmit',qaWritePayload(route)));
      const payload=qaWritePayload(route);
      payload.scope[Object.keys(payload.scope)[0]]='real-user-id';
      await expectDenied(f.client(grant.role).request('writeAdmit',payload));
    }
    for(const input of [
      {route:'avatar.unknown',scope:{ownerUid:'qa-freeze-alice'}},
      {route:'avatar.upload',scope:{ownerUid:'qa-freeze-alice'},admin:true},
      {route:'avatar.upload',scope:{ownerUid:'qa-freeze-alice',admin:true}},
      {route:'push.broadcast.fcm',scope:{actorUid:'qa-freeze-alice',
        recipientUids:['qa-freeze-bob','qa-freeze-bob']}},
      {route:'push.event.fcm',scope:{actorUid:'qa-freeze-alice',
        recipientUid:'qa-freeze-alice'}}
    ])assert.equal(qaStageWriteGrant(QA_STAGE_WRITE_ROUTES[input.route]?.role||'avatar',input),null);
    assert.equal((await f.pending()).length,0);
    assert.equal(await f.nonces(),0);
  })}finally{f.close()}
});
test('signed role escalation is rejected on Worker before nonce is written',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const body=JSON.stringify(qaWritePayload('avatar.upload'));
    const timestamp=Date.now(),nonce=crypto.randomUUID(),role='push',path='/v1/write/admit';
    const signature=await stageSignature(key(role),{role,timestamp,nonce,path,body});
    const response=await f.binding.fetch(new Request(STAGE_HOST+path,{
      method:'POST',body,headers:{
        'x-atrio-role':role,'x-atrio-time':String(timestamp),
        'x-atrio-nonce':nonce,'x-atrio-signature':signature
      }
    }));
    assert.equal(response.status,403);
    assert.equal(await f.nonces(),0);
    assert.equal((await f.pending()).length,0);
  })}finally{f.close()}
});
test('drain blocks all 15 operations and in-flight ticket prevents premature freeze',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const first=await f.client('avatar').request('writeAdmit',
      qaWritePayload('avatar.upload'));
    await f.client('admin').request('drain',{uid:'qa-freeze-alice'});
    await expectDenied(f.client('admin').request('finalize',{uid:'qa-freeze-alice'}));
    for(const [route,grant] of Object.entries(QA_STAGE_WRITE_ROUTES))
      await expectDenied(f.client(grant.role).request('writeAdmit',qaWritePayload(route)));
    assert.equal((await f.pending()).length,1);
    await f.client('reconciler').request('close',{
      operationId:first.operationId,fixtureEvidence:'demo-confirmed'
    });
    await f.client('admin').request('finalize',{uid:'qa-freeze-alice'});
    await expectDenied(f.client('avatar').request('writeAdmit',
      qaWritePayload('avatar.upload')));
    const control=await f.client('avatar').request('writeAdmit',
      qaWritePayload('avatar.upload','qa-freeze-bob','qa-freeze-alice'));
    assert.equal(control.status,'stage_admitted');
    await f.client('reconciler').request('close',{
      operationId:control.operationId,fixtureEvidence:'demo-confirmed'
    });
    assert.equal((await f.pending()).length,0);
  })}finally{f.close()}
});
test('concurrent multi-account admission versus freeze can never partially admit',async()=>{
  for(let i=0;i<4;i++){
    const f=setup();
    try{await offline(async()=>{
      const [admission,drain]=await Promise.allSettled([
        f.client('push').request('writeAdmit',qaWritePayload('push.event.fcm')),
        f.client('admin').request('drain',{uid:'qa-freeze-alice'})
      ]);
      assert.equal(drain.status,'fulfilled');
      const records=await f.pending();
      if(admission.status==='fulfilled'){
        assert.equal(records.length,2);
        await expectDenied(f.client('admin').request('finalize',{uid:'qa-freeze-alice'}));
        await f.client('reconciler').request('close',{
          operationId:admission.value.operationId,fixtureEvidence:'demo-confirmed'
        });
      }else assert.equal(records.length,0);
      await f.client('admin').request('finalize',{uid:'qa-freeze-alice'});
      await expectDenied(f.client('push').request('writeAdmit',
        qaWritePayload('push.event.fcm')));
      assert.equal((await f.pending()).length,0);
    })}finally{f.close()}
  }
});
test('new scoped admission refuses replayed HMAC nonce and missing stage secrets',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const nonce=crypto.randomUUID();
    const fixed=createStageServiceClient({
      binding:f.binding,role:'avatar',secret:key('avatar'),createNonce:()=>nonce
    });
    const admitted=await fixed.request('writeAdmit',qaWritePayload('avatar.upload'));
    await expectDenied(fixed.request('writeAdmit',qaWritePayload('avatar.upload')));
    assert.equal((await f.pending()).length,1);
    delete f.stageEnv.STAGE_GUARDIAN_HMAC;
    await expectDenied(f.client('avatar').request('writeAdmit',qaWritePayload('avatar.status')));
    f.stageEnv.STAGE_GUARDIAN_HMAC=key('guardian');
    await f.client('reconciler').request('close',{
      operationId:admitted.operationId,fixtureEvidence:'demo-confirmed'
    });
    assert.equal((await f.pending()).length,0);
  })}finally{f.close()}
});


/**
 * Only a synthetic SQLite table is touched. Each fixture write validates
 * its just-admitted D1 ticket and persists its UUID as an idempotency key.
 */
function qaFixtureEffectStore(f){
  const sqlite=f.stageEnv.STAGE_FREEZE_DB.raw;
  sqlite.exec([
    'CREATE TABLE IF NOT EXISTS qa_fake_provider_effects (',
    '  operation_id TEXT PRIMARY KEY,',
    "  role TEXT NOT NULL CHECK(role IN ('avatar','guardian','push')),",
    '  route TEXT NOT NULL, kind TEXT NOT NULL,',
    '  created_ms INTEGER NOT NULL CHECK(created_ms>0)',
    ')'
  ].join(' '));
  const count=()=>sqlite.prepare(
    'SELECT COUNT(*) AS n FROM qa_fake_provider_effects').get().n;
  const get=operationId=>sqlite.prepare(
    'SELECT operation_id,role,route,kind FROM qa_fake_provider_effects WHERE operation_id=?'
  ).get(operationId)||null;
  return {
    count,get,
    async applyFixture({operationId,role,route,kind}){
      const pending=await f.pending();
      if(!pending.some(x=>x.operation_id===operationId&&x.kind===kind))
        throw Error('qa_unadmitted_fixture_effect');
      sqlite.prepare(
        'INSERT INTO qa_fake_provider_effects(operation_id,role,route,kind,created_ms) '+
        'VALUES (?,?,?,?,?)'
      ).run(operationId,role,route,kind,Date.now());
      return {status:'qa_fixture_applied'};
    }
  };
}
test('Avatar Guardian and Push fixture effects require HMAC admission and independent close',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const store=qaFixtureEffectStore(f);
    for(const [role,route,scope] of [
      ['avatar','avatar.upload',{ownerUid:'qa-freeze-alice'}],
      ['guardian','guardian.scan',{ownerUid:'qa-freeze-bob'}],
      ['push','push.event.fcm',{actorUid:'qa-freeze-alice',
        recipientUid:'qa-freeze-bob'}]
    ]){
      const ticket=await runQaTicketedFixtureEffect({
        client:f.client(role),role,route,scope,fixtureStore:store
      });
      assert.equal(ticket.status,'qa_fixture_effect_pending_reconciliation');
      assert.equal(ticket.productionReady,false);
      assert.equal(ticket.externalProviderEffectVerified,false);
      assert.equal(store.get(ticket.operationId)?.route,route);
      assert.equal((await f.pending()).filter(x=>x.operation_id===ticket.operationId).length,
        role==='push'?2:1);
      const closed=await reconcileQaTicketedFixtureEffect({
        reconciler:f.client('reconciler'),operationId:ticket.operationId,
        independentReadback:async id=>store.get(id)?.route===route &&
          store.get(id)?.role===role
      });
      assert.equal(closed.status,'qa_fixture_ticket_reconciled');
      assert.equal(closed.realProviderDeleted,false);
      assert.equal((await f.pending()).length,0);
    }
    assert.equal(store.count(),3);
    assert.equal(QA_FIXTURE_EFFECT_READINESS.productionIntegrated,false);
    assert.equal(QA_FIXTURE_EFFECT_READINESS.automaticTicketRelease,false);
    assert.equal(QA_FIXTURE_EFFECT_READINESS.autoRetryOnUnknownResult,false);
  })}finally{f.close()}
});
test('draining account denies admission BEFORE any synthetic fixture effect runs',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const store=qaFixtureEffectStore(f);
    await f.client('admin').request('drain',{uid:'qa-freeze-alice'});
    let applied=0;
    await expectDenied(runQaTicketedFixtureEffect({
      client:f.client('avatar'),role:'avatar',route:'avatar.upload',
      scope:{ownerUid:'qa-freeze-alice'},
      fixtureStore:{applyFixture:async()=>{applied++;return {status:'qa_fixture_applied'};}}
    }));
    assert.equal(applied,0);
    assert.equal(store.count(),0);
    assert.equal((await f.pending()).length,0);
    await f.client('admin').request('finalize',{uid:'qa-freeze-alice'});
  })}finally{f.close()}
});
test('late uncertainty after persisted fake write survives restart and blocks freeze',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const store=qaFixtureEffectStore(f);
    await assert.rejects(runQaTicketedFixtureEffect({
      client:f.client('avatar'),role:'avatar',route:'avatar.upload',
      scope:{ownerUid:'qa-freeze-alice'},
      fixtureStore:{applyFixture:async input=>{
        await store.applyFixture(input);
        throw Error('qa_synthetic_timeout_after_commit');
      }}
    }),/qa_synthetic_timeout_after_commit/);
    const before=await f.pending();
    assert.equal(before.length,1);
    const id=before[0].operation_id;
    assert.ok(store.get(id));
    await f.client('admin').request('drain',{uid:'qa-freeze-alice'});
    await expectDenied(f.client('admin').request('finalize',{uid:'qa-freeze-alice'}));
    f.resetDb(); // fresh SQLite connection to the same private fixture D1 file
    assert.equal((await f.pending()).length,1);
    assert.ok(store.get(id)); // persisted effect, not replayed on restart
    assert.equal(store.count(),1);
    await reconcileQaTicketedFixtureEffect({
      reconciler:f.client('reconciler'),operationId:id,
      independentReadback:async x=>store.get(x)?.route==='avatar.upload'
    });
    await f.client('admin').request('finalize',{uid:'qa-freeze-alice'});
    assert.equal((await f.pending()).length,0);
    assert.equal(store.count(),1);
  })}finally{f.close()}
});
test('failed fixture write has a pending ticket but no false successful effect',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const store=qaFixtureEffectStore(f);
    await assert.rejects(runQaTicketedFixtureEffect({
      client:f.client('guardian'),role:'guardian',route:'guardian.scan',
      scope:{ownerUid:'qa-freeze-bob'},
      fixtureStore:{applyFixture:async()=>{throw Error('qa_simulated_write_failed');}}
    }),/qa_simulated_write_failed/);
    assert.equal(store.count(),0);
    assert.equal((await f.pending()).length,1);
    const id=(await f.pending())[0].operation_id;
    await assert.rejects(reconcileQaTicketedFixtureEffect({
      reconciler:f.client('reconciler'),operationId:id,
      independentReadback:async()=>false
    }),/qa_fixture_readback_unverified/);
    await f.client('admin').request('drain',{uid:'qa-freeze-bob'});
    await expectDenied(f.client('admin').request('finalize',{uid:'qa-freeze-bob'}));
    assert.equal((await f.pending()).length,1);
  })}finally{f.close()}
});
test('unverified readback or wrong HMAC role cannot close a synthetic effect ticket',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const store=qaFixtureEffectStore(f);
    const ticket=await runQaTicketedFixtureEffect({
      client:f.client('avatar'),role:'avatar',route:'avatar.delete',
      scope:{ownerUid:'qa-freeze-alice'},fixtureStore:store
    });
    await assert.rejects(reconcileQaTicketedFixtureEffect({
      reconciler:f.client('reconciler'),operationId:ticket.operationId,
      independentReadback:async()=>undefined
    }),/qa_fixture_readback_unverified/);
    await expectDenied(reconcileQaTicketedFixtureEffect({
      reconciler:f.client('avatar'),operationId:ticket.operationId,
      independentReadback:async()=>true
    }));
    assert.equal((await f.pending()).length,1);
    await reconcileQaTicketedFixtureEffect({
      reconciler:f.client('reconciler'),operationId:ticket.operationId,
      independentReadback:async id=>store.get(id)?.kind==='avatar_remove'
    });
    assert.equal((await f.pending()).length,0);
  })}finally{f.close()}
});
test('forged scope and unavailable Service Binding cannot execute fake effects',async()=>{
  const f=setup();
  try{await offline(async()=>{
    let effects=0;
    const fixtureStore={applyFixture:async()=>{
      effects++;return {status:'qa_fixture_applied'};
    }};
    await assert.rejects(runQaTicketedFixtureEffect({
      client:f.client('avatar'),role:'avatar',route:'avatar.upload',
      scope:{ownerUid:'real-customer-uid'},fixtureStore
    }),/qa_fixture_effect_denied/);
    await assert.rejects(runQaTicketedFixtureEffect({
      client:f.client('push'),role:'push',route:'avatar.upload',
      scope:{ownerUid:'qa-freeze-alice'},fixtureStore
    }),/qa_fixture_effect_denied/);
    delete f.stageEnv.STAGE_FREEZE_DB;
    await expectDenied(runQaTicketedFixtureEffect({
      client:f.client('avatar'),role:'avatar',route:'avatar.upload',
      scope:{ownerUid:'qa-freeze-alice'},fixtureStore
    }));
    assert.equal(effects,0);
    f.resetDb(); // inspect persistence through a fresh QA D1 connection
    assert.equal(await f.nonces(),0);
  })}finally{f.close()}
});
test('two-account push ticket prevents premature freeze of the recipient',async()=>{
  const f=setup();
  try{await offline(async()=>{
    const store=qaFixtureEffectStore(f);
    const ticket=await runQaTicketedFixtureEffect({
      client:f.client('push'),role:'push',route:'push.event.fcm',
      scope:{actorUid:'qa-freeze-alice',recipientUid:'qa-freeze-bob'},
      fixtureStore:store
    });
    assert.equal((await f.pending()).length,2);
    await f.client('admin').request('drain',{uid:'qa-freeze-bob'});
    await expectDenied(f.client('admin').request('finalize',{uid:'qa-freeze-bob'}));
    await reconcileQaTicketedFixtureEffect({
      reconciler:f.client('reconciler'),operationId:ticket.operationId,
      independentReadback:async id=>store.get(id)?.role==='push'
    });
    await f.client('admin').request('finalize',{uid:'qa-freeze-bob'});
    assert.equal((await f.pending()).length,0);
    assert.equal((await f.client('admin').request('status',{
      uid:'qa-freeze-alice'})).state,'active');
  })}finally{f.close()}
});

test('private Service Binding client rejects response envelopes for a different operation',async()=>{
  const mock=(role,reply)=>createStageServiceClient({
    binding:{async fetch(){return Response.json(reply);}},
    role,secret:key(role)
  });
  for(const [role,op,payload,reply] of [
    ['admin','drain',{uid:A},{status:'stage_frozen'}],
    ['admin','status',{uid:A},{status:'stage_draining'}],
    ['avatar','admit',{ownerUid:A},
      {status:'stage_status',state:'active',inFlight:0}]
  ]){
    await expectDenied(mock(role,reply).request(op,payload));
  }
});
test('readback must have bounded state and integral in-flight ticket count',async()=>{
  const mock=reply=>createStageServiceClient({
    binding:{async fetch(){return Response.json(reply);}},
    role:'admin',secret:key('admin')
  });
  for(const reply of [
    {status:'stage_status',uid:A,state:'frozen',inFlight:1},
    {status:'stage_status',uid:A,state:'active',inFlight:-1},
    {status:'stage_status',uid:A,state:'active',inFlight:'0'},
    {status:'stage_status',uid:A,state:'unknown',inFlight:0}
  ]){
    await expectDenied(mock(reply).request('status',{uid:A}));
  }
  const safe=await mock({status:'stage_status',uid:A,state:'frozen',inFlight:0})
    .request('status',{uid:A});
  assert.equal(safe.inFlight,0);
});
test('an admission needs a valid UUID ticket even if the stage reports success',async()=>{
  for(const operationId of [undefined,'invalid','a'.repeat(36)]){
    const binding={async fetch(){
      return Response.json({status:'stage_admitted',operationId});
    }};
    const client=createStageServiceClient({
      binding,role:'avatar',secret:key('avatar')
    });
    await expectDenied(client.request('admit',{ownerUid:A}));
  }
});

test('stale or cross-account coordinator status is never accepted as a freeze proof',async()=>{
  const admin=reply=>createStageServiceClient({
    binding:{async fetch(){return Response.json(reply)}},
    role:'admin',secret:key('admin')
  });
  for(const [op,body,reply] of [
    ['status',{uid:A},{status:'stage_status',uid:B,state:'frozen',inFlight:0}],
    ['drain',{uid:A},{status:'stage_draining',uid:B}],
    ['finalize',{uid:A},{status:'stage_frozen',uid:B}]
  ])await expectDenied(admin(reply).request(op,body));
});
test('case HMAC responses must echo the exact UID, case ID and checkpoint',async()=>{
  const C='fa00bbaa-4a09-4fd2-b399-001122334455';
  const D='fa00bbaa-4a09-4fd2-b399-001122334466';
  const response=(reply,role='admin')=>createStageServiceClient({
    binding:{async fetch(){return Response.json(reply)}},
    role,secret:key(role)
  });
  const base={status:'stage_case_status',uid:B,caseId:C,generation:1,
    completedPhases:0,nextPhase:'firestore_reconciled',
    caseState:'qa_fixture_pending',productionReady:false,
    providerEffectsVerified:false,accountDeleted:false};
  for(const reply of [{...base,uid:A},{...base,caseId:D},
    {...base,completedPhases:-1},{...base,accountDeleted:true}])
    await expectDenied(response(reply).request('caseStatus',{uid:B,caseId:C}));
  await expectDenied(response({...base,status:'stage_case_advanced',
    completedPhases:4},'reconciler').request('caseAdvance',
      {uid:B,caseId:C,expectedStep:0,fixtureEvidence:'qa-synthetic-only-reviewed'}));
});
test('independent closure needs the exact same admitted operation ID echoed back',async()=>{
  const id=crypto.randomUUID(),other=crypto.randomUUID();
  const reconciler=reply=>createStageServiceClient({
    binding:{async fetch(){return Response.json(reply)}},
    role:'reconciler',secret:key('reconciler')
  });
  await expectDenied(reconciler({status:'stage_reconciled',operationId:other})
    .request('close',{operationId:id,fixtureEvidence:'demo-confirmed'}));
});
