import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {D1_OUTBOX_LAB_SCHEMA,createD1OutboxLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-outbox-lab.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
const {projectId,databaseId,roundId,ageMode}=identity;
const alice='qa-nav-alice',bob='qa-nav-bob',chat=alice+'__'+bob;
const gen=i=>'00000000-0000-4000-8000-00000000000'+i;
const bridge=(db,lose=null)=>({prepare(sql){return {bind(...args){return {
 async run(){const r=db.prepare(sql).run(...args);if(lose?.(sql))throw Error('lost_after_write');return {success:true,meta:{changes:r.changes}}},
 async first(){return db.prepare(sql).get(...args)??null}
}}}}});
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'atrio-d1-outbox-')),file=join(dir,'db.sqlite');
 const db=new DatabaseSync(file);db.exec(D1_OUTBOX_LAB_SCHEMA);
 const now=Date.now(),activatedAt=now-30000,created=now-1000;
 db.prepare('INSERT INTO qa_auto_d1_activation_lab VALUES(1,?,1)').run(activatedAt);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true})});
 const state={blocked:false,manual:false,revoked:false,stale:false,wrongStamp:false};
 function candidate(messageId='m1',sender=bob){
  return {status:'candidate',deadline:created+120000,event:{type:'created',projectId,databaseId,chatId:chat,messageId,
   expectedCreateTime:{seconds:Math.floor(created/1000),nanoseconds:(created%1000)*1000000}},sender};
 }
 let sender=bob;
 const readAuthorization=async({event})=>{
  const recipient=sender===bob?alice:bob,accounts={},admissions={},eligibility={};
  for(const [i,u] of [alice,bob].entries()){
   accounts[u]={uid:u,email:identity.accounts[u],emailVerified:true,disabled:false};
   admissions[u]={status:state.revoked&&u===bob?'revoked':'active',email:identity.accounts[u],roundId,generation:gen(i),admittedAt:created-2000,expiresAt:null};
   eligibility[u]={status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',updatedAt:created-3000,reviewExpiresAt:created+300000};
  }
  return {now:Date.now()-(state.stale?10000:0),creation:{...event.expectedCreateTime,nanoseconds:event.expectedCreateTime.nanoseconds+(state.wrongStamp?1:0)},
   snapshot:{projectId,databaseId,chatId:chat,messageId:event.messageId,managedBoundary:false,
    config:{enabled:true,qaSimpleDirectEnabled:true,minorPolicyApproved:true,version:'2026-11-v1',safetyReviewVersion:'2026-11-safety-v1',
     pushPilot:{enabled:true,projectId,databaseId,roundId,ageMode,expiresAt:null}},
    room:{status:'accepted',lastMessageId:event.messageId,lastSenderUid:sender,participants:[alice,bob],requesterUid:alice,recipientUid:bob,
     unreadRequester:sender===bob?1:0,unreadRecipient:sender===alice?1:0},
    message:{uid:sender,kind:'text',createdAt:created},accounts,admissions,eligibility,blocked:{[alice]:state.blocked,[bob]:false},
    muted:false,deviceEligible:true,receipt:null,pending:state.manual?{unread:true,expiresAt:Date.now()+30000}:null}};
 };
 const make=(opts={})=>createD1OutboxLab({db:bridge(db),enabled:true,activatedAt,readAuthorization,...opts});
 return {db,file,state,candidate,make,activatedAt,reverse:()=>{sender=alice},row:k=>db.prepare('SELECT * FROM qa_auto_d1_outbox_lab WHERE event_key=?').get(k)};
}
test('disabled, missing activation, old and wrong project make no publication',async t=>{
 const f=fixture(t);
 assert.equal((await f.make({enabled:false}).publish(f.candidate())).reason,'automation_disabled');
 assert.equal((await f.make({activatedAt:f.activatedAt+1}).publish(f.candidate())).status,'ignored');
 const c=f.candidate();c.event.projectId='prod';assert.equal((await f.make().publish(c)).reason,'invalid_candidate');
 const old=f.candidate();old.event.expectedCreateTime.seconds-=60;assert.equal((await f.make().publish(old)).reason,'invalid_candidate');
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM qa_auto_d1_outbox_lab').get().n,0);
});
test('atomic slot, exact event uniqueness, competing connections and restart',async t=>{
 const f=fixture(t),other=new DatabaseSync(f.file);t.after(()=>other.close());
 const a=f.make(),b=f.make({db:bridge(other)});
 const results=await Promise.all([a.publish(f.candidate('one')),b.publish(f.candidate('two'))]);
 const winner=results.find(r=>r.status==='published_lab');assert.ok(winner);assert.equal(results.filter(r=>r.status==='published_lab').length,1);
 const claims=await Promise.all([a.claim(winner.eventKey),b.claim(winner.eventKey)]);
 const c=claims.find(x=>x.status==='claimed_lab');assert.ok(c);assert.equal(claims.filter(x=>x.status==='claimed_lab').length,1);
 assert.equal((await b.authorizeClaim(c)).status,'authorized_lab');
 assert.equal((await a.finish({...c,claimId:gen(9),outcome:'accepted_simulated'})).reason,'claim_mismatch');
 assert.equal((await b.finish({...c,outcome:'accepted_simulated'})).status,'terminal_lab');
 assert.equal(f.row(winner.eventKey).state,'accepted_simulated');
 assert.equal((await a.claim(winner.eventKey)).reason,'not_pending');
 assert.equal((await a.publish(f.candidate(f.row(winner.eventKey).message_id))).status,'ignored');
 assert.equal((await b.readNotice(alice)).status,'notice_lab');
 assert.equal((await b.readNotice(bob)).reason,'no_notice');
});
test('both directions independently occupy their recipient slot',async t=>{
 const f=fixture(t),s=f.make();
 assert.equal((await s.publish(f.candidate('one'))).status,'published_lab');
 f.reverse();
 assert.equal((await s.publish(f.candidate('two'))).status,'published_lab');
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM qa_auto_d1_outbox_lab').get().n,2);
});
for(const mode of ['blocked','manual','revoked','stale','wrongStamp']){
 test('publication fails closed for '+mode,async t=>{
  const f=fixture(t);f.state[mode]=true;
  assert.equal((await f.make().publish(f.candidate())).status,'ignored');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM qa_auto_d1_outbox_lab').get().n,0);
 });
}
test('revalidation at claim, pre-send and notice; no re-send after unknown',async t=>{
 const f=fixture(t),s=f.make(),p=await s.publish(f.candidate());
 assert.equal(p.status,'published_lab');
 f.state.revoked=true;assert.equal((await s.claim(p.eventKey)).reason,'authorization_changed');
 f.state.revoked=false;const c=await s.claim(p.eventKey);assert.equal(c.status,'claimed_lab');
 f.state.manual=true;assert.equal((await s.authorizeClaim(c)).reason,'authorization_changed');
 assert.equal((await s.readNotice(alice)).reason,'authorization_changed');
 f.state.manual=false;assert.equal((await s.authorizeClaim(c)).status,'authorized_lab');
 assert.equal((await s.finish({...c,outcome:'unknown'})).status,'terminal_lab');
 assert.equal(f.row(p.eventKey).state,'unknown');
 assert.equal((await s.claim(p.eventKey)).reason,'not_pending');assert.equal((await s.readNotice(alice)).reason,'no_notice');
});
test('durable activation disables recovery and forces terminal unknown',async t=>{
 const f=fixture(t),s=f.make(),p=await s.publish(f.candidate()),c=await s.claim(p.eventKey);
 assert.equal(c.status,'claimed_lab');
 f.db.exec('UPDATE qa_auto_d1_activation_lab SET enabled=0');
 assert.equal((await s.authorizeClaim(c)).status,'ignored');
 assert.equal((await s.readNotice(alice)).status,'ignored');
 assert.equal((await s.finish({...c,outcome:'accepted_simulated'})).status,'terminal_lab');
 assert.equal(f.row(p.eventKey).state,'unknown');
});
test('deadline cannot be renewed, expired claim stays terminal',async t=>{
 const f=fixture(t),s=f.make(),c=f.candidate();c.deadline+=1;
 assert.equal((await s.publish(c)).reason,'invalid_candidate');
 const p=await s.publish(f.candidate()),claim=await s.claim(p.eventKey);
 assert.equal(claim.status,'claimed_lab');
 f.db.prepare('UPDATE qa_auto_d1_outbox_lab SET expires_at=? WHERE event_key=?').run(Date.now()-1,p.eventKey);
 assert.equal((await s.authorizeClaim(claim)).status,'ignored');
 assert.equal((await s.expireClaim(p.eventKey)).status,'unknown');
 assert.equal((await s.claim(p.eventKey)).reason,'not_pending');
});
test('ambiguous publication can recover exact unclaimed record; ambiguous claim never reclaims',async t=>{
 const f=fixture(t),s=f.make({db:bridge(f.db,q=>q.startsWith('INSERT INTO qa_auto_d1_outbox_lab'))});
 assert.equal((await s.publish(f.candidate())).status,'publication_unknown_lab');
 const r=f.db.prepare('SELECT event_key FROM qa_auto_d1_outbox_lab').get();
 const lost=f.make({db:bridge(f.db,q=>q.startsWith("UPDATE qa_auto_d1_outbox_lab SET state='claimed_lab'"))});
 assert.equal((await lost.claim(r.event_key)).status,'claim_unknown_lab');
 assert.equal((await f.make().claim(r.event_key)).reason,'not_pending');
 assert.equal(f.row(r.event_key).state,'claimed_lab');
});
