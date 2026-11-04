/** Strict, offline-only audit: template must REMAIN deliberately undeployable.
 * Neither this script nor CI provisions D1, secrets, routes or a Worker.
 */
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const area='cloudflare/privacy-batch-stage';
const active=['wrangler.toml','wrangler.json','wrangler.jsonc',
  '.dev.vars','.env','.env.production','.env.staging'];
const unsafe=/^\s*(?:account_id|zone_id|route|routes|services|triggers|observability|env)\s*=/m;
export function preflightBatchStage({template,schema,activeFiles=[],liveConfigs={}}={}){
  const blocked=[];
  const check=(label,passed)=>{if(!passed)blocked.push(label);};
  if(typeof template!=='string'||typeof schema!=='string')
    return Object.freeze({ready:false,templateSafe:false,blocked:['qa_missing_sources']});
  const clean=template.split('\n').map(s=>s.replace(/\s*#.*$/,'').trim())
    .filter(Boolean).join('\n');
  check('workers_private',/^workers_dev\s*=\s*false$/m.test(clean)&&
    /^preview_urls\s*=\s*false$/m.test(clean)&&
    !/^workers_dev\s*=\s*true$/m.test(clean));
  check('isolated_name',/^name\s*=\s*"atrio-qa-broadcast-cloud-internal"$/m.test(clean));
  check('not_deployable_placeholder',
    /^database_id\s*=\s*"REPLACE_WITH_NEW_DEDICATED_QA_D1_ID"$/m.test(clean)&&
    (clean.match(/^database_id\s*=/gm)||[]).length===1);
  check('dedicated_binding',/^binding\s*=\s*"QA_BATCH_STAGE_DB"$/m.test(clean)&&
    /^database_name\s*=\s*"atrio-qa-broadcast-fixture-only"$/m.test(clean)&&
    /^migrations_dir\s*=\s*"migrations"$/m.test(clean));
  check('fixture_gate',/^ATRIO_QA_BATCH_STAGE_ID\s*=\s*"demo-atrio-batch-cloud-v1"$/m.test(clean)&&
    /^QA_BATCH_MODE\s*=\s*"fixture-only"$/m.test(clean));
  check('no_live_binding_or_routes',!unsafe.test(clean)&&
    !/^\s*\[\[(?:services|routes|queues|r2_buckets)\]\]/m.test(clean)&&
    !/^\s*\[(?:env\.|triggers|observability)/m.test(clean)&&
    !/(?:FIREBASE_|CLOUDINARY_|PUSH_ENABLED|BROADCAST_ENABLED)\s*=/m.test(clean));
  check('no_embedded_credentials',
    !/^\s*QA_BATCH_(?:PUSH|ADMIN|RECONCILER)_HMAC\s*=/m.test(clean)&&
    !/^\s*(?:secret|token|api_key|password)\s*=/mi.test(clean));
  check('no_active_deploy_files',Array.isArray(activeFiles)&&activeFiles.length===0);
  const found=Array.from(schema.matchAll(/'qa-batch-0[0-8]'/g),x=>x[0]);
  check('nine_synthetic_accounts_only',
    new Set(found).size===9 &&
    /CREATE TABLE qa_bcast_accounts/.test(schema)&&
    /CREATE TABLE qa_bcast_nonces/.test(schema)&&
    /CREATE TABLE qa_bcast_deliveries/.test(schema)&&
    /uid TEXT PRIMARY KEY CHECK\s*\(\s*uid IN\s*\(/.test(schema)&&
    /fake_token TEXT NOT NULL CHECK/.test(schema)&&
    !/\b(?:DROP\s+TABLE|ATTACH|DELETE\s+FROM)\b/i.test(schema));
  const live=Object.values(liveConfigs);
  check('no_production_qa_bindings',live.every(s=>s==null||
    (typeof s==='string'&&!/QA_BATCH_STAGE_DB|atrio-qa-broadcast-fixture-only|ATRIO_QA_BATCH_STAGE_ID/.test(s))));
  return Object.freeze({ready:false,templateSafe:blocked.length===0,
    blocked:Object.freeze(blocked)});
}
/**
 * Review read-only Cloudflare inventory, supplied by an operator or a GET-only
 * audit. Never provisions D1/workers/secrets; never records account IDs in git.
 * Distinct Worker names or databases in ONE account are NOT account isolation.
 * A positive check still cannot authorize provisioning or deployment.
 */
export function assessQaCloudflareIsolation({
  qaAccountId,operationalAccountIds,
  qaWorkerName='atrio-qa-broadcast-cloud-internal',
  qaDatabaseName='atrio-qa-broadcast-fixture-only',
  workersByAccount,d1ByAccount
}={}){
  const issues=[];
  const add=(k,ok)=>{if(!ok)issues.push(k);};
  const idOk=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
  add('qa_account_not_identified',idOk(qaAccountId));
  add('operational_accounts_not_verified',
    Array.isArray(operationalAccountIds)&&operationalAccountIds.length>=1&&
    operationalAccountIds.every(idOk));
  if(idOk(qaAccountId)&&Array.isArray(operationalAccountIds))
    add('qa_account_must_be_separate',
      !operationalAccountIds.includes(qaAccountId));
  const workers=workersByAccount?.[qaAccountId];
  const databases=d1ByAccount?.[qaAccountId];
  add('qa_worker_inventory_missing',
    Array.isArray(workers)&&workers.every(x=>typeof x==='string'));
  add('qa_d1_inventory_missing',
    Array.isArray(databases)&&databases.every(x=>typeof x==='string'));
  if(Array.isArray(workers)){
    add('operational_workers_in_qa_account',
      !workers.some(x=>['atrio-push','atrio-avatares','atrio-guardian-v2']
        .includes(x)));
    add('target_worker_must_not_exist',!workers.includes(qaWorkerName));
  }
  if(Array.isArray(databases)){
    add('operational_d1_in_qa_account',
      !databases.some(x=>['atrio-push-delivery','atrio-avatar-control']
        .includes(x)));
    add('target_qa_d1_must_not_exist',!databases.includes(qaDatabaseName));
  }
  return Object.freeze({
    distinctAccountEvidenced:issues.length===0,
    provisioningAuthorized:false,
    deployAuthorized:false,
    blockers:Object.freeze(issues)
  });
}
export function auditBatchStageRepo(){
  const read=p=>readFileSync(join(root,p),'utf8');
  const live={};
  for(const service of ['avatar','guardian','push']){
    const p=join(root,'cloudflare',service+'-worker','wrangler.toml');
    live[service]=existsSync(p)?readFileSync(p,'utf8'):null;
  }
  return preflightBatchStage({
    template:read(area+'/wrangler.staging.example.toml'),
    schema:read(area+'/migrations/0001_fixture_only.sql'),
    activeFiles:active.filter(x=>existsSync(join(root,area,x))),
    liveConfigs:live
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const audit=auditBatchStageRepo();
  if(process.argv.length!==3||process.argv[2]!=='--audit'){
    process.stderr.write('Only offline audit supported; deployment NOT authorized.\n');
    process.exitCode=2;
  }else if(!audit.templateSafe){
    process.stderr.write('QA stage blocked: '+audit.blocked.join(',')+'\n');
    process.exitCode=1;
  }else process.stdout.write('Nondeployable QA staging template verified. No remote changes.\n');
}
