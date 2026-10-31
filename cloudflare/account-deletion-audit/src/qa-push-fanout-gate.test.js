import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createQaPrivilegedWriteBarrier} from './qa-privileged-write-barrier.js';
import {runQaPushFanout} from './qa-push-fanout-gate.js';

const A='qa-freeze-alice', B='qa-freeze-bob';
const schema=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
const previousFlag=process.env.ATRIO_PRIVILEGED_QA_ONLY;
process.env.ATRIO_PRIVILEGED_QA_ONLY='true';
const event=(actor,recipients)=>({
  topic:'atrio_thread_qa_post',recipients,
  notice:{postId:'qa_post',replyId:'qa_reply',actorUid:actor,
    actorName:'QA',createdAt:'2026-10-31T12:00:00Z'}
});
async function fixture(run){
  const sql=new DatabaseSync(':memory:');
  sql.exec(schema);
  const adapter={
    prepare(text){return {
      bind(...args){return {
        async all(){return {results:sql.prepare(text).all(...args)};},
        async first(){return sql.prepare(text).get(...args)||null;}
      };}
    };}
  };
  const gate=createQaPrivilegedWriteBarrier(adapter);
  let requests=0;
  const persisted=[];
  let responseMode='success';
  const transport=async(url,init)=>{
    requests++;
    assert.equal(new URL(url).hostname,'firestore.googleapis.com');
    const writes=JSON.parse(init.body).writes;
    if(responseMode==='timeout')throw Error('qa_mock_firestore_network_timeout');
    if(responseMode==='partial')return new Response(
      JSON.stringify({status:[{}, {code:7,message:'permission denied'}]}),
      {status:200});
    for(const write of writes){
      const parts=write.update.name.split('/');
      persisted.push(parts[parts.length-3]); // "users/{uid}/notifications/{id}"
    }
    return new Response(JSON.stringify({status:writes.map(()=>({}))}),
      {status:200});
  };
  const verifyRecipients=async requested=>[...new Set(persisted.filter(uid=>
    requested.includes(uid)))];
  try{await run({gate,sql,transport,verifyRecipients,
    captured:()=>({requests,persisted:[...persisted]}),
    mode:next=>{responseMode=next;}});}
  finally{sql.close();}
}
test('two-recipient batch acquires ONE atomic ticket for actor and both owners',async()=>{
  await fixture(async({gate,transport,verifyRecipients,captured})=>{
    const result=await runQaPushFanout(gate,event(A,[A,B]),{
      transport,verifyRecipients});
    assert.equal(result.productionReady,false);
    assert.deepEqual(captured(),{requests:1,persisted:[A,B]});
    assert.deepEqual(await gate.status(A),{state:'active',inFlight:0});
    assert.deepEqual(await gate.status(B),{state:'active',inFlight:0});
  });
});
test('frozen recipient rejects entire batch: no writes, no tickets for actor',async()=>{
  await fixture(async({gate,transport,verifyRecipients,captured})=>{
    await gate.beginFreeze(B);
    await assert.rejects(runQaPushFanout(gate,event(A,[A,B]),{
      transport,verifyRecipients}),/qa_privileged_write_blocked/);
    assert.deepEqual(captured(),{requests:0,persisted:[]});
    assert.deepEqual(await gate.status(A),{state:'active',inFlight:0});
    assert.equal(await gate.finalizeFreeze(B),'frozen');
    await runQaPushFanout(gate,event(A,[A]),{
      transport,verifyRecipients});
    assert.deepEqual(captured(),{requests:1,persisted:[A]});
  });
});
test('frozen actor also blocks the same fanout even when recipients are active',async()=>{
  await fixture(async({gate,transport,verifyRecipients,captured})=>{
    await gate.beginFreeze(A);
    await assert.rejects(runQaPushFanout(gate,event(A,[B]),{
      transport,verifyRecipients}),/qa_privileged_write_blocked/);
    assert.equal(captured().requests,0);
    assert.equal((await gate.status(B)).inFlight,0);
  });
});
test('in-flight multi-recipient batch prevents final freeze until remote verification',async()=>{
  await fixture(async({gate,verifyRecipients,captured})=>{
    let ready,resume;
    const started=new Promise(resolve=>{ready=resolve;});
    const permit=new Promise(resolve=>{resume=resolve;});
    const transport=async(url,init)=>{
      ready();
      await permit;
      const writes=JSON.parse(init.body).writes;
      const owners=writes.map(w=>w.update.name.split('/').at(-3));
      for(const uid of owners)received.push(uid);
      return new Response(JSON.stringify({status:writes.map(()=>({}))}),{status:200});
    };
    const received=[];
    const verify=async()=>[...received];
    const inflight=runQaPushFanout(gate,event(A,[A,B]),{
      transport,verifyRecipients:verify});
    await started;
    assert.equal((await gate.status(A)).inFlight,1);
    assert.equal((await gate.status(B)).inFlight,1);
    assert.equal(await gate.beginFreeze(B),'draining');
    await assert.rejects(gate.finalizeFreeze(B),/qa_inflight_or_not_draining/);
    resume();
    await inflight;
    assert.equal(await gate.finalizeFreeze(B),'frozen');
    assert.equal((await gate.status(A)).inFlight,0);
  });
});
test('partial response leaves ticket on BOTH accounts and prevents false freeze',async()=>{
  await fixture(async({gate,transport,verifyRecipients,captured,mode})=>{
    mode('partial');
    await assert.rejects(runQaPushFanout(gate,event(A,[A,B]),{
      transport,verifyRecipients}),/thread_fanout_partial/);
    assert.equal(captured().requests,1);
    assert.deepEqual(captured().persisted,[]);
    assert.equal((await gate.status(A)).inFlight,1);
    assert.equal((await gate.status(B)).inFlight,1);
    await gate.beginFreeze(B);
    await assert.rejects(gate.finalizeFreeze(B),/qa_inflight_or_not_draining/);
  });
});
test('timeout also leaves a pending operation and zero false confirmations',async()=>{
  await fixture(async({gate,transport,verifyRecipients,captured,mode})=>{
    mode('timeout');
    await assert.rejects(runQaPushFanout(gate,event(A,[A,B]),{
      transport,verifyRecipients}),/qa_mock_firestore_network_timeout/);
    assert.equal(captured().requests,1);
    assert.equal((await gate.status(A)).inFlight,1);
    assert.equal((await gate.status(B)).inFlight,1);
  });
});
test('incomplete independent recipient verification retains both in-flight locks',async()=>{
  await fixture(async({gate,transport,captured})=>{
    await assert.rejects(runQaPushFanout(gate,event(A,[A,B]),{
      transport,verifyRecipients:async()=>[A]
    }),/qa_unverified_external_effect/);
    assert.deepEqual(captured().persisted,[A,B]);
    assert.equal((await gate.status(A)).inFlight,1);
    assert.equal((await gate.status(B)).inFlight,1);
  });
});
test('forged recipients or environment are rejected before any outgoing call',async()=>{
  await fixture(async({gate,transport,verifyRecipients,captured})=>{
    for(const e of [event(A,[]),event(A,[A,A]),event(A,[A,'real-user']),
      event('real-user',[B]),event(A,[A,B,'other']),{
      ...event(A,[A,B]),topic:'prod_topic'
    }]){
      await assert.rejects(runQaPushFanout(gate,e,{
        transport,verifyRecipients}),/qa_fanout_invalid_event/);
    }
    const prior=process.env.ATRIO_PRIVILEGED_QA_ONLY;
    process.env.ATRIO_PRIVILEGED_QA_ONLY='false';
    try{
      await assert.rejects(runQaPushFanout(gate,event(A,[A,B]),{
        transport,verifyRecipients}),/qa_fanout_unsafe_environment/);
    }finally{process.env.ATRIO_PRIVILEGED_QA_ONLY=prior;}
    assert.equal(captured().requests,0);
    assert.equal((await gate.status(A)).inFlight,0);
    assert.equal((await gate.status(B)).inFlight,0);
  });
});
// node:test executes test bodies asynchronously AFTER module evaluation.
// Restore the QA flag only when every case has completed.
after(()=>{
  if(previousFlag===undefined)delete process.env.ATRIO_PRIVILEGED_QA_ONLY;
  else process.env.ATRIO_PRIVILEGED_QA_ONLY=previousFlag;
});
