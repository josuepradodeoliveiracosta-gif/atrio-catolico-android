import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  createQaBatchStageService,createQaBatchStageClient,signQaBatchRequest,
  QA_BATCH_HOST,QA_BATCH_BINDING_READINESS
} from './qa-batch-stage.js';
const schema=readFileSync(new URL('../qa-broadcast-batches-fixture.sql',import.meta.url),'utf8');
const id='qa-broadcast-hmac-001';
const uid=n=>'qa-batch-'+String(n).padStart(2,'0');
const keys={
  push:'fixture-only-stage-push-secret-00000000000000',
  admin:'fixture-only-stage-admin-secret-0000000000000',
  reconciler:'fixture-only-reconciler-secret-0000000000'
};
const rows=Array.from({length:9},(_,i)=>({
  uid:uid(i),optedIn:i!==0,token:i===0?null:'qa-fcm-fixture-'+i
}));
function pageSource(){
  return async cursor=>{
    const n=cursor===null?0:Number(cursor.replace('qa-page-',''));
    if(!Number.isSafeInteger(n)||n<0||n>2)throw Error('invalid_cursor');
    return structuredClone({
      revision:'qa-revision-v1',expectedTotal:9,pageIndex:n,
      rows:rows.slice(n*3,n*3+3),complete:n===2,
      nextCursor:n===2?null:'qa-page-'+(n+1)
    });
  };
}
function setup(sender=async()=>({status:'qa_simulated_accepted'})){
  const folder=mkdtempSync(join(tmpdir(),'qa-batch-binding-'));
  const filename=join(folder,'internal.sqlite');
  const connections=[];
  const open=()=>{
    const db=new DatabaseSync(filename);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');
    connections.push(db);return db;
  };
  const db=open();db.exec(schema);
  let currentDb=db;
  let sends=0;
  const stage=createQaBatchStageService({
    db:currentDb,keys,readPage:pageSource(),
    sendFixture:async payload=>{sends++;return sender(payload);}
  });
  const client=role=>createQaBatchStageClient({
    binding:stage,role,secret:keys[role]
  });
  const close=()=>{for(const d of connections)try{d.close()}catch{}
    rmSync(folder,{recursive:true,force:true});};
  return {db,stage,client,close,open,sends:()=>sends};
}
const noNetwork=async fn=>{
  const before=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('fixture_network_forbidden');};
  try{const result=await fn();assert.equal(calls,0);return result;}
  finally{globalThis.fetch=before;}
};
const denied=promise=>assert.rejects(promise,/qa_batch_binding_denied/);
const inspect=(db,requestId=id)=>db.prepare(
  'SELECT recipient_uid,state FROM qa_bcast_deliveries WHERE request_id=? ORDER BY recipient_uid'
).all(requestId);
test('HMAC signed internal binding plans once, processes 3+3+2 and requires independent reconcile',async()=>{
  const x=setup();try{await noNetwork(async()=>{
    const push=x.client('push'),admin=x.client('admin'),reconciler=x.client('reconciler');
    const plan=await push.request('plan',{actorUid:uid(0),requestId:id});
    assert.equal(plan.queued,8);
    assert.equal((await push.request('plan',{actorUid:uid(0),requestId:id})).status,
      'qa_duplicate_plan');
    for(const wanted of [3,3,2]){
      const batch=await push.request('process',{requestId:id});
      assert.equal(batch.attempted,wanted);
    }
    assert.equal(x.sends(),8);
    assert.ok(inspect(x.db).every(row=>row.state==='acked'));
    assert.equal((await admin.request('status',{uid:uid(4)})).inFlight,1);
    assert.equal((await admin.request('drain',{uid:uid(4)})).status,'qa_draining');
    await denied(admin.request('finalize',{uid:uid(4)}));
    assert.equal((await reconciler.request('reconcile',{
      requestId:id,recipientUid:uid(4),
      fixtureEvidence:'qa-reviewed-synthetic-effect'
    })).status,'qa_independently_reconciled');
    assert.equal((await admin.request('finalize',{uid:uid(4)})).status,'qa_frozen');
    assert.equal((await push.request('process',{requestId:id})).attempted,0);
    assert.equal(x.sends(),8);
    assert.equal(QA_BATCH_BINDING_READINESS.productionIntegrated,false);
    assert.equal(QA_BATCH_BINDING_READINESS.cloudflareDeployed,false);
  })}finally{x.close()}
});
test('client rejects cross-role calls and foreign user identities before nonce allocation',async()=>{
  const x=setup();try{await noNetwork(async()=>{
    const admin=x.client('admin');
    await denied(admin.request('process',{requestId:id}));
    await denied(x.client('push').request('reconcile',{
      requestId:id,recipientUid:uid(1),fixtureEvidence:'qa-reviewed-synthetic-effect'
    }));
    await denied(x.client('push').request('plan',{actorUid:'production-uid',requestId:id}));
    await denied(x.client('reconciler').request('reconcile',{
      requestId:id,recipientUid:'real-uid',fixtureEvidence:'qa-reviewed-synthetic-effect'
    }));
    assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM qa_bcast_nonces').get().n,0);
  })}finally{x.close()}
});
test('signed tampering, role impersonation, expiry and URL changes do not create plans or nonces',async()=>{
  const x=setup();try{await noNetwork(async()=>{
    const timestamp=Date.now(),nonce=crypto.randomUUID();
    const path='/v1/plan',body=JSON.stringify({actorUid:uid(0),requestId:id});
    const mac=await signQaBatchRequest(keys.push,{
      role:'push',time:timestamp,nonce,path,body
    });
    const headers={
      'X-Qa-Batch-Role':'push','X-Qa-Batch-Time':String(timestamp),
      'X-Qa-Batch-Nonce':nonce,'X-Qa-Batch-Mac':mac
    };
    for(const [url,raw,h] of [
      [QA_BATCH_HOST+path,JSON.stringify({actorUid:uid(0),
        requestId:'qa-broadcast-other'}),headers],
      [QA_BATCH_HOST+path,body,{...headers,'X-Qa-Batch-Role':'admin'}],
      [QA_BATCH_HOST+path,body,{...headers,'X-Qa-Batch-Time':String(timestamp-120_000)}],
      [QA_BATCH_HOST+path+'?bypass=true',body,headers],
      ['https://public.example/v1/plan',body,headers]
    ]){
      const response=await x.stage.fetch(new Request(url,{method:'POST',headers:h,body:raw}));
      assert.equal(response.status,403);
    }
    assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM qa_bcast_nonces').get().n,0);
    assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM qa_bcast_jobs').get().n,0);
  })}finally{x.close()}
});
test('HMAC request replay is rejected across separately instantiated stage services',async()=>{
  const x=setup();try{await noNetwork(async()=>{
    const timestamp=Date.now(),nonce=crypto.randomUUID();
    const path='/v1/plan',body=JSON.stringify({actorUid:uid(0),requestId:id});
    const mac=await signQaBatchRequest(keys.push,{
      role:'push',time:timestamp,nonce,path,body
    });
    const make=()=>new Request(QA_BATCH_HOST+path,{method:'POST',body,headers:{
      'X-Qa-Batch-Role':'push','X-Qa-Batch-Time':String(timestamp),
      'X-Qa-Batch-Nonce':nonce,'X-Qa-Batch-Mac':mac}});
    assert.equal((await x.stage.fetch(make())).status,200);
    const other=createQaBatchStageService({
      db:x.open(),keys,readPage:pageSource(),
      sendFixture:async()=>{throw Error('no_duplicate_sender');}
    });
    assert.equal((await other.fetch(make())).status,403);
    assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM qa_bcast_nonces').get().n,1);
    assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM qa_bcast_jobs').get().n,1);
  })}finally{x.close()}
});
test('an ambiguous fake effect remains halted across fresh HMAC service instances',async()=>{
  const x=setup(async()=>{throw Error('synthetic_timeout');});try{await noNetwork(async()=>{
    const push=x.client('push'),admin=x.client('admin');
    await push.request('plan',{actorUid:uid(0),requestId:id});
    const result=await push.request('process',{requestId:id});
    assert.equal(result.status,'qa_batch_ambiguous_pending_review');
    assert.equal(result.attempted,1);
    const fresh=createQaBatchStageService({db:x.open(),keys,readPage:pageSource(),
      sendFixture:async()=>{throw Error('must_not_retry');}});
    const other=createQaBatchStageClient({binding:fresh,role:'push',secret:keys.push});
    assert.equal((await other.request('process',{requestId:id})).status,'qa_batch_not_admitted');
    assert.equal(x.sends(),1);
    assert.equal((await admin.request('drain',{uid:uid(1)})).status,'qa_draining');
    await denied(admin.request('finalize',{uid:uid(1)}));
    await denied(push.request('reconcile',{requestId:id,
      recipientUid:uid(1),fixtureEvidence:'qa-reviewed-synthetic-effect'}));
    assert.equal(inspect(x.db)[0].state,'ambiguous');
    const auditor=x.client('reconciler');
    await auditor.request('reconcile',{requestId:id,
      recipientUid:uid(1),fixtureEvidence:'qa-reviewed-synthetic-effect'});
    assert.equal((await admin.request('finalize',{uid:uid(1)})).status,'qa_frozen');
    assert.equal(x.sends(),1);
  })}finally{x.close()}
});
test('oversized or unknown signed request is rejected without ledger changes',async()=>{
  const x=setup();try{await noNetwork(async()=>{
    const timestamp=Date.now(),nonce=crypto.randomUUID(),path='/v1/plan';
    const raw=JSON.stringify({actorUid:uid(0),requestId:id,
      unexpected:'x'.repeat(300)});
    const mac=await signQaBatchRequest(keys.push,{
      role:'push',time:timestamp,nonce,path,body:raw
    });
    const res=await x.stage.fetch(new Request(QA_BATCH_HOST+path,{method:'POST',
      body:raw,headers:{'X-Qa-Batch-Role':'push',
        'X-Qa-Batch-Time':String(timestamp),'X-Qa-Batch-Nonce':nonce,
        'X-Qa-Batch-Mac':mac}}));
    assert.equal(res.status,403);
    assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM qa_bcast_nonces').get().n,0);
  })}finally{x.close()}
});
