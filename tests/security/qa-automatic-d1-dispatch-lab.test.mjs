import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createD1DispatchLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-dispatch-lab.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
const key='a'.repeat(64),claimId='00000000-0000-4000-8000-000000000001',chat='qa-nav-alice__qa-nav-bob';
const marker='chat:'+chat+':m1:qa-nav-alice';
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec('CREATE TABLE delivered(event_key TEXT PRIMARY KEY,created_at INTEGER NOT NULL)');
 let state='pending_transport',sends=0,checks=0,lists=0,attempts=0;
 const flags={revoked:false,deviceChanged:false,more:false,unknown:false,badReceipt:false,denied:false};
 const notice={status:'authorized_lab',eventKey:key,claimId,conversationId:chat,messageId:'m1',senderUid:'qa-nav-bob',recipientUid:'qa-nav-alice',expiresAt:Date.now()+30000};
 const db={prepare(q){return {bind(...args){return {async run(){const r=sql.prepare(q).run(...args);return {success:true,meta:{changes:r.changes}}}}}}}};
 const outbox={async claim(k){if(k!==key||state!=='pending_transport')return {status:'ignored',reason:'not_pending'};state='claimed_lab';return {status:state,eventKey:k,claimId}},
  async authorizeClaim(){checks++;return flags.revoked&&checks>1?{status:'ignored'}:notice},
  async finish({outcome}){state=outcome;return {status:'terminal_lab'}}};
 const make=(over={})=>createD1DispatchLab({enabled:true,db,outbox,reserveAttempt:async()=>{attempts++;return !flags.denied},
  listDevices:async()=>{lists++;const d={token:flags.deviceChanged&&lists>1?'different-device-token':'synthetic-not-an-fcm-token',path:'users/qa-nav-alice/pushDevices/fake',updateTime:'2026-11-26T12:00:00Z',time:notice.expiresAt-30000};return flags.more?[d,d]:[d]},
  sendRefresh:async msg=>{sends++;assert.deepEqual(msg.data,{signal:'refresh'});assert.ok(Number.parseInt(msg.android.ttl)<=30);if(flags.unknown)throw Error('lost');return Response.json({name:'projects/'+(flags.badReceipt?'wrong':identity.projectId)+'/messages/fixture'})},...over});
 return {sql,flags,make,stats:()=>({state,sends,checks,attempts})};
}
test('closed by default and budget denial before claim',async t=>{
 const f=fixture(t);assert.equal((await f.make({enabled:false})(key)).reason,'invalid_or_disabled');
 f.flags.denied=true;assert.equal((await f.make()(key)).reason,'transport_budget_unavailable');
 assert.deepEqual(f.stats(),{state:'pending_transport',sends:0,checks:0,attempts:1});
});
test('shared marker and exclusive claim allow one signal with bounded TTL',async t=>{
 const f=fixture(t),send=f.make(),results=await Promise.all([send(key),send(key)]);
 assert.equal(results.filter(x=>x.transportStatus==='accepted_simulated').length,1);
 assert.equal(f.stats().sends,1);assert.equal(f.stats().state,'accepted_simulated');
 assert.equal(f.sql.prepare('SELECT event_key FROM delivered').get().event_key,marker);
});
test('existing manual marker prevents automatic send',async t=>{
 const f=fixture(t);f.sql.prepare('INSERT INTO delivered VALUES(?,?)').run(marker,Date.now());
 assert.equal((await f.make()(key)).transportStatus,'duplicate');assert.equal(f.stats().sends,0);
});
for(const flag of ['revoked','deviceChanged','more','unknown','badReceipt']){
 test('never retries after '+flag,async t=>{
  const f=fixture(t);f.flags[flag]=true;const send=f.make();await send(key);
  assert.equal(f.stats().sends,['unknown','badReceipt'].includes(flag)?1:0);
  assert.equal(f.stats().state,['unknown','badReceipt'].includes(flag)?'unknown':'rejected_simulated');
  assert.equal((await send(key)).reason,'not_pending');
 });
}
