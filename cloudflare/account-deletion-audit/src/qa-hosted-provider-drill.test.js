import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import stage from '../../privacy-freeze-stage/src/index.js';
import {runQaHostedProviderDrill}
  from '../../privacy-freeze-stage/src/qa-hosted-provider-drill.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const CASE='fa00bbaa-4a09-4fd2-b399-001122334455';
const RUN='qa-hosted-provider-20261103-a';
const TIME=Date.parse('2026-11-03T21:33:00Z');
const kinds=['avatar_d1_pointer','cloudinary_qa_pointer',
  'push_registration_pointer'];
const roles=['avatar','guardian','push','admin','reconciler'];
function fixture({canaries=true}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of ['0001_fixture_only.sql','0002_qa_deletion_cases.sql',
    '0003_qa_hosted_canary.sql','0004_qa_provider_refs.sql',
    '0005_qa_provider_drill_once.sql'])
    sqlite.exec(readFileSync(new URL(
      '../../privacy-freeze-stage/migrations/'+file,import.meta.url),'utf8'));
  for(const uid of [A,B])
    for(const kind of kinds)
      sqlite.prepare('INSERT INTO qa_provider_fixture_refs VALUES (?,?,?)')
        .run(uid,kind,'qa-fixture-'+kind.replaceAll('_','-')+'-'+uid);
  if(canaries)
    for(const [role,uid] of [['avatar',A],['guardian',B],['push',A]])
      sqlite.prepare('INSERT INTO qa_stage_hosted_canaries VALUES (?,?,?,?,?)')
        .run(role,'qa-hosted-20261103-a',uid,'completed',TIME-90000);
  const raw={
    prepare(query){return {bind(...values){return{
      async first(){return sqlite.prepare(query).get(...values)||null;},
      async all(){return {results:sqlite.prepare(query).all(...values)};},
      run(){
        if(/^\s*DELETE/i.test(query)){
          const rows=sqlite.prepare(query).all(...values);
          return Promise.resolve({success:true,results:rows,meta:{changes:rows.length}});
        }
        const result=sqlite.prepare(query).run(...values);
        return Promise.resolve({success:true,results:[],meta:{changes:result.changes}});
      },
      batchRun(){
        if(/^\s*DELETE/i.test(query)){
          const rows=sqlite.prepare(query).all(...values);
          return {success:true,results:rows,meta:{changes:rows.length}};
        }
        const result=sqlite.prepare(query).run(...values);
        return {success:true,results:[],meta:{changes:result.changes}};
      }
    };}};},
    async batch(statements){
      sqlite.exec('BEGIN IMMEDIATE');
      try{
        const result=statements.map(x=>x.batchRun());
        sqlite.exec('COMMIT');
        return result;
      }catch(e){sqlite.exec('ROLLBACK');throw e;}
    }
  };
  // A BOUND D1 database mock with real SQLite transactional semantics.
  const env={STAGE_FREEZE_DB:raw,ATRIO_PRIVACY_STAGE_ID:'demo-atrio-v11'};
  for(const role of roles)
    env['STAGE_'+role.toUpperCase()+'_HMAC']=
      'fixed-qa-test-'+role+'-very-long-unique-secret-20261103';
  const one=(sql,...vals)=>sqlite.prepare(sql).get(...vals);
  const count=(table,uid=A)=>one(
    'SELECT COUNT(*) AS n FROM '+table+' WHERE uid=?',uid).n;
  const tick=(options={})=>stage.scheduled({
    cron:'* * * * *',scheduledTime:TIME,...options
  },env);
  return {sqlite,raw,env,count,one,tick,close:()=>sqlite.close()};
}
const emptyCheck=f=>{
  assert.equal(f.one("SELECT state FROM qa_privileged_accounts WHERE uid=?",A).state,
    'active');
  assert.equal(f.count('qa_provider_fixture_refs'),3);
  assert.equal(f.count('qa_provider_fixture_refs',B),3);
  assert.equal(f.count('qa_provider_drill_once'),0);
};
test('Hosted schedule freezes QA Alice, atomically removes only synthetic refs and keeps Bob',async()=>{
  const f=fixture();
  try{
    await f.tick();
    assert.equal(f.one('SELECT state FROM qa_privileged_accounts WHERE uid=?',A).state,'frozen');
    assert.equal(f.one('SELECT state FROM qa_privileged_accounts WHERE uid=?',B).state,'active');
    assert.equal(f.count('qa_provider_fixture_refs'),0);
    assert.equal(f.count('qa_provider_fixture_refs',B),3);
    assert.equal(f.count('qa_provider_fixture_reconciliations'),1);
    assert.equal(f.one('SELECT state,run_id,case_id FROM qa_provider_drill_once WHERE uid=?',A).state,'verified');
    assert.equal(f.one('SELECT case_id FROM qa_provider_drill_once WHERE uid=?',A).case_id,CASE);
    assert.equal(f.one('SELECT run_id FROM qa_provider_drill_once WHERE uid=?',A).run_id,RUN);
    assert.equal(f.one('SELECT step FROM qa_deletion_cases WHERE uid=?',A).step,1);
    assert.equal(f.one('SELECT role FROM qa_deletion_attestations WHERE uid=?',A).role,'guardian');
    assert.equal(f.one('SELECT COUNT(*) AS n FROM qa_privileged_operations').n,0);
    assert.equal(f.one('SELECT COUNT(*) AS n FROM qa_stage_nonces').n,0);
    await f.tick(); // no automatic second effect
    assert.equal(f.count('qa_provider_drill_once'),1);
    assert.equal(f.count('qa_provider_fixture_reconciliations'),1);
  }finally{f.close();}
});
test('no hosted canary evidence denies drill with unchanged fixture and active account',async()=>{
  const f=fixture({canaries:false});
  try{await f.tick();emptyCheck(f);}finally{f.close();}
});
test('hold or pending operation deny even a synthetic scheduled delete',async()=>{
  for(const mode of ['hold','inflight']){
    const f=fixture();
    try{
      if(mode==='hold')f.sqlite.prepare('INSERT INTO qa_provider_fixture_holds VALUES (?,?)')
        .run(A,'qa-moderation-review');
      else f.sqlite.prepare('INSERT INTO qa_privileged_operations VALUES (?,?,?)')
        .run(crypto.randomUUID(),A,'avatar_upload');
      await f.tick();
      emptyCheck(f);
    }finally{f.close();}
  }
});
test('missing manifest, extra case or pre-existing journal prevent reservation',async()=>{
  for(const mode of ['manifest','case','journal']){
    const f=fixture();
    try{
      if(mode==='manifest')
        f.sqlite.prepare('DELETE FROM qa_provider_fixture_refs WHERE uid=? AND kind=?')
          .run(A,'push_registration_pointer');
      if(mode==='case')
        f.sqlite.prepare('INSERT INTO qa_deletion_cases VALUES (?, ?,1,0,?)')
          .run(A,CASE,TIME);
      if(mode==='journal')
        f.sqlite.prepare('INSERT INTO qa_provider_fixture_reconciliations VALUES (?,?,?)')
          .run(A,CASE,TIME);
      await f.tick();
      assert.equal(f.count('qa_provider_drill_once'),0);
      assert.equal(f.one('SELECT state FROM qa_privileged_accounts WHERE uid=?',A).state,
        'active');
    }finally{f.close();}
  }
});
test('out-of-date cron or wrong D1 binding will not trigger the drill',async()=>{
  const f=fixture();
  try{
    await f.tick({cron:'*/5 * * * *'});
    await f.tick({scheduledTime:Date.parse('2026-11-04T00:00:00Z')});
    await f.tick({scheduledTime:Date.parse('2026-11-02T23:59:00Z')});
    await stage.scheduled({cron:'* * * * *',scheduledTime:TIME},{
      ...f.env,ATRIO_PRIVACY_STAGE_ID:'a-real-project'
    });
    emptyCheck(f);
  }finally{f.close();}
});
test('two concurrent private cron invocations cannot mutate the case twice',async()=>{
  const f=fixture();
  try{
    await Promise.all([f.tick(),f.tick()]);
    assert.equal(f.count('qa_provider_drill_once'),1);
    assert.equal(f.count('qa_provider_fixture_reconciliations'),1);
    assert.equal(f.one('SELECT state FROM qa_provider_drill_once WHERE uid=?',A).state,'verified');
    assert.equal(f.count('qa_provider_fixture_refs',B),3);
  }finally{f.close();}
});
test('ambiguous D1 batch leaves a failed one-shot and NEVER triggers automatic retry',async()=>{
  const f=fixture();
  try{
    let attempts=0;
    f.raw.batch=async()=>{attempts++;throw Error('qa_d1_unknown_outcome');};
    await f.tick();
    assert.equal(attempts,1);
    assert.equal(f.one('SELECT state FROM qa_provider_drill_once WHERE uid=?',A).state,'failed');
    assert.equal(f.count('qa_provider_fixture_refs'),3);
    await f.tick();
    assert.equal(attempts,1);
    assert.equal(f.count('qa_provider_fixture_refs',B),3);
  }finally{f.close();}
});
test('no public endpoint can invoke the hosted drill without scheduled trigger',async()=>{
  const f=fixture();
  try{
    const response=await stage.fetch(new Request('https://privacy-freeze-stage.internal/v1/drill',{
      method:'POST',body:'{}'
    }),f.env);
    assert.equal(response.status,403);
    emptyCheck(f);
  }finally{f.close();}
});
test('direct restricted entry rejects an unknown clock and never creates a reservation',async()=>{
  const f=fixture();
  try{
    const x=await runQaHostedProviderDrill(f.raw,{cron:'* * * * *',
      scheduledTime:0});
    assert.equal(x.state,'qa_hosted_drill_not_scheduled');
    emptyCheck(f);
  }finally{f.close();}
});
