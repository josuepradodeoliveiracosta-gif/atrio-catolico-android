import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {D1_LAB_BUDGET_SCHEMA,D1_LAB_LIMITS,D1_LAB_ENVELOPE,D1_CONTINUOUS_LIMITS,D1_CONTINUOUS_TWO_DAY_READS,createD1DailyBudgetLab,createD1InvocationBudgetLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-budget-lab.mjs';
import {createMeteredD1Lab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-metered-lab.mjs';
import {D1_OUTBOX_LAB_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-outbox-lab.mjs';
import {CONTINUOUS_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-continuous-gate.mjs';
import {D1_TRIAL_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-trial-lab.mjs';
const bridge=sql=>({prepare(q){return {bind(...args){return {async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:r.changes}}},async first(){return sql.prepare(q).get(...args)??null}}}}}});
test('daily caps shared across instances, no refunds or stage spillover',async t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec(D1_LAB_BUDGET_SCHEMA);
 const db=bridge(sql),a=createD1DailyBudgetLab({db,enabled:true}),b=createD1DailyBudgetLab({db,enabled:true});
 for(const [stage,n] of Object.entries(D1_LAB_LIMITS)){
  const results=await Promise.all(Array.from({length:n+4},(_,i)=>(i%2?a:b)(stage)));
  assert.equal(results.filter(Boolean).length,n);
  assert.equal(await a(stage),false);
 }
 assert.equal(await a('other'),false);
 assert.equal(D1_LAB_ENVELOPE.reads,12840);
 assert.equal(D1_LAB_ENVELOPE.writesFirestore,0);
});
test('disabled and D1 failure deny reservation',async()=>{
 const db={prepare(){throw Error('unavailable')}};
 assert.equal(await createD1DailyBudgetLab({db})('work'),false);
 assert.equal(await createD1DailyBudgetLab({db,enabled:true})('work'),false);
});
test('per invocation bounds include cold credential allowance and finish slot',()=>{
 const m=createD1InvocationBudgetLab('tick');
 m.chargeExternal(33);assert.throws(()=>m.chargeExternal(),/budget/);
 for(let i=0;i<23;i++)m.chargeD1();
 assert.throws(()=>m.chargeD1(),/budget/);
 m.chargeD1({finish:true});assert.throws(()=>m.chargeD1({finish:true}),/budget/);
 assert.deepEqual(m.snapshot(),{externalReserved:35,d1Calls:24});
 const n=createD1InvocationBudgetLab('notice');n.chargeExternal(8);
 assert.throws(()=>n.chargeExternal(),/budget/);
});
test('composition stops before network when daily budget or activation is closed',async t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec(D1_LAB_BUDGET_SCHEMA+D1_OUTBOX_LAB_SCHEMA);
 const db=bridge(sql),activatedAt=Date.now()-10000;
 sql.prepare('INSERT INTO qa_auto_d1_activation_lab VALUES(1,?,0)').run(activatedAt);
 let external=0;const forbidden=async()=>{external++;throw Error('forbidden')};
 const w=createMeteredD1Lab({db,enabled:true,activatedAt,transport:forbidden,lookupAccounts:forbidden,
  manualWorker:{fetch:forbidden},verifyIdentity:forbidden,listDevices:forbidden,sendRefresh:forbidden});
 const env={PUSH_DB:db,PUSH_ENABLED:'true',FIREBASE_WEB_API_KEY:'fixture',FIREBASE_SERVICE_ACCOUNT_JSON:'fixture'};
 assert.equal((await w.tick(env)).result.reason,'mode_unavailable');
 sql.exec("UPDATE qa_auto_d1_activation_lab SET enabled=1; INSERT INTO qa_auto_d1_budget_lab VALUES(strftime('%Y-%m-%d','now'),1440,60,200)");
 assert.equal((await w.tick(env)).result.reason,'budget_unavailable');
 assert.equal((await w.notice(new Request('https://qa.invalid/notice'),env)).response.status,503);
 assert.equal(external,0);
});

function continuousBudget(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(D1_OUTBOX_LAB_SCHEMA+D1_TRIAL_SCHEMA+D1_LAB_BUDGET_SCHEMA+CONTINUOUS_SCHEMA);
 sql.exec("CREATE TABLE atrio_qa_identity(project_id TEXT); INSERT INTO atrio_qa_identity VALUES('atrio-catolico-qa-general')");
 const now=Date.now(),activatedAt=now-60000;
 sql.prepare('INSERT INTO qa_auto_d1_continuous_epoch VALUES(?,1,?,?)').run(activatedAt,now,now+600000);
 const db=bridge(sql),make=()=>createD1DailyBudgetLab({db,enabled:true,continuous:true,activatedAt});
 return {sql,db,activatedAt,make};
}
test('continuous daily caps are shared, lower than trial and deny after disarm',async t=>{
 const f=continuousBudget(t),a=f.make(),b=f.make();
 for(const [stage,n] of Object.entries(D1_CONTINUOUS_LIMITS)){
  const results=await Promise.all(Array.from({length:n+3},(_,i)=>(i%2?a:b)(stage)));
  assert.equal(results.filter(Boolean).length,n);
 }
 assert.equal(2*(1440*2+20*96+75*21),12750);
 assert.ok(12750<=D1_CONTINUOUS_TWO_DAY_READS);
 f.sql.exec("UPDATE qa_auto_d1_budget_lab SET discovery=0; UPDATE qa_auto_d1_continuous_epoch SET enabled=0");
 assert.equal(await a('discovery'),false);
});
test('previous UTC day reserves shared headroom across Pacific rollover',async t=>{
 const f=continuousBudget(t),a=f.make();
 f.sql.exec("INSERT INTO qa_auto_d1_budget_lab VALUES(date('now','-1 day'),1440,60,199)");
 assert.equal(await a('work'),false); // previous envelope leaves just 21 reads
 assert.equal(await a('notice'),true);
 assert.equal(await a('discovery'),false);
 assert.equal(f.sql.prepare("SELECT SUM(discovery*2+work*96+notice*21) AS n FROM qa_auto_d1_budget_lab").get().n,D1_CONTINUOUS_TWO_DAY_READS);
 f.sql.exec("UPDATE qa_auto_d1_continuous_epoch SET quota_valid_until=quota_checked_at");
 assert.equal(await a('discovery'),false);
});
test('continuous metered invocation honors atomic prior-day cap before external I/O',async t=>{
 const f=continuousBudget(t);
 f.sql.exec("INSERT INTO qa_auto_d1_budget_lab VALUES(date('now','-1 day'),1440,60,200)");
 let calls=0;const forbidden=async()=>{calls++;throw Error('unexpected_network')};
 const w=createMeteredD1Lab({db:f.db,enabled:true,continuous:true,activatedAt:f.activatedAt,transport:forbidden,lookupAccounts:forbidden,
  manualWorker:{fetch:forbidden},verifyIdentity:forbidden,listDevices:forbidden,sendRefresh:forbidden});
 const env={PUSH_DB:f.db,PUSH_ENABLED:'true',FIREBASE_WEB_API_KEY:'fixture',FIREBASE_SERVICE_ACCOUNT_JSON:'fixture'};
 assert.equal((await w.tick(env)).result.reason,'budget_unavailable');
 assert.equal((await w.notice(new Request('https://qa.invalid/notice'),env)).response.status,503);
 assert.equal(calls,0);
});
