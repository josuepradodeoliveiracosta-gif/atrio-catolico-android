import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {D1_TRIAL_SCHEMA,createD1TrialGate} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-trial-lab.mjs';
import {D1_OUTBOX_LAB_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-outbox-lab.mjs';
import {D1_LAB_BUDGET_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-budget-lab.mjs';
import {createQaAutomaticCandidateRelay} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-relay-candidate.mjs';
const bearer=()=>{const now=Math.floor(Date.now()/1000),p='atrio-catolico-qa-general';return 'Bearer '+Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({aud:p,iss:'https://securetoken.google.com/'+p,sub:'qa-nav-alice',email:'alice.navegacao@qa.invalid',email_verified:true,auth_time:now-30,iat:now-1,exp:now+300,firebase:{sign_in_provider:'password'}})).toString('base64url')+'.fixture'};
const validNotice=()=>new Request('https://qa.invalid/notice',{headers:{Authorization:bearer()}});
const req=(path,body)=>new Request('https://qa.invalid'+path,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(D1_OUTBOX_LAB_SCHEMA+D1_LAB_BUDGET_SCHEMA+D1_TRIAL_SCHEMA);
 const activatedAt=Date.now()-10000,end=activatedAt+3600000;
 sql.prepare('INSERT INTO qa_auto_d1_activation_lab VALUES(1,?,0)').run(activatedAt);
 sql.prepare('INSERT INTO qa_auto_d1_trial_lab(singleton,activated_at,ends_at) VALUES(1,?,?)').run(activatedAt,end);
 const db={prepare(q){return {bind(...args){return {async first(){return sql.prepare(q).get(...args)??null},async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:r.changes}}}}}}}};
 const env={QA_PUSH_ENABLED:'true',QA_CONVERSATION_PUSH_ENABLED:'true',QA_AUTO_ACTIVATED_AT:String(activatedAt),QA_PUSH_DB:db,
 QA_FIREBASE_WEB_API_KEY:'fixture',QA_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'atrio-catolico-qa-general',client_email:'atrio-qa-general-push@atrio-catolico-qa-general.iam.gserviceaccount.com',private_key:'fixture'})};
 let manual=0,network=0;
 const candidate=createQaAutomaticCandidateRelay({manualWorker:{async fetch(r,mapped){manual++;assert.equal(mapped.PUSH_DB,db);return Response.json({status:'manual_fixture'})}},
 fetchImpl:async()=>{network++;throw Error('unexpected_network')}});
 return {sql,db,env,activatedAt,end,candidate,stats:()=>({manual,network}),arm:()=>sql.exec('UPDATE qa_auto_d1_activation_lab SET enabled=1')};
}
test('candidate off by default; explicit manual preserves real relay mapping',async t=>{
 const f=fixture(t),w=f.candidate;
 assert.equal((await w.fetch(req('/notice'),f.env)).status,503);
 assert.equal((await w.fetch(req('/event',{type:'chat_message'}),f.env)).status,503);
 assert.equal((await w.tick(f.env)).result.reason,'trial_unavailable');
 const env={...f.env,QA_AUTO_MODE:'manual'};
 assert.equal((await (await w.fetch(req('/notice'),env)).json()).status,'manual_fixture');
 assert.equal((await (await w.fetch(req('/event',{type:'chat_message'}),env)).json()).status,'manual_fixture');
 f.arm();
 assert.equal((await w.fetch(req('/notice'),env)).status,503);
 assert.deepEqual(f.stats(),{manual:2,network:0});
});
test('automatic rejects public send, wrong epoch, disabled flags and missing schema',async t=>{
 const f=fixture(t);f.arm();const env={...f.env,QA_AUTO_MODE:'automatic'},w=f.candidate;
 assert.equal((await w.fetch(req('/event',{type:'chat_message'}),env)).status,503);
 assert.equal((await w.fetch(req('/notice?uid=qa-nav-alice'),env)).status,503);
 assert.equal((await w.tick({...env,QA_PUSH_ENABLED:'false'})).result.reason,'trial_unavailable');
 assert.equal((await w.tick({...env,QA_AUTO_ACTIVATED_AT:String(f.activatedAt+1)})).result.reason,'trial_unavailable');
 assert.equal((await w.fetch(req('/v1/qa/conversations/example'),env)).status,503);
 assert.equal((await w.fetch(req('/tick'),env)).status,404);
 assert.deepEqual(f.stats(),{manual:0,network:0});
 f.sql.exec('DROP TABLE qa_auto_d1_trial_lab');
 assert.equal((await w.tick(env)).result.reason,'trial_unavailable');
 assert.equal((await w.fetch(validNotice(),env)).status,503);
});
test('lifetime trial reservations are atomic and independent of UTC reset',async t=>{
 const f=fixture(t);f.arm();
 const a=createD1TrialGate({db:f.db,activatedAt:f.activatedAt}),b=createD1TrialGate({db:f.db,activatedAt:f.activatedAt});
 for(const [kind,max] of [['tick',60],['notice',200]]){
  const results=await Promise.all(Array.from({length:max+5},(_,i)=>(i%2?a:b)(kind)));
  assert.equal(results.filter(x=>x===f.end).length,max);
  assert.equal(await a(kind),null);
 }
 assert.equal((await f.candidate.tick({...f.env,QA_AUTO_MODE:'automatic'})).result.reason,'trial_unavailable');
 assert.deepEqual(f.stats(),{manual:0,network:0});
});
test('trial stops before original deadline; no reactivation API or deletion',async t=>{
 const f=fixture(t);f.arm();const gate=createD1TrialGate({db:f.db,activatedAt:f.activatedAt});
 f.sql.prepare('UPDATE qa_auto_d1_trial_lab SET ends_at=?').run(Date.now()+60000);
 assert.equal(await gate('tick'),null);assert.ok(await gate('notice'));
 f.sql.prepare('UPDATE qa_auto_d1_trial_lab SET ends_at=?').run(Date.now()-1);
 assert.equal(await gate('notice'),null);
 assert.equal(await gate('tick'),null);
});
test('manual cannot resume until live outbox drains, expired records retained',async t=>{
 const f=fixture(t),now=Date.now(),s=Math.floor(now/1000),gen='00000000-0000-4000-8000-000000000001';
 f.sql.prepare("INSERT INTO qa_auto_d1_outbox_lab(event_key,activated_at,sender_uid,recipient_uid,message_id,sender_generation,recipient_generation,creation_seconds,creation_nanos,expires_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,'pending_transport')")
 .run('a'.repeat(64),f.activatedAt,'qa-nav-bob','qa-nav-alice','m1',gen,gen,s,0,now+60000);
 const env={...f.env,QA_AUTO_MODE:'manual'};
 assert.equal((await f.candidate.fetch(req('/notice'),env)).status,503);
 f.sql.exec('UPDATE qa_auto_d1_outbox_lab SET expires_at=1');
 assert.equal((await f.candidate.fetch(req('/notice'),env)).status,200);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM qa_auto_d1_outbox_lab').get().n,1);
});

test('malformed notice traffic cannot consume trial reservations or invoke provider',async t=>{
 const f=fixture(t);f.arm();const env={...f.env,QA_AUTO_MODE:'automatic'};
 for(let i=0;i<210;i++)assert.equal((await f.candidate.fetch(req('/notice'),env)).status,401);
 assert.equal(f.sql.prepare('SELECT notices FROM qa_auto_d1_trial_lab').get().notices,0);
 assert.deepEqual(f.stats(),{manual:0,network:0});
});
