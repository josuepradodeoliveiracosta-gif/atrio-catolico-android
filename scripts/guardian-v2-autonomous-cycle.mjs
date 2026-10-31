// Guardião V2 — processamento autônomo não punitivo, sob identidade WIF separada.
// Etapa preparatória: NÃO é habilitada por padrão e NÃO executa retenção/remoção.
// Nunca registre textos, URLs de documentos, IDs de usuários ou tokens nos logs.
import {Firestore, string} from '../cloudflare/guardian-worker/src/firestore.js';
import {processDocument} from '../cloudflare/guardian-worker/src/index.js';
import {enforceNonpunitiveBatch} from '../cloudflare/guardian-worker/src/nonpunitive-write-gate.js';

const REPO = 'josuepradodeoliveiracosta-gif/atrio-catolico-android';
const WORKFLOW = '.github/workflows/guardiao-v2-moderator-runner.yml';
const PROJECT = 'atrio-catolico';
const RESOURCE = 'projects/'+PROJECT+'/databases/(default)/documents';
const MAX_DAILY_RUNS = 24; // Só protege este workflow, não a cota global.
const MAX_CASES_PER_DAY = 12; // Teto local de casos, com CAS transacional.
const MAX_CASES_PER_CYCLE = 2;
const SCAN_PER_GROUP = 2;
const rejected = reason => {throw Error('guardian_v2_writer_'+reason);};
const fields = d => d?.fields || {};
const flag = (d,k) => fields(d)[k]?.booleanValue === true;
const integer = (d,k) => {
  const n=Number(fields(d)[k]?.integerValue);
  return Number.isSafeInteger(n)&&n>=0?n:null;
};

export function requireWriterContext(e) {
  const manual=e.GITHUB_EVENT_NAME==='workflow_dispatch';
  if(e.GITHUB_REPOSITORY!==REPO ||
     e.GITHUB_REF!=='refs/heads/main' ||
     e.GITHUB_WORKFLOW_REF!==REPO+'/'+WORKFLOW+'@refs/heads/main' ||
     !['schedule','workflow_dispatch'].includes(e.GITHUB_EVENT_NAME) ||
     e.GITHUB_RUN_ATTEMPT!=='1' ||
     e.GUARDIAN_V2_WRITER_ENABLED!=='true' ||
     e.GUARDIAN_V2_NONPUNITIVE_ONLY!=='true' ||
     e.GUARDIAN_V2_HOLD_ENABLED!=='false' ||
     e.GUARDIAN_V2_WRITER_APPROVED!=='true' ||
     e.GUARDIAN_V2_WRITER_SERVICE_ACCOUNT!=='guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com' ||
     (manual && e.GUARDIAN_V2_CONFIRM_MANUAL!=='true') ||
     typeof e.GH_READ_TOKEN!=='string' || e.GH_READ_TOKEN.length<15 ||
     typeof e.WIF_ACCESS_TOKEN!=='string' || e.WIF_ACCESS_TOKEN.length<20)
    rejected('context_denied');
}

async function dailyRunGate(e, fetcher=fetch) {
  const day=new Date().toISOString().slice(0,10);
  const url='https://api.github.com/repos/'+REPO+
    '/actions/workflows/guardiao-v2-moderator-runner.yml/runs?created='+
    day+'&per_page=1';
  let reply;
  try {
    reply=await fetcher(url,{headers:{
      'Authorization':'Bearer '+e.GH_READ_TOKEN,
      'Accept':'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28'
    },signal:AbortSignal.timeout(8000),redirect:'error'});
  } catch {rejected('run_budget_unavailable');}
  if(reply?.status!==200)rejected('run_budget_unavailable');
  let payload;
  try {payload=await reply.json();} catch {rejected('run_budget_unavailable');}
  if(!Number.isSafeInteger(payload?.total_count) ||
     payload.total_count<1 || payload.total_count>MAX_DAILY_RUNS)
    rejected('run_budget_denied');
}

