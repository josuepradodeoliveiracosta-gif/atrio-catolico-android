import test from 'node:test';
import assert from 'node:assert/strict';
import {afterEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import avatarWorker from '../../avatar-worker/src/index.js';
import {createQaPrivilegedWriteBarrier}
  from './qa-privileged-write-barrier.js';
import {createQaAvatarRouteGate,QA_AVATAR_ROUTE_MAP}
  from './qa-avatar-route-gate.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const TOKENS=new Map([['A'.repeat(120),A],['B'.repeat(120),B]]);
const URI='https://example.invalid';
const sql=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
const avatarSchema=readFileSync(new URL('../../avatar-worker/schema.sql',import.meta.url),'utf8');
const savedFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=savedFetch;});

function setup({verifyEffect=async()=>true}={}){
  const db=new DatabaseSync(':memory:');
  db.exec(sql);
  db.exec(avatarSchema);
  const adapter={
    prepare(query){return {
      bind(...params){return {
        async first(){return db.prepare(query).get(...params)||null;},
        async all(){return {results:db.prepare(query).all(...params)};},
        async run(){const result=db.prepare(query).run(...params);
          return {meta:{changes:result.changes}};}
      };}
    };}
  };
  const env={
    CLOUDINARY_CLOUD_NAME:'qa-cloud',
    CLOUDINARY_API_KEY:'fake-key',
    CLOUDINARY_API_SECRET:'fake-secret',
    FIREBASE_WEB_API_KEY:'qa-fake-web-key',
    FIREBASE_SERVICE_ACCOUNT_JSON:'{}',
    AVATAR_DB:adapter
  };
  const barrier=createQaPrivilegedWriteBarrier(adapter);
  const verifyUid=async request=>{
    const auth=request.headers.get('Authorization')||'';
    return auth.startsWith('Bearer ')?TOKENS.get(auth.slice(7)):null;
  };
  const gate=createQaAvatarRouteGate({worker:avatarWorker,barrier,verifyUid,verifyEffect});
  const calls={auth:0,cloud:0,cloudIds:[]};
  function mockNetwork({cloudStatus=200,cloudPending=true,cloudDelay=null}={}){
    globalThis.fetch=async(url,init={})=>{
      const u=new URL(url);
      if(u.hostname==='identitytoolkit.googleapis.com'){
        calls.auth++;
        assert.equal(init.method,'POST');
        const token=JSON.parse(init.body).idToken;
        const uid=TOKENS.get(token);
        return new Response(JSON.stringify(uid?{users:[{localId:uid,disabled:false}]}:{}),
          {status:uid?200:401});
      }
      if(u.hostname==='api.cloudinary.com'){
        calls.cloud++;
        assert.equal(init.method,'POST');
        assert.equal(u.pathname,'/v1_1/qa-cloud/image/authenticated');
        const id=init.body.get('public_id');
        assert.ok(id.startsWith('atrio-avatares/'));
        calls.cloudIds.push(id);
        if(cloudDelay)await cloudDelay();
        return new Response(JSON.stringify(cloudStatus===200?{
          type:'authenticated',public_id:id,
          moderation:[{kind:'manual',status:cloudPending?'pending':'approved'}]
        }:{error:{message:'service temporarily unavailable'}}),
        {status:cloudStatus});
      }
      throw Error('qa_network_not_mocked');
    };
  }
  function req(path,uid=A,{method='POST',body,headers={}}={}){
    const token=[...TOKENS].find(([,value])=>value===uid)?.[0]||'invalid-token';
    return new Request(URI+path,{method,
      headers:{Authorization:'Bearer '+token,...headers},
      ...(body!==undefined?{body}:{}),
      ...(body instanceof Uint8Array?{duplex:'half'}:{})
    });
  }
  return {db,barrier,gate,env,calls,mockNetwork,req,
    pending:uid=>db.prepare('SELECT public_id FROM avatar_pending WHERE uid=?').get(uid)};
}
const jpeg=()=>{
  const x=new Uint8Array(400).fill(0);
  x[0]=0xff;x[1]=0xd8;x[398]=0xff;x[399]=0xd9;
  return x;
};
const moder={uid:A,revision:'123e4567-e89b-42d3-a456-426614174000',
  action:'approved',reason:'aprovado para QA'};
