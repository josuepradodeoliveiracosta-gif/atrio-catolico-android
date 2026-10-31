// Bounded and read-only V2 observation; never print user content, IDs or tokens.
import {classify} from '../cloudflare/guardian-worker/src/policy.js';
const REPO='josuepradodeoliveiracosta-gif/atrio-catolico-android';
const WF='.github/workflows/guardiao-v2-prod-runner.yml';
const PROJECT='atrio-catolico';
const BASE='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents';
const MAX_DAILY_WORKFLOW_RUNS=24; // Workflow safeguard, NOT a billing guarantee.
const MAX_PER_GROUP=2;
const MAX_RESPONSE_BYTES=50000;
const deny=reason=>{throw Error('guardian_v2_shadow_'+reason);};

export function validateShadowContext(env){
  const event=env.GITHUB_EVENT_NAME;
  if(env.GITHUB_REPOSITORY!==REPO ||
    env.GITHUB_REF!=='refs/heads/main' ||
    env.GITHUB_WORKFLOW_REF!==REPO+'/'+WF+'@refs/heads/main' ||
    !['schedule','workflow_dispatch'].includes(event) ||
    env.GITHUB_RUN_ATTEMPT!=='1' ||
    env.GUARDIAN_V2_SHADOW_ONLY!=='true' ||
    env.GUARDIAN_V2_HOLD_ENABLED!=='false' ||
    env.GUARDIAN_V2_WRITE_ENABLED!=='false' ||
    (event==='workflow_dispatch' &&
      (env.CONFIRM_IDENTITY!=='true'||env.CONFIRM_SHADOW!=='true')) ||
    typeof env.GH_READ_TOKEN!=='string' || env.GH_READ_TOKEN.length<15 ||
    typeof env.WIF_ACCESS_TOKEN!=='string'||env.WIF_ACCESS_TOKEN.length<20)
    deny('context_denied');
}

