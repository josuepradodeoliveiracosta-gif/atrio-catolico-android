/**
 * Shared, durable SQLite fixture coordinator for three ORIGINAL Workers in QA.
 * The *same* adapter/ledger must be passed to Avatar, Guardian, and Push.
 * DO NOT wire to live service bindings or actual user UIDs.
 *
 * Fencing is atomic across all participating UIDs; a failed or unknown
 * external effect leaves the ticket in the ledger, preventing final freeze.
 * This is NOT a production authorization service or distributed protocol.
 */
import {createQaPrivilegedWriteBarrier}
  from './qa-privileged-write-barrier.js';

const ALLOWED=Object.freeze({
  avatar:{kind:'avatar_upload',keys:['ownerUid']},
  guardian:{kind:'guardian_content_write',keys:['ownerUid']},
  push:{kind:'push_fcm_send',keys:['actorUid','recipientUid']}
});
const UIDS=new Set(['qa-freeze-alice','qa-freeze-bob']);
const deny=()=>{throw Error('qa_shared_freeze_denied');};
function normalizedScope(service,scope){
  const spec=ALLOWED[service];
  if(!spec||!scope||typeof scope!=='object'||Array.isArray(scope)||
     Object.keys(scope).sort().join(',')!==[...spec.keys].sort().join(','))
    deny();
  for(const key of spec.keys)if(!UIDS.has(scope[key]))deny();
  if(spec.keys.length===2 && scope.actorUid===scope.recipientUid)deny();
  return Object.freeze(Object.fromEntries(spec.keys.map(k=>[k,scope[k]])));
}
export function createQaSharedFreezeCoordinator(db){
  const barrier=createQaPrivilegedWriteBarrier(db);
  const api=Object.freeze({
    beginFreeze:uid=>barrier.beginFreeze(uid),
    finalizeFreeze:uid=>barrier.finalizeFreeze(uid),
    status:uid=>barrier.status(uid),
    forService(service){
      if(!Object.hasOwn(ALLOWED,service))deny();
      const {kind}=ALLOWED[service];
      return Object.freeze({
        async execute(scope,{effect,verify}={}){
          const admitted=normalizedScope(service,scope);
          if(typeof effect!=='function'||typeof verify!=='function')deny();
          // Begin before any simulated external I/O, across all involved
          // UIDs in one conditional SQLite INSERT SELECT.
          const ticket=await barrier.begin(kind,admitted);
          const output=await effect(Object.freeze({...admitted}));
          const ok=await verify(Object.freeze({...admitted}),output);
          if(ok!==true)throw Error('qa_shared_freeze_unverified');
          // A verification failure must leave the admission unresolved.
          await barrier.complete(ticket,{verified:async()=>true});
          return Object.freeze({status:'qa_shared_fixture_verified',
            productionIntegrated:false});
        }
      });
    }
  });
  return api;
}
export const QA_SHARED_FREEZE_READINESS=Object.freeze({
  productionIntegrated:false,realIAM:false,sharedFixtureLedger:true,
  serviceConsumers:3,realAccountDeletionAllowed:false
});
