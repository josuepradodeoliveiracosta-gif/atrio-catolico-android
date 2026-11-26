import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {D1_LAB_BUDGET_SCHEMA,D1_LAB_LIMITS,D1_LAB_ENVELOPE,createD1DailyBudgetLab,createD1InvocationBudgetLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-budget-lab.mjs';
import {createMeteredD1Lab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-metered-lab.mjs';
import {D1_OUTBOX_LAB_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-outbox-lab.mjs';
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
