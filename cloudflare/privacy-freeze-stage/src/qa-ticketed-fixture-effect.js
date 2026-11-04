/**
 * QA-ONLY fixture effect boundary. NOT imported by any deployed Worker.
 *
 * The Service Binding must grant a persistent D1 ticket BEFORE a synthetic
 * fixture effect can execute. Effect completion NEVER automatically closes
 * its ticket. A different reconciler role must independently read back the
 * fixture and close the ticket; uncertain results remain pending and block
 * freeze finalization. No external provider SDK or global fetch is used.
 *
 * The injected store must ONLY write QA fixtures. This module is not a
 * sandbox for arbitrary callbacks, and does not authorize live user writes.
 */
import {qaStageWriteGrant} from './write-route-grants.js';

const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const deny=()=>{throw Error('qa_fixture_effect_denied')};
const strict=value=>value!==null&&typeof value==='object'&&
  !Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;

export async function runQaTicketedFixtureEffect({
  client,role,route,scope,fixtureStore
}={}){
  const grant=qaStageWriteGrant(role,{route,scope});
  if(!grant||typeof client?.request!=='function'||
     typeof fixtureStore?.applyFixture!=='function')deny();

  // First cross the private HMAC + D1 admission boundary; never begin an
  // external-looking fixture mutation on a denied or unknown response.
  const result=await client.request('writeAdmit',{route,scope});
  if(!strict(result)||
     Object.keys(result).sort().join(',')!=='operationId,status'||
     result.status!=='stage_admitted'||!ID.test(result.operationId))deny();

  const evidence=Object.freeze({
    operationId:result.operationId,role,route,
    kind:grant.kind,scope:grant.scope
  });
  // The adapter persists a synthetic effect using operationId as an
  // idempotency key. It MUST NOT be replayed by this coordinator on failure.
  // If this throws or returns uncertain output, the D1 ticket stays open.
  const outcome=await fixtureStore.applyFixture(evidence);
  if(!strict(outcome)||Object.keys(outcome).sort().join(',')!=='status'||
     outcome.status!=='qa_fixture_applied')deny();
  return Object.freeze({
    status:'qa_fixture_effect_pending_reconciliation',
    operationId:result.operationId,role,route,
    productionReady:false,externalProviderEffectVerified:false,
    accountDeletionHomologated:false
  });
}

/**
 * Must be invoked independently from the fixture writer, with a separate
 * reconciler HMAC identity and a fresh readback. A false/uncertain readback
 * cannot consume the D1 ticket or allow freeze to finalize.
 */
export async function reconcileQaTicketedFixtureEffect({
  reconciler,operationId,independentReadback
}={}){
  if(typeof reconciler?.request!=='function'||!ID.test(operationId)||
     typeof independentReadback!=='function')deny();
  if(await independentReadback(operationId)!==true)
    throw Error('qa_fixture_readback_unverified');
  const result=await reconciler.request('close',{
    operationId,fixtureEvidence:'demo-confirmed'
  });
  if(!strict(result)||result.status!=='stage_reconciled')deny();
  return Object.freeze({
    status:'qa_fixture_ticket_reconciled',
    productionReady:false,realProviderDeleted:false,
    accountDeletionHomologated:false
  });
}
export const QA_FIXTURE_EFFECT_READINESS=Object.freeze({
  privateHmacTicketRequired:true,independentReadbackRequired:true,
  automaticTicketRelease:false,autoRetryOnUnknownResult:false,
  productionIntegrated:false,externalProvidersSupported:false
});
