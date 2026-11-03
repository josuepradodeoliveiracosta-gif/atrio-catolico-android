import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reconcileQaProviderFixture}
  from '../../privacy-freeze-stage/src/qa-provider-reconciliation.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const CASE='fa00bbaa-4a09-4fd2-b399-001122334455';
const OTHER='fa00bbaa-4a09-4fd2-b399-001122334466';
const KIND=['avatar_d1_pointer','cloudinary_qa_pointer',
  'push_registration_pointer'];

function fixture({persist=true}={}){
  const directory=persist?mkdtempSync(join(tmpdir(),'atrio-qa-provider-')):null;
  const file=persist?join(directory,'isolated.sqlite'):':memory:';
  const sql=new DatabaseSync(file);
  sql.exec('PRAGMA busy_timeout=1000');
  sql.exec('PRAGMA foreign_keys=ON');
  for(const name of ['0001_fixture_only.sql','0002_qa_deletion_cases.sql',
    '0004_qa_provider_refs.sql']){
    sql.exec(readFileSync(new URL(
      '../../privacy-freeze-stage/migrations/'+name,import.meta.url),'utf8'));
  }
  const existing={alice:A,bob:B};
  const fake=(uid)=>{
    for(const kind of KIND)
      sql.prepare('INSERT INTO qa_provider_fixture_refs VALUES (?,?,?)')
        .run(uid,kind,'qa-fixture-'+kind.replaceAll('_','-')+'-'+uid);
  };
  fake(A);fake(B);
  // Frozen synthetic case at step=1; no provider, user or Auth state touched.
  sql.prepare("UPDATE qa_privileged_accounts SET state='frozen' WHERE uid=?").run(A);
  sql.prepare('INSERT INTO qa_deletion_cases(uid,case_id,generation,step,opened_ms) VALUES (?,?,1,1,?)')
    .run(A,CASE,1793738000000);
  let approval=true,freeze=true;
  const options={uid:A,caseId:CASE,
    independentApproval:async()=>approval,
    independentFreezeCheck:async()=>freeze,
    now:()=>1793738010000};
  const prepare=stmt=>({
    bind(...params){
      const run=()=>stmt.startsWith('DELETE')?
        (()=>{const results=sql.prepare(stmt).all(...params);return{
          success:true,meta:{changes:results.length},results
        };})():
        (()=>{const result=sql.prepare(stmt).run(...params);return{
          success:true,meta:{changes:result.changes},results:[]
        };})();
      return{
        sql:stmt,params,run,
        async first(){return sql.prepare(stmt).get(...params)||null;},
        async all(){return {results:sql.prepare(stmt).all(...params)};}
      };
    }
  });
  const db={
    prepare,
    async batch(queries){
      sql.exec('BEGIN IMMEDIATE');
      try{
        const results=queries.map(x=>x.run());
        sql.exec('COMMIT');
        return results;
      }catch(e){
        sql.exec('ROLLBACK');
        throw e;
      }
    }
  };
  const count=(name,uid=A)=>sql.prepare(
    'SELECT COUNT(*) AS n FROM '+name+' WHERE uid=?').get(uid).n;
  return {sql,db,options,count,
    setApproval:v=>{approval=v;},setFreeze:v=>{freeze=v;},
    close:()=>{sql.close();if(directory)rmSync(directory,{recursive:true,force:true});}
  };
}