function paths(){
  return [
    ['/avatar/upload',A,{method:'POST',body:jpeg(),
      headers:{'Content-Type':'image/jpeg'}}],
    ['/avatar/status',A,{method:'POST'}],
    ['/avatar',A,{method:'DELETE'}],
    ['/avatar/moderate',B,{method:'POST',
      body:JSON.stringify({uid:A,reason:'revisão de QA'})}],
    ['/avatar/moderation/review',B,{method:'POST',
      body:JSON.stringify(moder)}]
  ];
}

test('all five actual avatar mutation routes deny BEFORE worker I/O when frozen',async()=>{
  const t=setup();try{
    t.mockNetwork();
    await t.barrier.beginFreeze(A);await t.barrier.finalizeFreeze(A);
    for(const [path,uid,opt] of paths()){
      const response=await t.gate.fetch(t.req(path,uid,opt),t.env);
      assert.equal(response.status,423,path);
    }
    assert.equal(t.calls.auth,0);
    assert.equal(t.calls.cloud,0);
    assert.equal(t.pending(A),undefined);
    assert.deepEqual(await t.barrier.status(A),{state:'frozen',inFlight:0});
  }finally{t.db.close();}
});

test('active status request uses existing Worker and safely releases checked gate',async()=>{
  let checked=0;
  const t=setup({verifyEffect:async({kind,response})=>{
    checked++;assert.equal(kind,'avatar_promote');assert.equal(response.status,200);
    return true;
  }});
  try{
    t.mockNetwork();
    const response=await t.gate.fetch(t.req('/avatar/status',A),t.env);
    assert.equal(response.status,200);
    assert.equal((await response.json()).status,'no_pending');
    assert.equal(checked,1);
    assert.equal(t.calls.auth,1);
    assert.equal(t.calls.cloud,0);
    assert.equal((await t.barrier.status(A)).inFlight,0);
    assert.equal(await t.barrier.beginFreeze(A),'draining');
    assert.equal(await t.barrier.finalizeFreeze(A),'frozen');
  }finally{t.db.close();}
});

test('real avatar upload enters gate, validates Cloudinary and stores QA pending D1',async()=>{
  let checked=0;
  const t=setup({verifyEffect:async({kind,scope,response})=>{
    checked++;
    assert.equal(kind,'avatar_upload');
    assert.deepEqual(scope,{ownerUid:A});
    assert.equal(response.status,202);
    assert.ok(t.pending(A)?.public_id.startsWith('atrio-avatares/'+A+'/'));
    return t.calls.cloud===1;
  }});
  try{
    t.mockNetwork();
    const result=await t.gate.fetch(t.req('/avatar/upload',A,{method:'POST',
      body:jpeg(),headers:{'Content-Type':'image/jpeg'}}),t.env);
    assert.equal(result.status,202);
    assert.equal(checked,1);
    assert.equal(t.calls.cloud,1);
    assert.equal(t.calls.auth,1);
    assert.deepEqual(await t.barrier.status(A),{state:'active',inFlight:0});
    await t.barrier.beginFreeze(A);await t.barrier.finalizeFreeze(A);
    const denied=await t.gate.fetch(t.req('/avatar/status',A),t.env);
    assert.equal(denied.status,423);
    assert.equal(t.calls.auth,1);
  }finally{t.db.close();}
});

test('unconfirmed Cloudinary success leaves ticket open and prevents frozen state',async()=>{
  const t=setup({verifyEffect:async()=>false});try{
    t.mockNetwork();
    const response=await t.gate.fetch(t.req('/avatar/upload',A,{method:'POST',
      body:jpeg(),headers:{'Content-Type':'image/jpeg'}}),t.env);
    assert.equal(response.status,503);
    assert.equal(t.calls.cloud,1);
    assert.deepEqual(await t.barrier.status(A),{state:'active',inFlight:1});
    await t.barrier.beginFreeze(A);
    await assert.rejects(t.barrier.finalizeFreeze(A),/qa_inflight_or_not_draining/);
  }finally{t.db.close();}
});

