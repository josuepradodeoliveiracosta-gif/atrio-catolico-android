import test from 'node:test';
import assert from 'node:assert/strict';
import {planPublicationRetry as plan} from '../../firebase/qa-geral-celular/pilot/conversation-push-automatic-retry-plan.mjs';
const now=1800000000000;
const input={now,attempts:0,originalDeadline:now+120000,pendingExpiresAt:now+30000,
 decision:{status:'defer',reason:'active_pending',retryBefore:now+110000}};
test('deferred event schedules after pending expiry, within original window',()=>{
 assert.deepEqual(plan(input),{status:'schedule',nextAt:now+30000,deadline:now+110000,attempt:1});
});
test('never extend prior deadline even if a later decision allows more',()=>{
 assert.equal(plan({...input,originalDeadline:now+40000}).deadline,now+40000);
 assert.equal(plan({...input,originalDeadline:now+39999}).reason,'insufficient_original_window');
});
test('maximum three scheduled retries, never after claim or unknown outcome',()=>{
 assert.equal(plan({...input,attempts:2}).attempt,3);
 assert.equal(plan({...input,attempts:3}).reason,'invalid_or_exhausted_budget');
 assert.equal(plan({...input,claimed:true}).reason,'claim_or_transport_started');
 for(const status of ['unknown','accepted_simulated','ignored','candidate','claimed_lab'])
  assert.equal(plan({...input,decision:{status}}).reason,'not_retryable');
});
test('invalid time and expired pending cannot cause tight loop',()=>{
 assert.equal(plan({...input,pendingExpiresAt:null}).status,'stop');
 assert.equal(plan({...input,pendingExpiresAt:now-1}).nextAt,now+1000);
});
