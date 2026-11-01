/**
 * Optional fail-closed *whole-Worker* QA seal for the executable Push Worker.
 *
 * This flag does not authenticate a person, implement a UID-specific freeze,
 * or install a distributed deletion protocol. The only safe action when the
 * QA seal is enabled is to refuse EVERY mutating HTTP request and retry every
 * queue message without reading its body or contacting any service.
 *
 * Never enable on production: all Push/Guardiao/QA-bot writes will stop.
 * No secrets, network, D1 queries, or deletion API are used by this module.
 */
export const QA_PUSH_PRIVACY_SEAL_FLAG='ATRIO_PRIVACY_QA_WRITE_FENCE';
export function qaPushPrivacySealed(env){
  // Any nonempty setting except an explicit 'false' is a conservative seal.
  // A misspelt flag value must not silently reopen writes in the QA sandbox.
  const value=env?.[QA_PUSH_PRIVACY_SEAL_FLAG];
  return value!==undefined && value!==null && value!==false &&
    value!=='' && value!=='false';
}
export const QA_PUSH_PRIVACY_SEAL_READINESS=Object.freeze({
  productionIntegrated:false,
  perAccountFreeze:false,
  sealsEntireWorker:true,
  distributedBarrier:false,
  backendCredentialsRequired:false
});
