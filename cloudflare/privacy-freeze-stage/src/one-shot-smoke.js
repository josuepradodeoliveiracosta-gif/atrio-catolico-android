/**
 * Internal-only, one-shot staging proof for five private Service Bindings.
 *
 * Runs from a temporary Cloudflare cron; never routes publicly.
 * Uses only two synthetic subjects and records a minimal pass/fail flag
 * without account content, secrets, tokens, or user identifiers.
 */
const RUN_ID='atrio-stage-service-smoke-v1';
const ROOT='https://qa-only.invalid';
const safeJson=async response=>{
  if(!response?.ok)throw Error('qa_consumer_refused');
  const value=await response.json();
  if(!value||typeof value.status!=='string')throw Error('qa_consumer_bad_response');
  return value;
};
const send=async(binding,path,body=null)=>{
  if(typeof binding?.fetch!=='function')throw Error('qa_binding_absent');
  const init={method:'POST'};
  if(body!==null){
    init.body=JSON.stringify(body);
    init.headers={'content-type':'application/json'};
  }
  return safeJson(await binding.fetch(new Request(ROOT+path,init)));
};
async function record(db,status){
  const r=await db.prepare(
    "UPDATE qa_stage_smoke_runs SET status=?, completed_ms=? WHERE run_id=? AND status='running'"
  ).bind(status,Date.now(),RUN_ID).run();
  if(r?.success!==true||r.meta?.changes!==1)throw Error('qa_status_persist_failed');
}
export async function runOneShotSmoke(env){
  if(env?.ATRIO_QA_SMOKE_MODE!=='demo-atrio-v11'||
     typeof env.ATRIO_QA_SMOKE_DB?.prepare!=='function'||
     !['AVATAR','GUARDIAN','PUSH','ADMIN','RECONCILER'].every(
       k=>typeof env['QA_'+k]?.fetch==='function'))
    throw Error('qa_smoke_not_configured');
  const db=env.ATRIO_QA_SMOKE_DB;
  const slot=await db.prepare(
    "INSERT OR IGNORE INTO qa_stage_smoke_runs (run_id,status,started_ms) VALUES (?,?,?)"
  ).bind(RUN_ID,'running',Date.now()).run();
  if(slot?.success!==true)throw Error('qa_smoke_lock_missing');
  if(slot.meta?.changes!==1)return {status:'already_attempted'};
  try{
    const ids=[];
    for(const role of ['AVATAR','GUARDIAN','PUSH']){
      const value=await send(env['QA_'+role],'/__qa/admit');
      if(value.status!=='qa_stage_admitted'||
         typeof value.operationId!=='string'||
         !/^[a-f0-9-]{36}$/.test(value.operationId))
        throw Error('qa_admission_failed');
      ids.push(value.operationId);
    }
    // The first three admissions cover Alice once from Avatar, Bob from
    // Guardian, and BOTH users from Push (4 ledger rows in total).
    const before=await send(env.QA_ADMIN,'/__qa/status');
    if(before.status!=='stage_status'||before.state!=='active'||
       before.inFlight!==2)throw Error('qa_before_status_unexpected');
    for(const operationId of ids){
      const closed=await send(env.QA_RECONCILER,'/__qa/close',{operationId});
      if(closed.status!=='stage_reconciled')throw Error('qa_close_failed');
    }
    const after=await send(env.QA_ADMIN,'/__qa/status');
    if(after.status!=='stage_status'||after.state!=='active'||
       after.inFlight!==0)throw Error('qa_after_status_unexpected');
    await record(db,'passed');
    return {status:'passed'};
  }catch{
    // Fail closed: no automated release of an ambiguous D1 ticket.
    await record(db,'failed');
    return {status:'failed'};
  }
}
export default {
  async fetch(){return new Response('Forbidden',{status:403,
    headers:{'cache-control':'no-store'}})},
  async scheduled(_event,env,ctx){
    ctx.waitUntil(runOneShotSmoke(env));
  }
};
