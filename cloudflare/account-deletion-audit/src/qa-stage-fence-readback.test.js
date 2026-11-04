/**
 * Executes the private Worker fetch handler, HMAC client and actual SQLite
 * D1-equivalent CAS statements. No global fetch, deployed Worker or user data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import stage from '../../privacy-freeze-stage/src/index.js';
import {createStageServiceClient} from '../../privacy-freeze-stage/src/client.js';
import {createQaStageFreezeReadback}
  from '../../privacy-freeze-stage/src/qa-fence-readback.js';
import {STAGE_ID} from '../../privacy-freeze-stage/src/protocol.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const CASE='fa00bbaa-4a09-4fd2-b399-001122334455';
const ctx={uid:A,caseId:CASE,epoch:1};
const roles=['avatar','guardian','push','admin','reconciler'];
const secret=role=>'qa-only-fence-readback-key-'+role+'-0000000000';
function fixture(){
  const sql=new DatabaseSync(':memory:');
  for(const migration of ['0001_fixture_only.sql','0002_qa_deletion_cases.sql'])
    sql.exec(readFileSync(new URL('../../privacy-freeze-stage/migrations/'+
      migration,import.meta.url),'utf8'));
  const db={prepare(query){return {bind(...args){return{
    async first(){return sql.prepare(query).get(...args)||null;},
    async all(){return {results:sql.prepare(query).all(...args)};},
    async run(){
      const result=sql.prepare(query).run(...args);
      return {success:true,meta:{changes:result.changes}};
    }
  };}};}};
  const env={STAGE_FREEZE_DB:db,ATRIO_PRIVACY_STAGE_ID:STAGE_ID};
  for(const role of roles)
    env['STAGE_'+role.toUpperCase()+'_HMAC']=secret(role);
  const binding={fetch:r=>stage.fetch(r,env)};
  const client=role=>createStageServiceClient({binding,role,secret:secret(role)});
  return {sql,client,close:()=>sql.close()};
}
const stageDenied=p=>assert.rejects(p,/qa_stage_client_denied/);
test('private stage case-bound readback verifies frozen with zero in-flight effects',async()=>{
  const f=fixture();
  try{
    const admin=f.client('admin'),guardian=f.client('guardian'),
      reconcile=f.client('reconciler');
    const old=await guardian.request('admit',{ownerUid:A});
    await admin.request('drain',{uid:A});
    await stageDenied(admin.request('finalize',{uid:A}));
    await reconcile.request('close',{
      operationId:old.operationId,fixtureEvidence:'demo-confirmed'
    });
    await admin.request('finalize',{uid:A});
    const opened=await admin.request('caseOpen',{uid:A,caseId:CASE});
    assert.equal(opened.uid,A);
    assert.equal(opened.caseId,CASE);
    const probe=createQaStageFreezeReadback({
      projectId:STAGE_ID,client:admin,uid:A,caseId:CASE
    });
    assert.equal(await probe.verify(ctx),true);
    assert.equal(await probe.drained(ctx),true);
    assert.equal(probe.productionReady,false);
    assert.equal(probe.destructiveOperationsAllowed,false);
    // Neighbor is independent; no cross-account freeze through a shared UID.
    const safe=await guardian.request('admit',{ownerUid:B});
    assert.equal(safe.status,'stage_admitted');
    // Corruption/late operation injection must not yield "zero pending".
    f.sql.prepare('INSERT INTO qa_privileged_operations VALUES (?,?,?)')
      .run(crypto.randomUUID(),A,'avatar_upload');
    await assert.rejects(probe.drained(ctx),
      /qa_stage_fence_readback_denied:coordinator_unavailable_or_unverified/);
    assert.equal(f.sql.prepare(
      'SELECT COUNT(*) AS n FROM qa_privileged_operations WHERE uid=?'
    ).get(A).n,1);
  }finally{f.close();}
});
test('case mismatch, epoch rollover and hostile identity never read private state',async()=>{
  let calls=0;
  const client={async request(){calls++;throw Error('should_not_read')}};
  assert.throws(()=>createQaStageFreezeReadback({
    projectId:'atrio-catolico',client,uid:A,caseId:CASE}),/invalid_fixture/);
  assert.throws(()=>createQaStageFreezeReadback({
    projectId:STAGE_ID,client,uid:'real-uid',caseId:CASE}),/invalid_fixture/);
  const probe=createQaStageFreezeReadback({
    projectId:STAGE_ID,client,uid:A,caseId:CASE
  });
  for(const invalid of [{...ctx,uid:B},{...ctx,epoch:2},
    {...ctx,caseId:crypto.randomUUID()},{uid:A,caseId:CASE,epoch:1,role:'admin'}])
    await assert.rejects(probe.verify(invalid),/case_or_epoch_mismatch/);
  assert.equal(calls,0);
});
test('mismatched case/status reply is denied without treating it as an empty drain',async()=>{
  const fake={async request(op){
    if(op==='status')
      return {status:'stage_status',uid:A,state:'frozen',inFlight:0};
    return {status:'stage_case_status',uid:B,caseId:CASE,
      generation:1,caseState:'qa_fixture_pending',
      productionReady:false,accountDeleted:false};
  }};
  const probe=createQaStageFreezeReadback({
    projectId:STAGE_ID,client:fake,uid:A,caseId:CASE
  });
  await assert.rejects(probe.drained(ctx),/inconsistent_case_or_drain/);
});
test('unknown coordinator readback cannot turn a timeout into zero in-flight',async()=>{
  const fake={async request(){throw Error('network-unavailable')}};
  const probe=createQaStageFreezeReadback({
    projectId:STAGE_ID,client:fake,uid:A,caseId:CASE
  });
  await assert.rejects(probe.drained(ctx),/coordinator_unavailable_or_unverified/);
});
