/**
 * Dry-run preflight for a hypothetical keyless V2 scheduler.
 *
 * Does NOT acquire GitHub OIDC, Google WIF, OAuth, read Firestore, schedule
 * a job, deploy a worker, or grant permission to moderate users.
 *
 * The recurring executor is NOT approved. This module only validates a
 * proposed nonprivileged GitHub Actions entrypoint and an illustrative budget.
 */
const REPO='josuepradodeoliveiracosta-gif/atrio-catolico-android';
const WORKFLOW='.github/workflows/guardiao-v2-executor-preflight.yml';
const EXPECTED={
  GITHUB_REPOSITORY:REPO,
  GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_REF:'refs/heads/main',
  GITHUB_WORKFLOW_REF:REPO+'/'+WORKFLOW+'@refs/heads/main',
  GUARDIAN_EXECUTOR_DRY_RUN:'true',
  GUARDIAN_V2_TEST_MODE:'true',
  GUARDIAN_V2_ENABLED:'false',
  GUARDIAN_V2_HOLD_ENABLED:'false',
  GUARDIAN_V2_PRODUCTION_APPROVED:'false',
  GUARDIAN_V2_IDENTITY_APPROVED:'false',
  GUARDIAN_V2_HOLD_APPROVED:'false',
};
const SECRET_KEYS=[
  'QA_ACCESS_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON',
  'GUARDIAN_FIREBASE_OAUTH_TOKEN',
  'GUARDIAN_V2_SERVICE_ACCOUNT_JSON',
  'GUARDIAN_OAUTH_ACCESS_TOKEN',
  'GITHUB_TOKEN',
];
const REQUIRED_BEFORE_PRODUCTION=Object.freeze([
  'identity_wif_bound_to_exact_production_workflow',
  'iam_least_privilege_independently_verified',
  'atomic_shared_daily_budget_reservation',
  'real_qa_scanner_case_audit_notice_end_to_end',
  'emergency_stop_and_rollback_approved',
  'explicit_production_schedule_deploy_authorization',
]);

/**
 * Planning constants are intentionally conservative, but NOT a real
 * quota reservation, nor a guarantee of zero cost. Total Firestore usage
 * includes other app operations and query/index reads.
 */
export function illustrativeBudget({intervalMinutes=60,readsPerRun=8}={}){
  if(!Number.isSafeInteger(intervalMinutes)||intervalMinutes<30||
      intervalMinutes>1440||1440%intervalMinutes!==0)
    throw Error('invalid_interval');
  if(!Number.isSafeInteger(readsPerRun)||readsPerRun<1||readsPerRun>8)
    throw Error('invalid_read_cap');
  const plannedRuns=1440/intervalMinutes;
  return Object.freeze({
    plannedRunsPerDay:plannedRuns,
    illustrativeMaxDocumentReads:plannedRuns*readsPerRun,
    readCapPerRun:readsPerRun,
    writesAllowed:0,
    deletesAllowed:0,
    persistentBudgetReservation:false,
    firestoreQuotaGuarantee:false,
  });
}

export function assessOfflineExecutorPreflight(env={},plan={}){
  const denied=[];
  for(const [key,expected] of Object.entries(EXPECTED))
    if(env?.[key]!==expected)denied.push('context_'+key.toLowerCase());
  if(SECRET_KEYS.some(key=>typeof env?.[key]==='string' && env[key].length>0))
    denied.push('credential_present');
  if(env?.GUARDIAN_V2_QA_AUTO_DISPATCH==='true' ||
     env?.GUARDIAN_QA_REMOTE_READY==='true' ||
     env?.GUARDIAN_V2_QA_SHADOW_READS==='true' ||
     env?.GUARDIAN_V2_QA_FIRESTORE_BRIDGE==='true')
    denied.push('remote_qa_enabled');
  let budget;
  try{budget=illustrativeBudget(plan);}
  catch{denied.push('budget_invalid');}
  const offlineAllowed=denied.length===0;
  return {
    status:offlineAllowed?'OFFLINE_PREFLIGHT_ONLY':'DENIED',
    offlineAllowed,
    productionAuthorized:false,
    githubOidcRequested:false,
    firestoreRequestsAllowed:0,
    cloudflareRequestsAllowed:0,
    // A valid offline context is NOT proof the externally managed WIF
    // provider trusts this workflow/ref or that IAM scopes are acceptable.
    nextPhase:'NO_GO_PRODUCTION',
    missingProductionApprovals:[...REQUIRED_BEFORE_PRODUCTION],
    ...(budget?{illustrativeBudget:budget}:{}),
    ...(denied.length?{blockers:denied}:{}),
  };
}

if(typeof process!=='undefined' && process.argv[1] &&
   import.meta.url==='file://'+process.argv[1]){
  const result=assessOfflineExecutorPreflight(process.env);
  // Never print env, tokens, usernames, document IDs or content.
  console.log('GUARDIAN_V2_EXECUTOR_PREFLIGHT',JSON.stringify(result));
  if(!result.offlineAllowed)process.exitCode=2;
}
