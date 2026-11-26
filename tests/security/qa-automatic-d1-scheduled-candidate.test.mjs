import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {D1_OUTBOX_LAB_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-outbox-lab.mjs';
import {D1_TRIAL_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-trial-lab.mjs';
import {D1_SCHEDULE_SCHEMA,QA_AUTO_CRON,createQaScheduledCandidate} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-scheduled-candidate.mjs';
import {CONTINUOUS_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-continuous-gate.mjs';
function fixture(t){
 // SQL uses actual time. A minute may be older than 15s: freeze JS and
 // use an in-memory SQL clock overridden only in the test bridge.
 const now=Math.floor(Date.now()/60000)*60000+5000,at=now-5000,epoch=at-60000;
 t.mock.method(Date,'now',()=>now);
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(D1_OUTBOX_LAB_SCHEMA+D1_TRIAL_SCHEMA+D1_SCHEDULE_SCHEMA);
 sql.prepare('INSERT INTO qa_auto_d1_activation_lab VALUES(1,?,1)').run(epoch);
 sql.prepare('INSERT INTO qa_auto_d1_trial_lab(singleton,activated_at,ends_at) VALUES(1,?,?)').run(epoch,epoch+600000);
 sql.prepare('INSERT INTO qa_auto_d1_schedule_lab(singleton,activated_at) VALUES(1,?)').run(epoch);
 let queries=0,ticks=0;const logs=[];
 const db={prepare(q){queries++;return {bind(...args){return {async run(){
  const r=sql.prepare(q.replaceAll("CAST(unixepoch('subsec')*1000 AS INTEGER)",String(now))).run(...args);
  return {success:true,meta:{changes:r.changes}};
 }}}}}};
 const env={QA_AUTO_SCHEDULE_ENABLED:'true',QA_AUTO_MODE:'automatic',QA_PUSH_ENABLED:'true',QA_CONVERSATION_PUSH_ENABLED:'true',
  QA_AUTO_ACTIVATED_AT:String(epoch),QA_PUSH_DB:db,QA_FIREBASE_SERVICE_ACCOUNT_JSON:'fixture',QA_FIREBASE_WEB_API_KEY:'fixture'};
 const candidate={async tick(){ticks++;return {result:{transportStatus:'accepted_simulated',eventKey:'SENSITIVE'},httpUsage:{actualExternalAttempts:30,fcmAttempted:true}}}};
 const run=createQaScheduledCandidate({candidate,report:r=>logs.push(r)});
 return {sql,env,at,epoch,now,run,candidate,logs,stats:()=>({queries,ticks}),controller:{cron:QA_AUTO_CRON,scheduledTime:at}};
}
test('scheduled candidate closed by default and rejects other or stale events before SQL',async t=>{
 const f=fixture(t);
 for(const env of [{...f.env,QA_AUTO_SCHEDULE_ENABLED:undefined},{...f.env,QA_AUTO_MODE:'manual'},{...f.env,QA_AUTO_ACTIVATED_AT:'invalid'},{...f.env,QA_PUSH_ENABLED:'false'}])
  assert.equal((await f.run(f.controller,env)).reason,'schedule_disabled');
 for(const c of [{cron:'*/5 * * * *',scheduledTime:f.at},{cron:QA_AUTO_CRON,scheduledTime:f.at-60000},{cron:QA_AUTO_CRON,scheduledTime:f.at+60000},{cron:QA_AUTO_CRON,scheduledTime:f.at+1}])
  assert.equal((await f.run(c,f.env)).reason,'schedule_invalid');
 assert.deepEqual(f.stats(),{queries:0,ticks:0});
});
test('concurrent cron deliveries reserve one minute once, diagnostics contain no identity',async t=>{
 const f=fixture(t);
 const runs=await Promise.all(Array.from({length:8},()=>f.run(f.controller,f.env)));
 assert.equal(runs.filter(r=>r.status==='completed').length,1);
 assert.equal(runs.filter(r=>r.reason==='schedule_reservation_unavailable').length,7);
 assert.equal(f.stats().ticks,1);
 assert.equal(f.sql.prepare('SELECT last_scheduled_at FROM qa_auto_d1_schedule_lab').get().last_scheduled_at,f.at);
 assert.equal(runs.find(r=>r.status==='completed').outcome,'provider_accepted');
 assert.ok(!JSON.stringify(f.logs).includes('SENSITIVE'));
});
test('disabled activation, missing reservation, deadline and trial exhaustion stop before tick',async t=>{
 const f=fixture(t);
 f.sql.exec('UPDATE qa_auto_d1_activation_lab SET enabled=0');
 assert.equal((await f.run(f.controller,f.env)).reason,'schedule_reservation_unavailable');
 f.sql.exec('UPDATE qa_auto_d1_activation_lab SET enabled=1');
 f.sql.prepare('UPDATE qa_auto_d1_trial_lab SET ends_at=?').run(f.now+1000);
 assert.equal((await f.run(f.controller,f.env)).reason,'schedule_reservation_unavailable');
 f.sql.prepare('UPDATE qa_auto_d1_trial_lab SET ends_at=?,ticks=60').run(f.now+300000);
 assert.equal((await f.run(f.controller,f.env)).reason,'schedule_reservation_unavailable');
 f.sql.exec('UPDATE qa_auto_d1_trial_lab SET ticks=0; DELETE FROM qa_auto_d1_schedule_lab');
 assert.equal((await f.run(f.controller,f.env)).reason,'schedule_reservation_unavailable');
 assert.equal(f.stats().ticks,0);
});
test('crash after reservation never replays the minute and reports uncertainty',async t=>{
 const f=fixture(t);let attempts=0;
 const run=createQaScheduledCandidate({candidate:{async tick(){attempts++;throw Error('SENSITIVE')}},report:()=>{throw Error('log failed')}});
 const r=await run(f.controller,f.env);
 assert.equal(r.status,'failed');assert.equal(r.fcmAttempted,null);
 assert.equal((await run(f.controller,f.env)).reason,'schedule_reservation_unavailable');
 assert.equal(attempts,1);assert.ok(!JSON.stringify(r).includes('SENSITIVE'));
});

test('continuous minute reservation is distinct, once-only and quota-bound',async t=>{
 const f=fixture(t),epoch=f.epoch+1000;
 f.sql.exec(CONTINUOUS_SCHEMA+"CREATE TABLE atrio_qa_identity(project_id TEXT); INSERT INTO atrio_qa_identity VALUES('atrio-catolico-qa-general'); UPDATE qa_auto_d1_activation_lab SET enabled=0");
 f.sql.prepare('INSERT INTO qa_auto_d1_continuous_epoch VALUES(?,1,?,?)').run(epoch,f.now-1000,f.now+600000);
 f.sql.prepare('INSERT INTO qa_auto_d1_continuous_schedule(activated_at) VALUES(?)').run(epoch);
 const env={...f.env,QA_AUTO_MODE:'continuous',QA_AUTO_ACTIVATED_AT:String(epoch)};
 assert.equal((await f.run(f.controller,env)).reason,'schedule_disabled');
 const armed={...env,QA_AUTO_CONTINUOUS_ENABLED:'true'};
 f.sql.prepare('UPDATE qa_auto_d1_continuous_epoch SET quota_valid_until=?').run(f.now+60000);
 assert.equal((await f.run(f.controller,armed)).reason,'schedule_reservation_unavailable');
 f.sql.prepare('UPDATE qa_auto_d1_continuous_epoch SET quota_valid_until=?').run(f.now+600000);
 const runs=await Promise.all(Array.from({length:8},()=>f.run(f.controller,armed)));
 assert.equal(runs.filter(r=>r.status==='completed').length,1);
 assert.equal(f.stats().ticks,1);
 assert.equal(f.sql.prepare('SELECT last_scheduled_at FROM qa_auto_d1_schedule_lab').get().last_scheduled_at,0);
 assert.equal(f.sql.prepare('SELECT last_scheduled_at FROM qa_auto_d1_continuous_schedule').get().last_scheduled_at,f.at);
});
