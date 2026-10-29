// Optional FREE QA automation via an explicitly provisioned, repo-scoped
// fine-grained GitHub PAT. Never touch Firebase, users, content, or production.
// DISABLED by default. A GitHub Actions workflow_dispatch costs no money for
// standard hosted runners in public repos, subject to GitHub usage limits.
const ACTIONS_URL='https://api.github.com/repos/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/workflows/guardiao-autonomo-qa.yml/dispatches';
const REF='feature/guardiao-autonomo-20261029';
export const DISPATCH_UTC_HOUR=3;

const isFineGrainedPat=token=>typeof token==='string' &&
  /^github_pat_[A-Za-z0-9_]{35,250}$/.test(token);

export function qaDispatchAllowed(env={}) {
  return env.GUARDIAN_V2_TEST_MODE==='true'
    && env.GUARDIAN_V2_ENABLED==='false'
    && env.GUARDIAN_V2_HOLD_ENABLED==='false'
    && env.GUARDIAN_V2_QA_SHADOW_READS==='false'
    && env.GUARDIAN_V2_QA_AUTO_DISPATCH==='true'
    && env.GUARDIAN_QA_DISPATCH_READY==='true'
    && !env.GUARDIAN_FIREBASE_PROJECT_ID
    && !env.GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON
    && isFineGrainedPat(env.GUARDIAN_QA_GITHUB_DISPATCH_TOKEN);
}
export function dueForDailyDispatch(scheduledTime) {
  if(!Number.isFinite(scheduledTime))return false;
  const d=new Date(scheduledTime);
  return d.getUTCHours()===DISPATCH_UTC_HOUR
    && d.getUTCMinutes()===0
    && d.getUTCSeconds()===0;
}
export async function dispatchQaWorkflow(env,scheduledTime,fetcher=fetch) {
  if(!qaDispatchAllowed(env))return {status:'disabled'};
  if(!dueForDailyDispatch(scheduledTime))return {status:'not_due'};
  // An exact, hard-coded workflow/ref. No arbitrary URL or user-supplied inputs.
  try {
    const response=await fetcher(ACTIONS_URL,{
      method:'POST',
      headers:{
        'Accept':'application/vnd.github+json',
        'Content-Type':'application/json',
        'Authorization':'Bearer '+env.GUARDIAN_QA_GITHUB_DISPATCH_TOKEN,
        'User-Agent':'atrio-guardian-qa-dispatch'
      },
      body:JSON.stringify({ref:REF}),
      redirect:'error',
      signal:AbortSignal.timeout(7000)
    });
    if(response.status!==204&&response.status!==200)throw Error('dispatch_failed');
    // Do not log remote headers, response body, token or any run identifiers.
    return {status:'dispatched'};
  }catch {
    return {status:'unavailable'};
  }
}
