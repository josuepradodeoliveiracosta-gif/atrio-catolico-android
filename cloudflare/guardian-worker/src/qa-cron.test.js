import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
const safe={
 GUARDIAN_V2_TEST_MODE:'true',
 GUARDIAN_V2_ENABLED:'false',
 GUARDIAN_V2_HOLD_ENABLED:'false',
 GUARDIAN_V2_QA_SHADOW_READS:'false',
 GUARDIAN_V2_QA_POLICY_HEARTBEAT:'true',
 GUARDIAN_V2_QA_RUN_MONITOR:'false',
 GUARDIAN_V2_QA_AUTO_DISPATCH:'false',
 GUARDIAN_QA_DISPATCH_READY:'false'
};
test('Cloudflare cron QA: autocheck sintético, sem commits, subrequests ou segredos',async()=>{
 const entries=[],waiting=[];
 const log=console.log;
 console.log=(...args)=>entries.push(args);
 try{
  await worker.scheduled({scheduledTime:Date.parse('2026-10-29T20:15:00Z')},safe,{
   waitUntil:p=>waiting.push(p)
  });
 }finally{console.log=log;}
 assert.equal(waiting.length,0);
 assert.ok(entries.some(([k,v])=>k==='guardian_v2_qa_policy_heartbeat'&&
   JSON.parse(v).status==='passed'&&JSON.parse(v).checks===5));
 assert.ok(entries.some(([k])=>k==='guardian_v2_qa_cron_tick'));
 assert.ok(!JSON.stringify(entries).includes('https://'));
});
test('Cloudflare cron QA com heartbeat desabilitado não afirma sucesso',async()=>{
 const entries=[],log=console.log;
 console.log=(...args)=>entries.push(args);
 try{
  await worker.scheduled({scheduledTime:Date.parse('2026-10-29T20:15:00Z')},{
   ...safe,GUARDIAN_V2_QA_POLICY_HEARTBEAT:'false'
  },{waitUntil:()=>{throw Error('no network expected')}});
 }finally{console.log=log;}
 assert.equal(entries.some(([k])=>k==='guardian_v2_qa_policy_heartbeat'),false);
});
test('QA cron não invoca moderação com ENABLED ou HOLD ligados',async()=>{
 for(const patch of [{GUARDIAN_V2_ENABLED:'true'},{GUARDIAN_V2_HOLD_ENABLED:'true'}]){
  const entries=[],log=console.log;
  console.log=(...args)=>entries.push(args);
  try{
   await worker.scheduled({scheduledTime:Date.parse('2026-10-29T20:15:00Z')},{
    ...safe,...patch
   },{waitUntil:()=>{throw Error('unexpected external work')}});
  }finally{console.log=log;}
  assert.equal(entries.some(([k])=>k==='guardian_v2_qa_policy_heartbeat'),false);
 }
});
