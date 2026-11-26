// Offline evidence checklist, never an activation authority or network client.
// Freshness, identities, quotas and approvals are assertions to review against
// source evidence. This cannot prove that an operator's evidence is truthful.
const PROJECT='atrio-catolico-qa-general',WORKER='atrio-push-qa-general';
const DB='dc88db76-99c2-46d0-b5e3-df68152c564d';
const numeric=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const exactBool=(e,k)=>e[k]===true;
export function reviewQaAutomaticPreflight(e={},now=Date.now()){
 if(!e||typeof e!=='object'||Array.isArray(e))e={};
 const checks={
  freshEvidence:Number.isSafeInteger(e.observedAt)&&e.observedAt<=now&&now-e.observedAt<=15*60000,
  qaIdentity:e.projectId===PROJECT&&e.workerName===WORKER&&e.databaseId===DB,
  freePlans:e.workersPlan==='free'&&e.firebaseBillingEnabled===false,
  currentRollback:uuid(e.deploymentId)&&uuid(e.versionId)&&e.singleVersion===true&&e.cronCount===0,
  // Internal safety margin for one bounded trial, not a provider guarantee.
  firestoreHeadroom:numeric(e.firestoreReadsRemaining,15000,50000),
  d1Headroom:numeric(e.d1RowsReadRemaining,200000,5000000)&&numeric(e.d1RowsWrittenRemaining,20000,100000),
  requestsHeadroom:numeric(e.workerRequestsRemaining,1000,100000),
  identityAndPolicy:['secretIdentityVerified','effectivePermissionsVerified','noFirestoreWritePermission','authRevocationVerified','qaDevicesVerified'].every(k=>exactBool(e,k)),
  safetyAndIsolation:['manualQuiesced','pendingDrained','rollbackVerified','abuseProtectionVerified','metricsAvailable','explicitTrialApproval'].every(k=>exactBool(e,k))
 };
 const missing=Object.keys(checks).filter(k=>!checks[k]);
 return {status:missing.length?'blocked':'ready_for_human_review',missing,checks,activationAuthorized:false,remoteWrites:false};
}