export async function checkDailyWorkflowRuns(env,fetcher=fetch,day=new Date().toISOString().slice(0,10)){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))deny('invalid_day');
  const url='https://api.github.com/repos/'+REPO+'/actions/workflows/guardiao-v2-prod-runner.yml/runs?created='+day+'&per_page=1';
  let result;
  try{result=await fetcher(url,{headers:{
    Authorization:'Bearer '+env.GH_READ_TOKEN,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28'
  },signal:AbortSignal.timeout(8000),redirect:'error'});}
  catch{deny('budget_unavailable');}
  if(result?.status!==200)deny('budget_unavailable');
  let body;
  try{body=await result.json();}catch{deny('budget_unavailable');}
  const n=body?.total_count;
  if(!Number.isSafeInteger(n)||n<1||n>MAX_DAILY_WORKFLOW_RUNS)
    deny('daily_run_cap');
  return n;
}
async function boundedJson(fetcher,url,opts){
  let response;
  try{response=await fetcher(url,{...opts,signal:AbortSignal.timeout(10000),redirect:'error'});}
  catch{deny('firestore_unavailable');}
  if(response?.status!==200)deny('firestore_http_'+(response?.status??'unknown'));
  if(Number(response.headers?.get?.('content-length')||0)>MAX_RESPONSE_BYTES)
    deny('response_too_large');
  let raw;
  try{raw=await response.text();}catch{deny('response_unreadable');}
  if(typeof raw!=='string'||raw.length>MAX_RESPONSE_BYTES)
    deny('response_too_large');
  try{return JSON.parse(raw);}catch{deny('response_invalid');}
}
function policyOf(doc){
  if(doc?.name!=='projects/'+PROJECT+'/databases/(default)/documents/guardian_config/policy')
    deny('policy_invalid');
  const f=doc.fields||{};
  if(['enabled','emergencyStop','allowHold'].some(k=>typeof f[k]?.booleanValue!=='boolean') ||
      (f.shadowEnabled!==undefined && typeof f.shadowEnabled.booleanValue!=='boolean'))
    deny('policy_invalid');
  return {
    // A separação é intencional: nunca ativar observação por "enabled" do
    // motor de moderação. Um campo ausente implica modo sombra desligado.
    shadowEnabled:f.shadowEnabled?.booleanValue===true,
    moderationEnabled:f.enabled.booleanValue,
    stopped:f.emergencyStop.booleanValue,
    hold:f.allowHold.booleanValue
  };
}
export async function runShadowCycle(env=process.env,fetcher=fetch,classifier=classify,day){
  validateShadowContext(env);
  await checkDailyWorkflowRuns(env,fetcher,day);
  const headers={Authorization:'Bearer '+env.WIF_ACCESS_TOKEN,Accept:'application/json'};
  const policy=policyOf(await boundedJson(fetcher,BASE+
    '/guardian_config/policy?mask.fieldPaths=enabled&mask.fieldPaths=emergencyStop&mask.fieldPaths=allowHold&mask.fieldPaths=shadowEnabled',
    {method:'GET',headers}));
  // Observação somente sob permissão explícita e motor punitivo desligado.
  // Parada emergencial sempre prevalece, mesmo no modo sombra.
  if(!policy.shadowEnabled||policy.moderationEnabled||policy.stopped||policy.hold)
    return {status:'PAUSED_BY_POLICY',documents:0,signals:0};
  const since=new Date(Date.now()-60*60000).toISOString();
  let documents=0,signals=0;
  for(const group of [{id:'posts',all:false},{id:'replies',all:true}]){
    // runQuery uses POST for a READ: no commit, update, delete or mutation.
    const query={structuredQuery:{
      from:[{collectionId:group.id,allDescendants:group.all}],
      select:{fields:['title','body','createdAt'].map(fieldPath=>({fieldPath}))},
      where:{fieldFilter:{field:{fieldPath:'createdAt'},op:'GREATER_THAN_OR_EQUAL',
        value:{timestampValue:since}}},
      orderBy:[{field:{fieldPath:'createdAt'},direction:'DESCENDING'}],
      limit:MAX_PER_GROUP
    }};
    const rows=await boundedJson(fetcher,BASE+':runQuery',{
      method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify(query)
    });
    if(!Array.isArray(rows)||rows.length>MAX_PER_GROUP+1)
      deny('unexpected_query_result');
    let seen=0;
    for(const item of rows){
      if(!item?.document)continue;
      if(++seen>MAX_PER_GROUP)deny('query_over_limit');
      const doc=item.document;
      const path=doc.name||'';
      const post=/^projects\/atrio-catolico\/databases\/\(default\)\/documents\/posts\/[A-Za-z0-9_-]{1,128}$/.test(path);
      const reply=/^projects\/atrio-catolico\/databases\/\(default\)\/documents\/posts\/[A-Za-z0-9_-]{1,128}\/replies\/[A-Za-z0-9_-]{1,128}$/.test(path);
      if(group.id==='posts'?!post:!reply)deny('unexpected_document_path');
      const body=doc.fields?.body?.stringValue, title=doc.fields?.title?.stringValue||'';
      if(typeof body!=='string'||body.length>4000||title.length>200)
        deny('untrusted_document');
      const verdict=classifier((group.id==='posts'?title+' ':'')+body,{});
      if(!['clear','warning','review','hold_candidate'].includes(verdict?.level))
        deny('bad_classifier_result');
      documents++;
      if(verdict.level!=='clear')signals++;
    }
  }
  return {status:'READONLY_SHADOW_OK',documents,signals};
}
if(process.argv[1]&&import.meta.url==='file://'+process.argv[1]){
  runShadowCycle().then(result=>console.log('GUARDIAN_V2_SHADOW',result.status,
    'documents='+result.documents,'possibleSignals='+result.signals))
  .catch(e=>{
    console.error('GUARDIAN_V2_SHADOW_DENIED',
      /^guardian_v2_shadow_[a-z0-9_]+$/.test(e?.message||'')?e.message:'internal_error');
    process.exitCode=1;
  });
}
