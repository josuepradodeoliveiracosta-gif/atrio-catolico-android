import test from 'node:test';
import assert from 'node:assert/strict';
import {createFreeScheduledTickLab,FREE_SCHEDULED_ENVELOPE as envelope} from '../../cloudflare/push-worker/scripts/qa-automatic-free-scheduled-lab.mjs';
const eventKey='a'.repeat(64),candidate={status:'candidate',deadline:1800000000000,event:{}};
function fixture(){
 const calls=[];let exists=false,eligible=true;
 const deps={enabled:true,activatedAt:1799999900000,
  discover:async()=>{calls.push('discover');return eligible?candidate:{status:'ignored',reason:'expired'}},
  recover:async()=>{calls.push('recover');return exists?{status:'published_lab',eventKey}:{status:'absent_lab'}},
  publish:async()=>{calls.push('publish');exists=true;return {status:'published_lab',eventKey}},
  transport:async p=>{calls.push('transport');assert.equal(p.eventKey,eventKey);return {status:'accepted_simulated'}}};
 return {deps,calls,expire:()=>{eligible=false}};
}
test('phase maxima leave credential allowance and prohibit combined path',()=>{
 assert.equal(envelope.publish,13);
 assert.equal(envelope.recoverAndTransport,50);
 assert.equal(envelope.prohibitedCombined,58);
});
test('fresh publication never transports on same tick; restart recovers on later tick',async()=>{
 const f=fixture();
 assert.equal((await createFreeScheduledTickLab(f.deps)()).status,'published_waiting_next_tick_lab');
 assert.deepEqual(f.calls,['discover','recover','publish']);
 assert.equal((await createFreeScheduledTickLab(f.deps)()).status,'accepted_simulated');
 assert.deepEqual(f.calls,['discover','recover','publish','discover','recover','transport']);
});
test('expired or superseded candidate does not transport',async()=>{
 const f=fixture();
 await createFreeScheduledTickLab(f.deps)();f.expire();
 assert.equal((await createFreeScheduledTickLab(f.deps)()).reason,'expired');
 assert.equal(f.calls.includes('transport'),false);
});
test('uncertain commit and unavailable recovery do not dispatch',async()=>{
 const f=fixture();
 const tick=createFreeScheduledTickLab({...f.deps,publish:async()=>({status:'publication_unknown_lab'})});
 assert.equal((await tick()).status,'publication_unknown_lab');
 const blocked=createFreeScheduledTickLab({...f.deps,recover:async()=>({status:'ignored',reason:'recovery_unavailable'})});
 assert.equal((await blocked()).reason,'recovery_unavailable');
 assert.equal(f.calls.includes('transport'),false);
});
test('disabled or missing activation makes no calls',async()=>{
 const f=fixture();
 assert.equal((await createFreeScheduledTickLab({...f.deps,enabled:false})()).reason,'automation_disabled');
 assert.equal((await createFreeScheduledTickLab({...f.deps,activatedAt:null})()).reason,'automation_disabled');
 assert.deepEqual(f.calls,[]);
});
