import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import stage from '../../privacy-freeze-stage/src/index.js';
import {STAGE_HOST,stageSignature} from '../../privacy-freeze-stage/src/protocol.js';
import {createStageServiceClient} from '../../privacy-freeze-stage/src/client.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const S='demo-atrio-v11';
const key=x=>'only-for-isolated-qa-'+x+'-secret-0123456789';
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL(
    '../../privacy-freeze-stage/migrations/0001_fixture_only.sql',import.meta.url),'utf8'));
  const db={prepare(query){return {bind(...args){return{
    async all(){return {results:sql.prepare(query).all(...args)};},
    async first(){return sql.prepare(query).get(...args)||null;},
    async run(){const out=sql.prepare(query).run(...args);return {success:true,meta:{changes:out.changes}};}
  };}};}};
  const env={ATRIO_PRIVACY_STAGE_ID:S,STAGE_FREEZE_DB:db,
    STAGE_AVATAR_HMAC:key('avatar'),STAGE_GUARDIAN_HMAC:key('guardian'),
    STAGE_PUSH_HMAC:key('push'),STAGE_ADMIN_HMAC:key('admin'),
    STAGE_RECONCILER_HMAC:key('reconciler')};
  const binding={fetch:req=>stage.fetch(req,env)};
  const client=role=>createStageServiceClient({binding,role,secret:key(role)});
  const pending=()=>sql.prepare('SELECT COUNT(*) AS count FROM qa_privileged_operations').get().count;
  const nonces=()=>sql.prepare('SELECT COUNT(*) AS count FROM qa_stage_nonces').get().count;
  return {env,binding,client,pending,nonces,close:()=>sql.close()};
}
async function signed(role,nonce,body,path='/v1/admit',secret=key(role)){
  const timestamp=Date.now(),raw=JSON.stringify(body);
  const signature=await stageSignature(secret,{role,timestamp,nonce,path,body:raw});
  return new Request(STAGE_HOST+path,{method:'POST',body:raw,headers:{
    'x-atrio-role':role,'x-atrio-time':String(timestamp),
    'x-atrio-nonce':nonce,'x-atrio-signature':signature
  }});
}
test('two simultaneous signed requests with one nonce admit exactly once',async()=>{
  const t=fixture();
  try{
    const nonce=crypto.randomUUID(),body={ownerUid:A};
    const [x,y]=await Promise.all([
      t.binding.fetch(await signed('avatar',nonce,body)),
      t.binding.fetch(await signed('avatar',nonce,body))
    ]);
    assert.deepEqual([x.status,y.status].sort(),[200,403]);
    assert.equal(t.pending(),1);
    assert.equal(t.nonces(),1);
  }finally{t.close()}
});
test('a nonce cannot be reused by another trusted role with a valid HMAC',async()=>{
  const t=fixture();
  try{
    const nonce=crypto.randomUUID();
    const first=await t.binding.fetch(await signed('avatar',nonce,{ownerUid:A}));
    assert.equal(first.status,200);
    const crossRole=await t.binding.fetch(await signed('guardian',nonce,{ownerUid:B}));
    assert.equal(crossRole.status,403);
    assert.equal(t.pending(),1);
    assert.equal(t.nonces(),1);
  }finally{t.close()}
});
test('rotated role HMAC rejects old signature without a D1 nonce write',async()=>{
  const t=fixture();
  try{
    const previous=t.env.STAGE_AVATAR_HMAC;
    t.env.STAGE_AVATAR_HMAC='rotated-private-staging-secret-alice-1234567';
    const nonce=crypto.randomUUID();
    assert.equal((await t.binding.fetch(await signed('avatar',nonce,{ownerUid:A},'/v1/admit',previous))).status,403);
    assert.equal(t.pending(),0);
    assert.equal(t.nonces(),0);
    const active=await t.binding.fetch(await signed('avatar',nonce,{ownerUid:A},'/v1/admit',t.env.STAGE_AVATAR_HMAC));
    assert.equal(active.status,200);
    assert.equal(t.pending(),1);
  }finally{t.close()}
});
test('uncertain D1 nonce persistence fails closed and never grants an admission',async()=>{
  const t=fixture();
  try{
    const original=t.env.STAGE_FREEZE_DB;
    let attempts=0;
    t.env.STAGE_FREEZE_DB={prepare(query){
      if(query.includes('qa_stage_nonces')){
        return {bind(){return {async run(){
          attempts++;return {success:false,meta:{changes:1}};
        }};}};
      }
      return original.prepare(query);
    }};
    const resp=await t.binding.fetch(await signed('push',crypto.randomUUID(),{
      actorUid:A,recipientUid:B
    }));
    assert.equal(resp.status,403);
    assert.equal(attempts,1);
    assert.equal(t.pending(),0);
  }finally{t.close()}
});
test('admin is forbidden to self-reconcile an unresolved operation',async()=>{
  const t=fixture();
  try{
    const ticket=await t.client('avatar').request('admit',{ownerUid:A});
    await t.client('admin').request('drain',{uid:A});
    await assert.rejects(t.client('admin').request('close',{
      operationId:ticket.operationId,fixtureEvidence:'demo-confirmed'
    }),/qa_stage_client_denied/);
    await assert.rejects(t.client('admin').request('finalize',{uid:A}),
      /qa_stage_client_denied/);
    assert.equal(t.pending(),1);
  }finally{t.close()}
});