test('Cloudinary outage after admission does not release ticket automatically',async()=>{
  const t=setup();try{
    t.mockNetwork({cloudStatus:503});
    const response=await t.gate.fetch(t.req('/avatar/upload',A,{method:'POST',
      body:jpeg(),headers:{'Content-Type':'image/jpeg'}}),t.env);
    assert.equal(response.status,502);
    assert.equal((await t.barrier.status(A)).inFlight,1);
    await t.barrier.beginFreeze(A);
    await assert.rejects(t.barrier.finalizeFreeze(A),/qa_inflight_or_not_draining/);
  }finally{t.db.close();}
});

test('in-flight original Worker upload drains before freeze can finalize',async()=>{
  const t=setup();try{
    let allow;
    const delayed=new Promise(resolve=>{allow=resolve;});
    let reached;
    const entered=new Promise(resolve=>{reached=resolve;});
    t.mockNetwork({cloudDelay:async()=>{reached();await delayed;}});
    const pending=t.gate.fetch(t.req('/avatar/upload',A,{method:'POST',
      body:jpeg(),headers:{'Content-Type':'image/jpeg'}}),t.env);
    await entered;
    await t.barrier.beginFreeze(A);
    await assert.rejects(t.barrier.finalizeFreeze(A),/qa_inflight_or_not_draining/);
    allow();
    const response=await pending;
    assert.equal(response.status,202);
    assert.equal((await t.barrier.status(A)).inFlight,0);
    assert.equal(await t.barrier.finalizeFreeze(A),'frozen');
  }finally{t.db.close();}
});

test('moderation owner identity must match one of two QA fixtures; body bounded',async()=>{
  const t=setup();try{
    t.mockNetwork();
    const invalid=await t.gate.fetch(t.req('/avatar/moderate',B,{
      method:'POST',body:JSON.stringify({uid:'production_user',reason:'teste'})
    }),t.env);
    assert.equal(invalid.status,400);
    const giant=await t.gate.fetch(t.req('/avatar/moderation/review',B,{
      method:'POST',body:JSON.stringify({uid:A,reason:'x'.repeat(600)})
    }),t.env);
    assert.equal(giant.status,413);
    assert.equal(t.calls.auth,0);
    assert.equal(t.calls.cloud,0);
    assert.equal((await t.barrier.status(A)).inFlight,0);
  }finally{t.db.close();}
});

test('unknown methods/paths and unauthenticated requests fail without side effects',async()=>{
  const t=setup();try{
    t.mockNetwork();
    for(const [path,method] of [['/avatar/unreviewed','POST'],
      ['/avatar/upload','DELETE'],['/avatar','POST']]){
      const response=await t.gate.fetch(t.req(path,A,{method}),t.env);
      assert.equal(response.status,503);
    }
    const req=t.req('/avatar/status',A);
    req.headers.set('Authorization','Bearer not-verified');
    assert.equal((await t.gate.fetch(req,t.env)).status,401);
    assert.equal(t.calls.auth,0);
  }finally{t.db.close();}
});

test('QA route manifest matches every route currently accepted by actual Worker',()=>{
  const source=readFileSync(new URL('../../avatar-worker/src/index.js',import.meta.url),'utf8');
  const match=source.match(/if\(!\[([\s\S]*?)\]\.includes\(pathname\)\)/);
  assert.ok(match,'Worker route allowlist must be explicitly reviewed');
  const paths=[...match[1].matchAll(/'(\/avatar[^']*)'/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(paths)].sort(),
    [...new Set(Object.keys(QA_AVATAR_ROUTE_MAP).map(k=>k.split(' ')[1]))].sort());
  assert.equal(Object.keys(QA_AVATAR_ROUTE_MAP).length,7);
});

test('read-only paths are excluded from mutation tickets, even when Worker errors',async()=>{
  const t=setup();try{
    t.mockNetwork();
    const r=await t.gate.fetch(t.req('/avatar/moderation/pending',A,{method:'GET'}),t.env);
    // Fake service account cannot get moderator token; the original Worker
    // must fail closed, and no write ticket is created by the QA gateway.
    assert.equal(r.status,503);
    assert.equal((await t.barrier.status(A)).inFlight,0);
  }finally{t.db.close();}
});
