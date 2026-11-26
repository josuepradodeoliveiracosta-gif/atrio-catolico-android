import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CONTINUOUS_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-continuous-gate.mjs';
import {RENEWAL_SCOPE,RENEWAL_LIMITS,createContinuousRenewal} from '../../cloudflare/push-worker/scripts/qa-automatic-continuous-renewal.mjs';
const version='c0e65be8-5696-4152-bf0d-40c56d5ce40c',now=1800000000000,epoch=now-86400000+1800000,expiry=epoch+86400000;
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(CONTINUOUS_SCHEMA+`
 CREATE TABLE atrio_qa_identity(project_id TEXT); INSERT INTO atrio_qa_identity VALUES('atrio-catolico-qa-general');
 CREATE TABLE qa_auto_d1_activation_lab(enabled INTEGER);
 CREATE TABLE qa_auto_d1_trial_lab(activated_at INTEGER);
 CREATE TABLE qa_auto_d1_outbox_lab(expires_at INTEGER);
 `);
 sql.prepare('INSERT INTO qa_auto_d1_continuous_epoch VALUES(?,1,?,?)').run(epoch,epoch,expiry);
 sql.prepare('INSERT INTO qa_auto_d1_continuous_schedule(activated_at) VALUES(?)').run(epoch);
 const db={prepare(q){return {bind(...args){const stmt=sql.prepare(q.replaceAll("CAST(unixepoch('subsec')*1000 AS INTEGER)",String(now)));return {async first(){return stmt.get(...args)},async run(){return {success:true,meta:{changes:stmt.run(...args).changes}}}}}}}};
 const evidence={...RENEWAL_SCOPE,observedAt:now,versionId:version,singleVersion:true,traffic:100,cron:'* * * * *',mode:'continuous',complete:true,currentQuotaWindows:true,conservative:true,freeLimitsEnforced:true,workerRequestsRemaining:50000,d1RowsReadRemaining:1000000,d1RowsWrittenRemaining:50000,firestoreReadsRemaining:30000};
 const make=(over={})=>createContinuousRenewal({db,activatedAt:epoch,expectedVersion:version,enabled:true,now:()=>now,collectEvidence:async()=>({...evidence}),...over});
 const row=()=>sql.prepare('SELECT * FROM qa_auto_d1_continuous_epoch').get();
 return {sql,evidence,make,row};
}
test('fresh complete evidence extends same epoch by at most 24h without rearming',async t=>{
 const f=fixture(t);const r=await f.make()();
 assert.equal(r.status,'renewed');assert.equal(f.row().activated_at,epoch);assert.equal(f.row().quota_checked_at,now);assert.equal(f.row().quota_valid_until,now+RENEWAL_LIMITS.leaseMs);assert.equal((await f.make()()).reason,'not_due');
});
test('missing, stale, future, incomplete, wrong scope or insufficient evidence never renews',async t=>{
 const f=fixture(t);
 for(const over of [{observedAt:now-900001},{observedAt:now+1},{complete:false},{currentQuotaWindows:false},{conservative:false},{freeLimitsEnforced:false},{projectId:'prod'},{accountId:'wrong'},{databaseId:'wrong'},{versionId:'wrong'},{singleVersion:false},{traffic:90},{cron:'other'},{mode:'manual'},{workerRequestsRemaining:1999},{d1RowsReadRemaining:199999},{d1RowsWrittenRemaining:19999},{firestoreReadsRemaining:14999}]){
  const r=await f.make({collectEvidence:async()=>({...f.evidence,...over})})();assert.equal(r.reason,'evidence_unavailable',JSON.stringify(over));assert.equal(f.row().quota_valid_until,expiry);
 }
 assert.equal((await f.make({collectEvidence:async()=>{throw Error('no metrics')}})()).reason,'verification_unavailable');
 assert.equal((await f.make({collectEvidence:async()=>null})()).reason,'evidence_unavailable');
});
test('disabled, expired or early renewal never collects metrics',async t=>{
 const f=fixture(t),forbidden=async()=>{assert.fail('unexpected collection')};
 assert.equal((await f.make({enabled:false,collectEvidence:forbidden})()).reason,'disabled');
 f.sql.prepare('UPDATE qa_auto_d1_continuous_epoch SET quota_valid_until=?').run(now-1);
 assert.equal((await f.make({collectEvidence:forbidden})()).reason,'expired_or_too_late');
 f.sql.prepare('UPDATE qa_auto_d1_continuous_epoch SET quota_checked_at=?,quota_valid_until=?').run(now-1000,now+7200000);
 assert.equal((await f.make({collectEvidence:forbidden})()).reason,'not_due');
});
test('concurrent renewal is compare-and-swap; disarm during collection never reactivates',async t=>{
 const f=fixture(t);const results=await Promise.all([f.make()(),f.make()()]);
 assert.equal(results.filter(x=>x.status==='renewed').length,1);
 f.sql.prepare('UPDATE qa_auto_d1_continuous_epoch SET quota_checked_at=?,quota_valid_until=?').run(epoch,expiry);
 const r=await f.make({collectEvidence:async()=>{f.sql.exec('UPDATE qa_auto_d1_continuous_epoch SET enabled=0');return f.evidence}})();
 assert.equal(r.reason,'state_changed_or_busy');assert.equal(f.row().enabled,0);assert.equal(f.row().quota_valid_until,expiry);
});
test('busy outbox, wrong D1 identity or active trial prevent renewal without deleting history',async t=>{
 const f=fixture(t);
 f.sql.prepare('INSERT INTO qa_auto_d1_outbox_lab VALUES(?)').run(now+10000);assert.equal((await f.make()()).reason,'state_changed_or_busy');
 f.sql.exec("UPDATE qa_auto_d1_outbox_lab SET expires_at=1; UPDATE atrio_qa_identity SET project_id='prod'");assert.equal((await f.make()()).reason,'state_changed_or_busy');
 f.sql.exec("UPDATE atrio_qa_identity SET project_id='atrio-catolico-qa-general'; INSERT INTO qa_auto_d1_activation_lab VALUES(1)");assert.equal((await f.make()()).reason,'state_changed_or_busy');
 assert.equal(f.row().quota_valid_until,expiry);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM qa_auto_d1_outbox_lab').get().n,1);
});
