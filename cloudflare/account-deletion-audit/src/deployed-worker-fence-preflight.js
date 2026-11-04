/**
 * Inspects sanitized Cloudflare Worker metadata after a read-only deployment
 * audit. Does not fetch secrets or contact live APIs. Source-text markers are
 * weak observations, not proof of runtime behaviour or coordinated fencing.
 *
 * Never use this advisory verdict as authorization to delete an account,
 * deploy Workers, sign an AAB or publish to Google Play.
 */
const WORKERS=Object.freeze({
  avatar:'atrio-avatares',
  guardian:'atrio-guardian-v2',
  push:'atrio-push'
});
const COORDINATOR='atrio-account-deletion-coordinator';
const BINDING='ACCOUNT_DELETION_COORDINATOR';
const NAME=/^[a-z][a-z0-9_-]{0,70}$/;
function invalid(reason){throw Error('live_deletion_audit_invalid:'+reason);}
function boundedDate(value){
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/.test(value))
    return false;
  const n=Date.parse(value);
  return Number.isFinite(n)&&new Date(n).toISOString()===value;
}
function validBinding(b){
  return b && Object.getPrototypeOf(b)===Object.prototype &&
    typeof b.name==='string' && NAME.test(b.name.toLowerCase()) &&
    ['service','d1','secret_text','plain_text'].includes(b.type) &&
    (b.service===undefined ||
      (typeof b.service==='string'&&NAME.test(b.service))) &&
    (b.type!=='service'||typeof b.service==='string');
}
function unique(items){return new Set(items).size===items.length;}
/**
 * Conservative source/binding preflight ONLY.
 * Observation is a manually reviewed read-only Cloudflare API snapshot:
 * {capturedAt, workers:[{name,deployedAt,codeReadable,freezeMarker,
 * durableAdmissionObserved,drainObserved,perUidFcmObserved,bindings:[...]}]}.
 *
 * Reviewing admission/drain source code is NOT proof it works. Operational
 * IAM, signed approvals, Cloudinary/FCM/D1 proof and legal retention remain.
 */
export function assessDeployedWorkerFence(observation){
  if(!observation || Object.getPrototypeOf(observation)!==Object.prototype ||
     !boundedDate(observation.capturedAt) ||
     !Array.isArray(observation.workers) ||
     observation.workers.length!==3)invalid('structure');
  const names=observation.workers.map(x=>x?.name);
  if(!unique(names) ||
     !Object.values(WORKERS).every(x=>names.includes(x)))invalid('services');
  const blockers=[];
  for(const [kind,name] of Object.entries(WORKERS)){
    const w=observation.workers.find(x=>x.name===name);
    if(!w || Object.getPrototypeOf(w)!==Object.prototype ||
       !boundedDate(w.deployedAt) ||
       typeof w.codeReadable!=='boolean' ||
       typeof w.freezeMarker!=='boolean' ||
       typeof w.durableAdmissionObserved!=='boolean' ||
       typeof w.drainObserved!=='boolean' ||
       typeof w.perUidFcmObserved!=='boolean' ||
       !Array.isArray(w.bindings) || w.bindings.length>50 ||
       !w.bindings.every(validBinding) ||
       !unique(w.bindings.map(b=>b.name)))invalid('worker:'+kind);
    if(Date.parse(w.deployedAt)>Date.parse(observation.capturedAt))
      invalid('future_deployment:'+kind);
    if(!w.codeReadable)blockers.push(kind+':deployed_code_unreadable');
    if(!w.freezeMarker)blockers.push(kind+':account_freeze_missing');
    if(!w.durableAdmissionObserved)blockers.push(kind+':durable_admission_not_reviewed');
    if(!w.drainObserved)blockers.push(kind+':inflight_drain_not_reviewed');
    if(!w.bindings.some(b=>b.name===BINDING &&
       b.type==='service' && b.service===COORDINATOR))
      blockers.push(kind+':production_coordinator_binding_missing');
    if(kind==='push'&&!w.perUidFcmObserved)
      blockers.push('push:individual_recipient_fencing_not_reviewed');
  }
  return Object.freeze({
    status:blockers.length?'blocked':'source_and_settings_preflight_only',
    blockers:Object.freeze(blockers.sort()),
    inspectedWorkers:Object.freeze(Object.values(WORKERS)),
    coordinatorExpected:COORDINATOR,
    sourceAndSettingsPreflightPassed:blockers.length===0,
    // Source/setting observations can NEVER attest end-to-end deletion.
    liveAccountDeletionHomologated:false,
    realDeleteAuthorized:false,
    googlePlayReleaseAuthorized:false,
    requiresRemoteDisposableAccountE2E:true,
    requiresIndependentIamAndRetentionReview:true
  });
}
