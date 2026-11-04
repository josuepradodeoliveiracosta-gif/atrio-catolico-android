/**
 * Isolated integration: actual Worker fetch(), HMAC signatures, Service
 * Binding clients and persistent SQLite statements matching D1 syntax.
 * No production endpoints, network, Firebase, Cloudinary or real FCM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import stage from '../../privacy-freeze-stage/src/index.js';
import {createStageServiceClient}
  from '../../privacy-freeze-stage/src/client.js';
import {QA_DELETION_PHASES}
  from '../../privacy-freeze-stage/src/deletion-case-ledger.js';
import {stageSignature,STAGE_HOST,STAGE_ID}
  from '../../privacy-freeze-stage/src/protocol.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const CASE='fa00bbaa-4a09-4fd2-b399-001122334455';
const OTHER='fa00bbaa-4a09-4fd2-b399-001122334466';
const roles=['avatar','guardian','push','admin','reconciler'];
const secrets=Object.fromEntries(roles.map(role=>
  [role,'fixture-only-deletion-'+role+'-secret-00000000000']));
const schema1=readFileSync(new URL(
  '../../privacy-freeze-stage/migrations/0001_fixture_only.sql',import.meta.url),'utf8');
const schema2=readFileSync(new URL(
  '../../privacy-freeze-stage/migrations/0002_qa_deletion_cases.sql',import.meta.url),'utf8');
function fixture({migrated=true}={}){
  const dir=mkdtempSync(join(tmpdir(),'atrio-stage-case-'));
  const filename=join(dir,'qa-only.sqlite'),connections=[];
  function reconnect(){
    const sql=new DatabaseSync(filename);connections.push(sql);
    sql.exec('PRAGMA busy_timeout=1000');
    return {raw:sql,prepare(query){return {bind(...values){return {
      async first(){return sql.prepare(query).get(...values)||null;},
      async all(){return {results:sql.prepare(query).all(...values)};},
      async run(){
        const row=sql.prepare(query).run(...values);
        return {success:true,meta:{changes:row.changes}};
      }
    };}};}};
  }
  const first=reconnect();
  first.raw.exec(schema1);
  if(migrated)first.raw.exec(schema2);
  const env={ATRIO_PRIVACY_STAGE_ID:STAGE_ID,STAGE_FREEZE_DB:first};
  for(const role of roles)
    env['STAGE_'+role.toUpperCase()+'_HMAC']=secrets[role];
  const binding={fetch:req=>stage.fetch(req,env)};
  const client=role=>createStageServiceClient({
    binding,role,secret:secrets[role]
  });
  const inspect=()=>env.STAGE_FREEZE_DB.raw;
  const close=()=>{
    for(const db of connections)try{db.close();}catch{}
    rmSync(dir,{recursive:true,force:true});
  };
  return {env,binding,client,reconnect:()=>{env.STAGE_FREEZE_DB=reconnect();},
    inspect,close};
}
const evidence='qa-synthetic-only-reviewed';
const input=(uid=A,caseId=CASE)=>({uid,caseId});
const witness=(phase,uid=A,caseId=CASE)=>({
  uid,caseId,phase,fixtureEvidence:evidence
});
const advance=(step,uid=A,caseId=CASE)=>({
  uid,caseId,expectedStep:step,fixtureEvidence:evidence
});
const denied=promise=>assert.rejects(promise,/qa_stage_client_denied/);
const expectedRole=['guardian','avatar','push',
  'reconciler','reconciler','reconciler'];

test('three Worker clients, drained operations, ordered case, persisted after restart',async()=>{
  const f=fixture();
  try{
    const avatar=f.client('avatar'),guardian=f.client('guardian'),
      push=f.client('push'),admin=f.client('admin'),review=f.client('reconciler');
    const va=await avatar.request('admit',{ownerUid:A});
    const gu=await guardian.request('admit',{ownerUid:A});
    const fc=await push.request('admit',{actorUid:B,recipientUid:A});
    assert.equal(va.status,'stage_admitted');
    assert.equal(gu.status,'stage_admitted');
    assert.equal(fc.status,'stage_admitted');
    await denied(admin.request('caseOpen',input()));
    await admin.request('drain',{uid:A});
    await denied(avatar.request('admit',{ownerUid:A}));
    await denied(guardian.request('admit',{ownerUid:A}));
    await denied(push.request('admit',{actorUid:B,recipientUid:A}));
    await denied(admin.request('finalize',{uid:A}));
    for(const operationId of [va.operationId,gu.operationId,fc.operationId])
      await review.request('close',{
        operationId,fixtureEvidence:'demo-confirmed'
      });
    await admin.request('finalize',{uid:A});
    const opened=await admin.request('caseOpen',input());
    assert.equal(opened.status,'stage_case_open');
    assert.equal(opened.completedPhases,0);
    assert.equal(opened.productionReady,false);
    const again=await admin.request('caseOpen',input());
    assert.equal(again.completedPhases,0);
    await denied(admin.request('caseOpen',input(A,OTHER)));
    for(let step=0;step<QA_DELETION_PHASES.length;step++){
      const phase=QA_DELETION_PHASES[step],role=expectedRole[step];
      await denied(review.request('caseAdvance',advance(step)));
      const response=await f.client(role).request('caseAttest',witness(phase));
      assert.equal(response.status,'stage_case_attested');
      const changed=await review.request('caseAdvance',advance(step));
      assert.equal(changed.completedPhases,step+1);
      assert.equal(changed.accountDeleted,false);
      assert.equal(changed.providerEffectsVerified,false);
      await denied(review.request('caseAdvance',advance(step)));
      if(step===2)f.reconnect(); // backed by the same durable file
    }
    const final=await admin.request('caseStatus',input());
    assert.equal(final.status,'stage_case_status');
    assert.equal(final.completedPhases,6);
    assert.equal(final.nextPhase,null);
    assert.equal(final.accountDeleted,false);
    assert.equal(final.productionReady,false);
    assert.equal((await admin.request('status',{uid:B})).state,'active');
    assert.equal((await f.client('guardian').request('admit',{ownerUid:B})).status,
      'stage_admitted');
  }finally{f.close()}
});

test('stage role separation rejects fabricated evidence, cross-role attestation, skips and foreign UIDs',async()=>{
  const f=fixture();
  try{
    const admin=f.client('admin'),review=f.client('reconciler'),
      avatar=f.client('avatar'),guardian=f.client('guardian');
    await admin.request('drain',{uid:A});
    await admin.request('finalize',{uid:A});
    await admin.request('caseOpen',input());
    for(const payload of [
      witness('firestore_reconciled','real-user',CASE),
      witness('firestore_reconciled',A,OTHER),
      {...witness('firestore_reconciled'),fixtureEvidence:'real-deletion-confirmed'},
      {...witness('firestore_reconciled'),otherUid:B}
    ])await denied(guardian.request('caseAttest',payload));
    await denied(avatar.request('caseAttest',witness('firestore_reconciled')));
    await denied(admin.request('caseAttest',witness('firestore_reconciled')));
    await denied(guardian.request('caseAdvance',advance(0)));
    await denied(review.request('caseAdvance',advance(1)));
    await denied(guardian.request('caseAttest',witness('avatar_d1_reconciled')));
    await guardian.request('caseAttest',witness('firestore_reconciled'));
    await denied(guardian.request('caseAttest',witness('firestore_reconciled')));
    await review.request('caseAdvance',advance(0));
    assert.equal((await admin.request('caseStatus',input())).completedPhases,1);
    await denied(review.request('caseAdvance',advance(0)));
  }finally{f.close()}
});

test('atomic CAS: concurrent reviewers cannot double advance one phase',async()=>{
  const f=fixture();
  try{
    const admin=f.client('admin'),guardian=f.client('guardian'),
      review=f.client('reconciler');
    await admin.request('drain',{uid:A});
    await admin.request('finalize',{uid:A});
    await admin.request('caseOpen',input());
    await guardian.request('caseAttest',witness('firestore_reconciled'));
    const answers=await Promise.allSettled([
      review.request('caseAdvance',advance(0)),
      review.request('caseAdvance',advance(0))
    ]);
    assert.equal(answers.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(answers.filter(x=>x.status==='rejected').length,1);
    assert.equal((await admin.request('caseStatus',input())).completedPhases,1);
  }finally{f.close()}
});

test('signed HMAC tampering cannot bypass role or reuse nonce',async()=>{
  const f=fixture();
  try{
    const path='/v1/case/open',body=JSON.stringify(input()),
      nonce=crypto.randomUUID(),timestamp=Date.now();
    const signature=await stageSignature(secrets.admin,{
      role:'admin',timestamp,nonce,path,body
    });
    const headers={
      'x-atrio-role':'admin','x-atrio-time':String(timestamp),
      'x-atrio-nonce':nonce,'x-atrio-signature':signature
    };
    const wrong=new Request(STAGE_HOST+path,{
      method:'POST',body,headers:{...headers,'x-atrio-role':'avatar'}
    });
    assert.equal((await f.binding.fetch(wrong)).status,403);
    const foreign=new Request(STAGE_HOST+path,{
      method:'POST',body:JSON.stringify(input('a-real-user')),headers
    });
    assert.equal((await f.binding.fetch(foreign)).status,403);
    const replay=new Request(STAGE_HOST+path,{method:'POST',body,headers});
    const deniedResponse=await f.binding.fetch(replay);
    assert.equal(deniedResponse.status,403); // account has not frozen
    assert.equal(f.inspect().prepare('SELECT COUNT(*) AS n FROM qa_deletion_cases').get().n,0);
  }finally{f.close()}
});

test('missing stage-only migration fails closed without touching identity or provider',async()=>{
  const f=fixture({migrated:false});
  try{
    const admin=f.client('admin');
    await admin.request('drain',{uid:A});
    await admin.request('finalize',{uid:A});
    await denied(admin.request('caseOpen',input()));
    assert.equal((await admin.request('status',{uid:A})).state,'frozen');
  }finally{f.close()}
});

test('reconciler cannot self-freeze, owner cannot advance and no network is contacted',async()=>{
  const f=fixture();
  const realFetch=globalThis.fetch;
  let hit=0;
  globalThis.fetch=async()=>{hit++;throw Error('real_network_forbidden');};
  try{
    await denied(f.client('reconciler').request('drain',{uid:A}));
    await denied(f.client('avatar').request('caseOpen',input()));
    await denied(f.client('push').request('caseAdvance',advance(0)));
    assert.equal(hit,0);
  }finally{globalThis.fetch=realFetch;f.close();}
});
