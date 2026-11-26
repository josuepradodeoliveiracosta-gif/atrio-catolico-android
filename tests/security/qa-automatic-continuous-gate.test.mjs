import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CONTINUOUS_SCHEMA,createContinuousGate} from '../../cloudflare/push-worker/scripts/qa-automatic-continuous-gate.mjs';
function fixture(t) {
 const now=1800000000000, epoch=now-60000, old=epoch-600000;
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(`CREATE TABLE atrio_qa_identity(name TEXT PRIMARY KEY,project_id TEXT NOT NULL);
 INSERT INTO atrio_qa_identity VALUES('qa','atrio-catolico-qa-general');
 CREATE TABLE qa_auto_d1_activation_lab(singleton INTEGER PRIMARY KEY,activated_at INTEGER,enabled INTEGER);
 CREATE TABLE qa_auto_d1_trial_lab(singleton INTEGER PRIMARY KEY,activated_at INTEGER,ends_at INTEGER);
 INSERT INTO qa_auto_d1_activation_lab VALUES(1,${old},0);
 INSERT INTO qa_auto_d1_trial_lab VALUES(1,${old},${old+300000});`);
 sql.exec(CONTINUOUS_SCHEMA);sql.exec(CONTINUOUS_SCHEMA);
 const db={prepare(q){return {bind(...args){return {async first(){return sql.prepare(q.replaceAll("CAST(unixepoch('subsec')*1000 AS INTEGER)",String(now))).get(...args)}}}}}};
 const gate=createContinuousGate({db,activatedAt:epoch,enabled:true});
 const arm=()=>sql.prepare('INSERT INTO qa_auto_d1_continuous_epoch VALUES(?,1,?,?)').run(epoch,now-1000,now+3600000);
 return {now,epoch,old,sql,db,gate,arm};
}
test('default closed: absent state, disabled flags and unsupported kind',async t=>{
 const f=fixture(t);assert.equal(await f.gate('tick'),null);f.arm();
 assert.equal(await createContinuousGate({db:f.db,activatedAt:f.epoch})('tick'),null);
 assert.equal(await f.gate('other'),null);
});
test('a separate epoch accepts a current quota lease but never edits trial history',async t=>{
 const f=fixture(t);f.arm();assert.equal(await f.gate('tick'),f.now+3600000);
 assert.equal(await f.gate('notice'),f.now+3600000);
 assert.equal(f.sql.prepare('SELECT enabled FROM qa_auto_d1_activation_lab').get().enabled,0);
 assert.equal(f.sql.prepare('SELECT activated_at FROM qa_auto_d1_trial_lab').get().activated_at,f.old);
 assert.throws(()=>f.sql.prepare('INSERT INTO qa_auto_d1_continuous_epoch VALUES(?,1,?,?)').run(f.epoch+1,f.now,f.now+600000));
});
test('expired quota, disabled epoch, wrong identity and active trial fail closed',async t=>{
 const f=fixture(t);f.arm();
 f.sql.prepare('UPDATE qa_auto_d1_continuous_epoch SET quota_valid_until=?').run(f.now+1000);assert.equal(await f.gate('tick'),null);assert.equal(await f.gate('notice'),null);
 f.sql.prepare('UPDATE qa_auto_d1_continuous_epoch SET quota_valid_until=?').run(f.now+3600000);
 f.sql.exec('UPDATE qa_auto_d1_continuous_epoch SET enabled=0');assert.equal(await f.gate('tick'),null);
 f.sql.exec("UPDATE qa_auto_d1_continuous_epoch SET enabled=1; UPDATE atrio_qa_identity SET project_id='other'");assert.equal(await f.gate('tick'),null);
 f.sql.exec("UPDATE atrio_qa_identity SET project_id='atrio-catolico-qa-general'; UPDATE qa_auto_d1_activation_lab SET enabled=1");assert.equal(await f.gate('tick'),null);
});
test('historical epoch and unavailable database never authorize',async t=>{
 const f=fixture(t);f.sql.prepare('INSERT INTO qa_auto_d1_continuous_epoch VALUES(?,1,?,?)').run(f.old,f.now,f.now+3600000);
 assert.equal(await createContinuousGate({db:f.db,activatedAt:f.old,enabled:true})('tick'),null);
 assert.equal(await createContinuousGate({db:{prepare(){throw Error('unavailable')}},activatedAt:f.epoch,enabled:true})('tick'),null);
});
