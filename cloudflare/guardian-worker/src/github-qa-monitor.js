// Monitor of PUBLIC GitHub Actions QA status only. No GitHub token, Firebase access,
// write requests, IDs, user content, deployment or moderation.
const OWNER='josuepradodeoliveiracosta-gif';
const REPOSITORY='atrio-catolico-android';
const BRANCH='feature/guardiao-autonomo-20261029';
const API='https://api.github.com/repos/'+OWNER+'/'+REPOSITORY;
const WORKFLOW=API+'/actions/workflows/guardiao-autonomo-qa.yml/runs?branch='+encodeURIComponent(BRANCH)+'&event=workflow_dispatch&per_page=5';
const UA='atrio-guardian-v2-qa-monitor';
const allowedState=new Set(['success','failure','cancelled','skipped','in_progress','queued','missing']);
export function qaMonitorAllowed(env={}) {
  return env.GUARDIAN_V2_TEST_MODE==='true'
    && env.GUARDIAN_V2_ENABLED==='false'
    && env.GUARDIAN_V2_HOLD_ENABLED==='false'
    && env.GUARDIAN_V2_QA_SHADOW_READS==='false'
    && env.GUARDIAN_V2_QA_RUN_MONITOR==='true'
    && !env.GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON
    && !env.GUARDIAN_FIREBASE_PROJECT_ID;
}
const state=(s)=>allowedState.has(s)?s:'missing';
const get=async (fetcher,url)=>{
  const resp=await fetcher(url,{method:'GET',headers:{'Accept':'application/vnd.github+json','User-Agent':UA},signal:AbortSignal.timeout(6500)});
  if(!resp.ok)throw Error('github_unavailable');
  return resp.json();
};
export async function readQaWorkflowStatus(env,fetcher=fetch,now=Date.now()) {
  if(!qaMonitorAllowed(env))return {status:'disabled'};
  try {
    const feed=await get(fetcher,WORKFLOW);
    if(!Array.isArray(feed?.workflow_runs))throw Error('invalid_data');
    const run=feed.workflow_runs.find(x=>x?.event==='workflow_dispatch'
      && x.head_branch===BRANCH && Number.isSafeInteger(x.id) && x.id>0);
    if(!run)return {status:'missing'};
    const update=Date.parse(run.updated_at);
    if(!Number.isFinite(update)||update>now+60000||now-update>86400000)
      return {status:'stale'};
    const ageHours=Math.max(0,Math.floor((now-update)/3600000));
    const runState=run.status==='completed'?state(run.conclusion):state(run.status);
    if(run.status!=='completed')return {status:'observed',remote:'in_progress',run:runState,ageHours};
    const jobs=await get(fetcher,API+'/actions/runs/'+run.id+'/jobs?per_page=100');
    if(!Array.isArray(jobs?.jobs))throw Error('invalid_data');
    const job=jobs.jobs.find(x=>x?.name==='remote-qa-readonly');
    const remote=job?.status==='completed'?state(job.conclusion):job?state(job.status):'missing';
    return {status:'observed',remote,run:runState,ageHours};
  }catch {
    // Fail closed; neither HTTP payloads nor source/error details reach logs.
    return {status:'unavailable'};
  }
}
