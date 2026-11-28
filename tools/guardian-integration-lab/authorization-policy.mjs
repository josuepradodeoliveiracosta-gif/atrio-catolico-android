// Contrato de autorização OFFLINE, inspirado em OPA. Não autentica, não escreve,
// não importa OPA nem concede privilégios. Entradas confiáveis são fixtures do teste.
export const POLICY_VERSION = 'guardian-authz-offline-1';
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CASE = /^guard_[a-f0-9]{32}$/;
const TARGET = /^posts\/[A-Za-z0-9_-]{1,128}(?:\/replies\/[A-Za-z0-9_-]{1,128})?$/;
const revision = v => {
  if(typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(v)) return false;
  const ms=Date.parse(v);
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,19)===v.slice(0,19);
};
const str = (v,rx) => typeof v === 'string' && rx.test(v);
const exact = (v, keys) => v !== null && typeof v === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k) && Object.getOwnPropertyDescriptor(v,k).get === undefined && Object.getOwnPropertyDescriptor(v,k).set === undefined);
const result = (allowed, reason) => Object.freeze({allowed, reason, policyVersion:POLICY_VERSION, remoteAuthorized:false});
const deny = r => result(false,r);
const allow = r => result(true,r);
// ctx, record, policy e finance são snapshots de teste, nunca campos da requisição.
export function evaluateAuthorization(ctx, request, record = null, policy = null, finance = null) {
  try {
    if (!exact(ctx,['environment','project','role','uid','authenticated','active','sessionFresh','identitySeparated']) || ctx.environment !== 'offline-fixture' || ctx.project !== 'guardian-v2-qa-fixture') return deny('environment_denied');
    if (!str(ctx.uid,ID) || ctx.authenticated !== true || ctx.active !== true || ctx.sessionFresh !== true || !['owner','moderator','observer','triage'].includes(ctx.role)) return deny('identity_denied');
    if (!request || typeof request !== 'object' || !Object.hasOwn(Object.getOwnPropertyDescriptor(request,'operation')||{},'value') || typeof request.operation !== 'string') return deny('invalid_request');
    if (request.operation === 'read_policy') {
      return exact(request,['operation']) && ['observer','triage','moderator'].includes(ctx.role) ? allow('policy_read_fixture') : deny('scope_denied');
    }
    if (request.operation === 'read_case' || request.operation === 'resolve_case') {
      const resolve = request.operation === 'resolve_case';
      if (!exact(request,resolve?['operation','caseId','expectedRevision','outcome','note']:['operation','caseId']) || !str(request.caseId,CASE)) return deny('invalid_request');
      if (!exact(record,['caseId','ownerUid','status','revision','engine']) || record.caseId !== request.caseId || !str(record.ownerUid,ID) || !revision(record.revision) || record.engine !== 'v2' || !['review','warned','dismissed','acknowledged','held','restored','removed'].includes(record.status)) return deny('record_denied');
      if (!resolve) return ctx.role === 'moderator' || (ctx.role === 'owner' && ctx.uid === record.ownerUid) ? allow('case_read_fixture') : deny('scope_denied');
      if (ctx.role !== 'moderator' || ctx.uid === record.ownerUid) return deny('reviewer_denied');
      if (!['review','warned'].includes(record.status) || request.expectedRevision !== record.revision) return deny('stale_or_closed_case');
      if (!['dismissed','acknowledged'].includes(request.outcome) || typeof request.note !== 'string' || request.note.trim().length < 5 || request.note.length > 300) return deny('invalid_resolution');
      return allow('nonpunitive_resolution_fixture');
    }
    if (request.operation === 'propose_case') {
      if (!exact(request,['operation','caseId','expectedRevision','expectedPolicyRevision','status']) || !str(request.caseId,CASE) || !['review','warned'].includes(request.status)) return deny('invalid_request');
      if (ctx.role !== 'triage' || ctx.identitySeparated !== true) return deny('triage_identity_denied');
      if (!exact(policy,['enabled','autonomousWriteEnabled','emergencyStop','allowHold','revision']) || policy.enabled !== true || policy.autonomousWriteEnabled !== true || policy.emergencyStop !== false || policy.allowHold !== false || !revision(policy.revision) || request.expectedPolicyRevision !== policy.revision) return deny('policy_denied');
      if (!exact(record,['ownerUid','targetPath','revision','eligible']) || !str(record.ownerUid,ID) || !str(record.targetPath,TARGET) || !revision(record.revision) || request.expectedRevision !== record.revision || record.eligible !== true) return deny('source_denied');
      // Somente elegibilidade do marco 03; reserva atômica NÃO está implementada.
      if (!exact(finance,['allowed','reason','requiresAtomicReservation','remoteAuthorized']) || finance.allowed !== true || !['within_budget','preventive_alert'].includes(finance.reason) || finance.requiresAtomicReservation !== true || finance.remoteAuthorized !== false) return deny('financial_gate_denied');
      return allow('nonpunitive_proposal_fixture_requires_atomic_reservation');
    }
    // Inclui ativação de política, retenção, remoção, banimento, commit genérico.
    return deny('operation_denied');
  } catch { return deny('invalid_input'); }
}
