import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createD1ModeLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-mode-lab.mjs';
import {D1_OUTBOX_LAB_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-outbox-lab.mjs';
const request=(path,method='GET')=>new Request('https://qa.invalid'+path,{method});
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec(D1_OUTBOX_LAB_SCHEMA);
 const activatedAt=Date.now()-10000;
 sql.prepare('INSERT INTO qa_auto_d1_activation_lab VALUES(1,?,0)').run(activatedAt);
 const db={prepare(q){return {bind(...args){return {async first(){return sql.prepare(q).get(...args)??null},
 async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:r.changes}}}}}}}};
 const env={PUSH_DB:db,PUSH_ENABLED:'true',FIREBASE_WEB_API_KEY:'fixture',FIREBASE_SERVICE_ACCOUNT_JSON:'fixture'};
 let manual=0,auth=0;
 const make=(over={})=>createD1ModeLab({db,activatedAt,manualWorker:{async fetch(){manual++;return new Response('manual')}},
  verifyIdentity:async()=>{auth++;return null},readAuthorization:async()=>{throw Error('unexpected')},
  listDevices:async()=>[],sendRefresh:async()=>{throw Error('unexpected')},reserveAttempt:async()=>false,...over});
 return {sql,env,make,activatedAt,stats:()=>({manual,auth})};
}
test('default manual delegates only when persisted automatic mode is disarmed',async t=>{
 const f=fixture(t),w=f.make();
 assert.equal(await (await w.fetch(request('/event','POST'),f.env)).text(),'manual');
 f.sql.exec('UPDATE qa_auto_d1_activation_lab SET enabled=1');
 assert.equal((await w.fetch(request('/notice'),f.env)).status,503);
 assert.equal(f.stats().manual,1);
});
test('automatic blocks public event and never falls back to manual on missing notice',async t=>{
 const f=fixture(t);f.sql.exec('UPDATE qa_auto_d1_activation_lab SET enabled=1');
 const w=f.make({mode:'automatic',verifyIdentity:async()=> 'qa-nav-alice'});
 assert.equal((await w.fetch(request('/event','POST'),f.env)).status,503);
 assert.equal((await w.fetch(request('/notice'),f.env)).status,404);
 assert.equal((await w.fetch(request('/notice?uid=qa-nav-bob'),f.env)).status,404);
 assert.equal(f.stats().manual,0);
});
test('automatic refuses unauthenticated, disabled, mismatched epoch and binding',async t=>{
 const f=fixture(t),w=f.make({mode:'automatic'});
 assert.equal((await w.fetch(request('/notice'),f.env)).status,503);
 f.sql.exec('UPDATE qa_auto_d1_activation_lab SET enabled=1');
 assert.equal((await w.fetch(request('/notice'),f.env)).status,401);
 assert.equal((await w.fetch(request('/notice'),{...f.env,PUSH_DB:{}})).status,503);
 assert.equal((await w.fetch(request('/notice'),{...f.env,PUSH_ENABLED:'false'})).status,503);
 assert.equal((await f.make({mode:'automatic',activatedAt:f.activatedAt+1}).fetch(request('/notice'),f.env)).status,503);
 assert.equal((await w.fetch(request('/notice'),{...f.env,FIREBASE_WEB_API_KEY:''})).status,503);
 assert.equal(f.stats().auth,1);
});
test('mode change during authentication closes notice',async t=>{
 const f=fixture(t);f.sql.exec('UPDATE qa_auto_d1_activation_lab SET enabled=1');
 const w=f.make({mode:'automatic',verifyIdentity:async()=>{f.sql.exec('UPDATE qa_auto_d1_activation_lab SET enabled=0');return 'qa-nav-alice'}});
 assert.equal((await w.fetch(request('/notice'),f.env)).status,503);
 assert.equal(f.stats().manual,0);
});
test('manual switch requires expiry of every outstanding auto slot',async t=>{
 const f=fixture(t),s=Math.floor(Date.now()/1000),expires=s*1000+60000;
 const gen='00000000-0000-4000-8000-000000000001';
 f.sql.prepare("INSERT INTO qa_auto_d1_outbox_lab(event_key,activated_at,sender_uid,recipient_uid,message_id,sender_generation,recipient_generation,creation_seconds,creation_nanos,expires_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,'pending_transport')")
  .run('a'.repeat(64),f.activatedAt,'qa-nav-bob','qa-nav-alice','m1',gen,gen,s,0,expires);
 const w=f.make();
 assert.equal((await w.fetch(request('/event','POST'),f.env)).status,503);
 f.sql.exec('UPDATE qa_auto_d1_outbox_lab SET expires_at=1');
 assert.equal(await (await w.fetch(request('/event','POST'),f.env)).text(),'manual');
});