test('reconciles only frozen synthetic fixture references, preserves Bob, idempotent on retry',async()=>{
  const q=fixture();
  try{
    const report=await reconcileQaProviderFixture(q.db,q.options);
    assert.equal(report.status,'qa_synthetic_d1_reconciled');
    assert.equal(report.productionReady,false);
    assert.equal(report.productProviderDeleted,false);
    assert.equal(report.remoteCloudinaryVerified,false);
    assert.equal(report.remoteFcmVerified,false);
    assert.equal(q.count('qa_provider_fixture_refs',A),0);
    assert.equal(q.count('qa_provider_fixture_refs',B),3);
    assert.equal(q.count('qa_provider_fixture_reconciliations'),1);
    const retry=await reconcileQaProviderFixture(q.db,q.options);
    assert.equal(retry.resumed,true);
    assert.equal(q.count('qa_provider_fixture_reconciliations'),1);
  }finally{q.close();}
});
test('moderation legal hold prevents cleanup and journal creation',async()=>{
  const q=fixture();
  try{
    q.sql.prepare('INSERT INTO qa_provider_fixture_holds VALUES (?,?)')
      .run(A,'qa-moderation-review');
    await assert.rejects(reconcileQaProviderFixture(q.db,q.options),
      /fence_case_or_retention/);
    assert.equal(q.count('qa_provider_fixture_refs'),3);
    assert.equal(q.count('qa_provider_fixture_reconciliations'),0);
  }finally{q.close();}
});
test('pending in-flight avatar/push operation prevents cleanup',async()=>{
  const q=fixture();
  try{
    q.sql.prepare('INSERT INTO qa_privileged_operations VALUES (?,?,?)')
      .run(crypto.randomUUID(),A,'avatar_upload');
    await assert.rejects(reconcileQaProviderFixture(q.db,q.options),
      /fence_case_or_retention/);
    assert.equal(q.count('qa_provider_fixture_refs'),3);
  }finally{q.close();}
});
test('not frozen, no case and incorrect phase deny deletion',async()=>{
  for(const change of [
    q=>q.sql.prepare("UPDATE qa_privileged_accounts SET state='active' WHERE uid=?").run(A),
    q=>q.sql.prepare('DELETE FROM qa_deletion_cases WHERE uid=?').run(A),
    q=>q.sql.prepare('UPDATE qa_deletion_cases SET step=0 WHERE uid=?').run(A)
  ]){
    const q=fixture();
    try{
      change(q);
      await assert.rejects(reconcileQaProviderFixture(q.db,q.options),
        /fence_case_or_retention/);
      assert.equal(q.count('qa_provider_fixture_refs'),3);
    }finally{q.close();}
  }
});
test('unknown/incomplete manifest refuses any provider fixture deletion',async()=>{
  const q=fixture();
  try{
    q.sql.prepare('DELETE FROM qa_provider_fixture_refs WHERE uid=? AND kind=?')
      .run(A,'push_registration_pointer');
    await assert.rejects(reconcileQaProviderFixture(q.db,q.options),
      /manifest_incomplete_or_unknown/);
    assert.equal(q.count('qa_provider_fixture_refs'),2);
    assert.equal(q.count('qa_provider_fixture_reconciliations'),0);
  }finally{q.close();}
});
test('revoked independent approval/freeze and foreign UID fail before mutation',async()=>{
  const q=fixture();
  try{
    q.setApproval(false);
    await assert.rejects(reconcileQaProviderFixture(q.db,q.options),/approval_revoked/);
    q.setApproval(true);q.setFreeze(false);
    await assert.rejects(reconcileQaProviderFixture(q.db,q.options),/freeze_not_independently_confirmed/);
    q.setFreeze(true);
    await assert.rejects(reconcileQaProviderFixture(q.db,
      {...q.options,uid:'real-customer-uid'}),/untrusted_identity/);
    await assert.rejects(reconcileQaProviderFixture(q.db,
      {...q.options,caseId:OTHER}),/fence_case_or_retention/);
    assert.equal(q.count('qa_provider_fixture_refs'),3);
  }finally{q.close();}
});
test('new artifact after completed cleanup is treated as resurrection and blocks retry',async()=>{
  const q=fixture();
  try{
    await reconcileQaProviderFixture(q.db,q.options);
    q.sql.prepare('INSERT INTO qa_provider_fixture_refs VALUES (?,?,?)')
      .run(A,'avatar_d1_pointer','qa-fixture-rogue');
    await assert.rejects(reconcileQaProviderFixture(q.db,q.options),
      /residual_or_ambiguous_effect/);
    assert.equal(q.count('qa_provider_fixture_refs'),1);
  }finally{q.close();}
});
test('transaction error rolls back journal and keeps all three refs',async()=>{
  const q=fixture();
  try{
    const db={...q.db,batch:async stmts=>{
      q.sql.exec('BEGIN');
      try{
        stmts[0].run();
        throw Error('qa_d1_unknown_remote_failure');
      }finally{q.sql.exec('ROLLBACK');}
    }};
    await assert.rejects(reconcileQaProviderFixture(db,q.options),
      /qa_d1_unknown_remote_failure/);
    assert.equal(q.count('qa_provider_fixture_refs'),3);
    assert.equal(q.count('qa_provider_fixture_reconciliations'),0);
  }finally{q.close();}
});
test('unconfirmed D1 batch response can never produce a success verdict',async()=>{
  const q=fixture();
  try{
    const db={...q.db,batch:async()=>[{success:false,meta:{changes:1}},{
      success:true,meta:{changes:3},results:KIND.map(kind=>({kind}))
    }]};
    await assert.rejects(reconcileQaProviderFixture(db,q.options),
      /transaction_unconfirmed/);
    assert.equal(q.count('qa_provider_fixture_refs'),3);
  }finally{q.close();}
});
test('cross-case conflict never erases a new case, and resumed status is scoped',async()=>{
  const q=fixture();
  try{
    await reconcileQaProviderFixture(q.db,q.options);
    q.sql.prepare('UPDATE qa_deletion_cases SET case_id=? WHERE uid=?').run(OTHER,A);
    await assert.rejects(reconcileQaProviderFixture(q.db,
      {...q.options,caseId:OTHER}),/case_conflict/);
    assert.equal(q.count('qa_provider_fixture_reconciliations'),1);
  }finally{q.close();}
});
