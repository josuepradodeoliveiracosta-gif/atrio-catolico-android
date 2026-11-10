#!/usr/bin/env node
// Confere fonte Git de QA contra uma CAPTURA SANITIZADA anterior.
// Não interage com Cloudflare, não verifica secrets, não executa deploy.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const worker='atrio-qa-geral';
const project='atrio-catolico-qa-geral';
const db='atrio-qa-geral-db';
const uuid='cbca3131-5604-4103-a894-7c978143b731';
const allowedVars=Object.freeze({
 ATRIO_GENERAL_QA_MODE:'true',
 ATRIO_GENERAL_QA_PROJECT:project,
 ATRIO_QA_BOOTSTRAP_ONLY:'true',
 PUSH_ENABLED:'false',
 BROADCAST_ENABLED:'false',
 GUARDIAO_ENABLED:'false',
 QA_MANUAL_ENABLED:'false'
});
const expectedTop=Object.freeze({
 name:worker,
 main:'src/index.mjs',
 compatibility_date:'2026-10-26',
 workers_dev:false,
 preview_urls:false
});
const database=Object.freeze({
 binding:'PUSH_DB',database_name:db,database_id:uuid
});
const snapshotKeys=[
 'schema','observedDate','source','worker','workerExists','firebaseProject',
 'bootstrapOnly','pushEnabled','broadcastEnabled','guardiaoEnabled',
 'qaManualEnabled','workersDevEnabled','previewUrlsEnabled','schedulesCount',
 'd1BindingName','d1DatabaseName','d1DatabaseId','verifiedWorkerCode',
 'verifiedD1Contents','firebaseQaRulesAuditedInThisStep',
 'qaDeploymentAuthorized'
];
const isPlain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const exact=(x,keys)=>isPlain(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
function parseTomlSubset(text){
 if(typeof text!=='string'||text.length>10000)throw TypeError('qa_toml_invalid');
 const sections=new Map([['top',{}]]);
 let current=sections.get('top'),name='top';
 for(const raw of text.split(/\r?\n/)){
   const line=raw.replace(/\s+#.*$/,'').trim();
   if(!line||line.startsWith('#'))continue;
   if(/^\[\[[a-z0-9_]+\]\]$/.test(line)){
     name=line.slice(2,-2);
     if(sections.has(name))throw TypeError('qa_duplicate_section');
     current={};sections.set(name,current);continue;
   }
   if(/^\[[a-z_]+\]$/.test(line)){
     name=line.slice(1,-1);
     if(sections.has(name))throw TypeError('qa_duplicate_section');
     current={};sections.set(name,current);continue;
   }
   const match=line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|true|false)$/);
   if(!match)throw TypeError('qa_unsupported_config');
   if(Object.hasOwn(current,match[1]))throw TypeError('qa_duplicate_key');
   const value=match[2];
   current[match[1]]=value==='true'?true:value==='false'?false:
     JSON.parse(value);
 }
 if(sections.size!==3||!sections.has('vars')||!sections.has('d1_databases'))
   throw TypeError('qa_unexpected_sections');
 return {
   top:sections.get('top'),
   vars:sections.get('vars'),
   database:sections.get('d1_databases')
 };
}
export function inspectQaBootstrap(wrangler,liveSnapshot){
 const issues=[];
 let cfg;
 try{cfg=parseTomlSubset(wrangler);}
 catch{issues.push('WRANGLER_CONFIG_PARSE_OR_SCOPE_FAILED');}
 if(cfg){
  for(const [key,v] of Object.entries({top:expectedTop,vars:allowedVars,
      database})){
   if(!exact(cfg[key],Object.keys(v))||
      Object.keys(v).some(k=>cfg[key][k]!==v[k]))
      issues.push('LOCAL_'+key.toUpperCase()+'_MISMATCH');
  }
 }
 const s=liveSnapshot;
 if(!exact(s,snapshotKeys)||
  s.schema!=='atrio-cloudflare-qa-readonly-evidence-v1'||
  s.observedDate!=='2026-11-10'||
  s.source!=='Cloudflare API GET (manual inspection via connected account)'||
  s.worker!==worker||s.workerExists!==true||s.firebaseProject!==project||
  s.bootstrapOnly!==true||s.pushEnabled!==false||
  s.broadcastEnabled!==false||s.guardiaoEnabled!==false||
  s.qaManualEnabled!==false||s.workersDevEnabled!==false||
  s.previewUrlsEnabled!==false||s.schedulesCount!==0||
  s.d1BindingName!=='PUSH_DB'||s.d1DatabaseName!==db||
  s.d1DatabaseId!==uuid||s.verifiedWorkerCode!==false||
  s.verifiedD1Contents!==false||
  s.firebaseQaRulesAuditedInThisStep!==false||
  s.qaDeploymentAuthorized!==false)
  issues.push('RECORDED_CLOUDFLARE_SNAPSHOT_NOT_TRUSTED');
 return Object.freeze({
   report:'atrio_cloudflare_qa_bootstrap_source_snapshot_audit',
   status:'NO_GO',
   scope:'LOCAL_GIT_AND_HISTORIC_READONLY_SNAPSHOT',
   snapshotDate:'2026-11-10',
   sourceMatchesSnapshot:issues.length===0,
   snapshotIsLiveNow:false,
   qaWorkerEnabled:false,
   eventProcessingAuthorized:false,
   qaDeploymentAuthorized:false,
   productionContacted:false,
   secretsInspected:false,
   workerCodeVerifiedRemotely:false,
   d1RowsAudited:false,
   missingOrChanged:issues,
   blockers:[
    'POLICY_200_AND_REAL_18_PLUS_PROVIDER_PENDING',
    'CLOUD_WORKER_CODE_AND_D1_CONTENT_NOT_VERIFIED_BY_THIS_AUDIT',
    'LATEST_REMOTE_STATE_REQUIRES_FRESH_AUTHENTICATED_GET',
    'QA_ROLLOUT_AND_ROLLBACK_REQUIRE_SEPARATE_APPROVAL'
   ]
 });
}
export function reportMarkdown(r){
 return [
  '## Cloudflare QA — comparação de configuração e captura read-only',
  '',
  '**NO-GO para implantação ou ativação do chat.**',
  '- Base: '+r.snapshotDate+', não constitui prova de estado atual.',
  '- Configuração Git combina com a captura: '+(r.sourceMatchesSnapshot?'sim':'não'),
  '- Worker runtime remoto e linhas D1 não foram verificados aqui.',
  '- Nenhuma gravação, deploy, alteração de backup ou envio FCM.',
  '',
  ...r.missingOrChanged.map(x=>'- Inconsistência: '+x),
  '',
  'Repetir consulta autenticada somente leitura antes do marco 4.',
  ''
 ].join('\n');
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length>3||
     (process.argv.length===3&&process.argv[2]!=='--markdown'))
    throw Error('args');
  const toml=readFileSync(new URL('../cloudflare/qa-general-worker/wrangler.toml',import.meta.url),'utf8');
  const snapshot=JSON.parse(readFileSync(new URL('../docs/qa-homologacao/CLOUDFLARE-QA-CAPTURA-20261110.json',import.meta.url),'utf8'));
  const result=inspectQaBootstrap(toml,snapshot);
  process.stdout.write(process.argv[2]==='--markdown'?reportMarkdown(result):
    JSON.stringify(result,null,2)+'\n');
  if(!result.sourceMatchesSnapshot)process.exitCode=1;
 }catch{console.error('qa_cloudflare_preflight_failed_closed');process.exitCode=1;}
}