// Não basta um token válido: a política deve aprovar a escrita não punitiva,
// o motor deve estar habilitado e a parada emergencial deve estar desarmada.
function policyApproved(doc) {
  return doc?.name===RESOURCE+'/guardian_config/policy' &&
    !!doc.updateTime && flag(doc,'enabled') &&
    flag(doc,'autonomousWriteEnabled') &&
    !flag(doc,'emergencyStop') &&
    !flag(doc,'allowHold');
}

function writer(db) {
  // Apenas as operações de criação de casos, auditorias e avisos,
  // vinculadas à mesma versão de origem, recebem caminho de commit.
  return {
    resource:RESOURCE,
    get:path=>db.get(path),
    commit:async writes=>{
      const caseFields=writes?.[0]?.update?.fields;
      const targetPath=string({fields:caseFields},'targetPath');
      const caseId=writes?.[0]?.update?.name?.split('/').at(-1);
      const ownerUid=string({fields:caseFields},'ownerUid');
      const sourceUpdateTime=string({fields:caseFields},'sourceUpdateTime');
      const status=string({fields:caseFields},'status');
      const action=status==='warned'?'warn':status==='review'?'review':'invalid';
      enforceNonpunitiveBatch(writes,{resource:RESOURCE,caseId,
        ownerUid,targetPath,sourceUpdateTime,action});

      // Políticas e orçamento são reconsultados antes de cada compromisso.
      const policy=await db.get('guardian_config/policy');
      if(!policyApproved(policy))rejected('policy_stopped');

      const day=new Date().toISOString().slice(0,10);
      const budgetPath='guardian_runtime/v2_writer_budget_'+day.replaceAll('-','');
      const budget=await db.get(budgetPath);
      const current=budget?integer(budget,'cases'):0;
      if(current===null || current>=MAX_CASES_PER_DAY || (budget&&!budget.updateTime))
        rejected('daily_case_budget_exhausted');

      const next={cases:{integerValue:String(current+1)},
        day:{stringValue:day}};
      const budgetWrite=budget?
        {update:{name:RESOURCE+'/'+budgetPath,fields:next},
         updateMask:{fieldPaths:['cases','day']},
         currentDocument:{updateTime:budget.updateTime}}:
        {update:{name:RESOURCE+'/'+budgetPath,fields:next},
         currentDocument:{exists:false}};
      // A pré-condição de versão da política impede escrita se a parada
      // emergencial for acionada entre leitura e commit.
      return db.commit([...writes,budgetWrite,{
        verify:policy.name,currentDocument:{updateTime:policy.updateTime}
      }]);
    }
  };
}

export async function runAutonomousCycle(e=process.env) {
  requireWriterContext(e);
  await dailyRunGate(e);
  const db=new Firestore(e.WIF_ACCESS_TOKEN,PROJECT);
  if(!policyApproved(await db.get('guardian_config/policy')))
    return {status:'PAUSED_BY_POLICY',cases:0,examined:0};

  const scoped=writer(db);
  let cases=0,examined=0;
  // Nesta primeira versão, limite estrito de consultas e de gravações.
  for(const group of ['posts','replies']){
    const docs=await db.scan(group,20,SCAN_PER_GROUP);
    for(const doc of docs){
      if(cases>=MAX_CASES_PER_CYCLE)break;
      examined++;
      const outcome=await processDocument(scoped,doc,{
        enabled:true,allowHold:false,context:{}
      });
      if(outcome==='warn'||outcome==='review')cases++;
    }
    if(cases>=MAX_CASES_PER_CYCLE)break;
  }
  return {status:'NONPUNITIVE_CYCLE_OK',cases,examined};
}

if(process.argv[1] && import.meta.url==='file://'+process.argv[1]){
  runAutonomousCycle().then(r=>console.log('GUARDIAN_V2_WRITER',
    r.status,'cases='+r.cases,'examined='+r.examined))
    .catch(e=>{
      const msg=typeof e?.message==='string' &&
        /^guardian_v2_(writer|nonpunitive_write)_[a-z0-9_]+$/.test(e.message)
        ?e.message:'guardian_v2_writer_failed_closed';
      console.error('GUARDIAN_V2_WRITER_DENIED',msg);
      process.exitCode=1;
    });
}
