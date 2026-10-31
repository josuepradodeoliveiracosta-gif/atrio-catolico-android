/**
 * Offline-only Cloudflare staging configuration guard.
 *
 * This script proves that the checked-in template is NOT deployable. It does
 * not approve a remote deployment, provision resources, or inspect secrets.
 */
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const stage='cloudflare/privacy-freeze-stage';
const danger=['wrangler.toml','wrangler.json','wrangler.jsonc',
  '.dev.vars','.env','.env.production','.env.staging'];
const qaFlags=['ATRIO_PRIVACY_QA_SHARED_MODE','ATRIO_PRIVACY_QA_WRITE_FENCE',
  'ATRIO_PRIVACY_QA_SCOPED_FENCE','ATRIO_QA_PRIVACY_STAGE_BINDING',
  'ATRIO_QA_PRIVACY_STAGE_SECRET'];
const q=/^\s*(?:route|routes|account_id|zone_id|triggers|services|placement|env)\s*=/im;
const has=(arr,s)=>arr.includes(s);
export function checkStagePreflight({template,migration,realWorkerConfigs={},
  activeStageFiles=[]}={}){
  const blockers=[];
  const add=(name,rule)=>{if(!rule)blockers.push(name)};
  if(typeof template!=='string'||typeof migration!=='string')
    return Object.freeze({ready:false,templateSafe:false,
      blockers:['stage_sources_missing']});
  const config=template.split('\n').map(line=>line.replace(/\s*#.*$/,'').trim())
    .filter(Boolean).join('\n');
  add('stage_requires_private_workers_dev_false',
    /^workers_dev\s*=\s*false$/m.test(config)&&
    !/^workers_dev\s*=\s*true$/m.test(config));
  add('stage_requires_unique_internal_name',
    /^name\s*=\s*"atrio-privacy-freeze-qa-internal"$/m.test(config));
  add('stage_must_remain_non_deployable_placeholder',
    /^database_id\s*=\s*"REPLACE_WITH_NEW_DEDICATED_STAGING_D1_ID"$/m.test(config) &&
    (config.match(/^database_id\s*=/gm)||[]).length===1);
  add('stage_requires_dedicated_db_name_and_binding',
    /^database_name\s*=\s*"atrio-privacy-freeze-stage-fixtures"$/m.test(config) &&
    /^binding\s*=\s*"STAGE_FREEZE_DB"$/m.test(config) &&
    /^migrations_dir\s*=\s*"migrations"$/m.test(config));
  add('stage_must_not_have_public_routes_or_account_binding',!q.test(config) &&
    !/^\s*\[\[(?:routes|services)\]\]/m.test(config) &&
    !/^\s*\[(?:triggers|env\.)/m.test(config));
  add('stage_demo_id_required',
    /^ATRIO_PRIVACY_STAGE_ID\s*=\s*"demo-atrio-v11"$/m.test(config));
  add('no_secret_values_in_stage_configuration',
    !/^\s*STAGE_(?:AVATAR|GUARDIAN|PUSH|ADMIN|RECONCILER)_HMAC\s*=/m.test(config) &&
    !/FIREBASE_(?:SERVICE_ACCOUNT|WEB_API_KEY)\s*=/.test(config));
  add('no_active_stage_deploy_configuration',
    Array.isArray(activeStageFiles)&&activeStageFiles.length===0);
  add('schema_restricts_accounts_to_fixed_demo_users',
    /CHECK\s*\(\s*uid\s+IN\s*\(\s*'qa-freeze-alice'\s*,\s*'qa-freeze-bob'\s*\)\s*\)/i.test(migration) &&
    /CREATE TABLE qa_stage_nonces/.test(migration) &&
    /INSERT INTO qa_privileged_accounts/.test(migration) &&
    !/\b(?:ATTACH|DROP\s+TABLE|DELETE\s+FROM|PRAGMA\s+foreign_keys\s*=\s*OFF)\b/i.test(migration));
  for(const role of ['avatar','guardian','push']){
    const source=realWorkerConfigs[role];
    if(source===null||source===undefined)continue;
    const effective=source.split('\n').map(line=>line.replace(/\s*#.*$/,'').trim())
      .filter(Boolean).join('\n');
    add('live_'+role+'_must_not_enable_qa_stage',
      !qaFlags.some(flag=>new RegExp('^'+flag+'\\s*=','m').test(effective)) &&
      !/STAGE_FREEZE_DB|atrio-privacy-freeze-stage-fixtures/.test(effective));
  }
  return Object.freeze({ready:false,templateSafe:blockers.length===0,
    blockers:Object.freeze(blockers)});
}
export function auditCheckedInStage(){
  const read=p=>readFileSync(join(root,p),'utf8');
  const local={};
  for(const worker of ['avatar','guardian','push']){
    const filepath=join(root,'cloudflare',worker+'-worker','wrangler.toml');
    local[worker]=existsSync(filepath)?readFileSync(filepath,'utf8'):null;
  }
  return checkStagePreflight({
    template:read(stage+'/wrangler.staging.example.toml'),
    migration:read(stage+'/migrations/0001_fixture_only.sql'),
    realWorkerConfigs:local,
    activeStageFiles:danger.filter(f=>existsSync(join(root,stage,f)))
  });
}
const isEntrypoint=process.argv[1] &&
  resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isEntrypoint){
  const result=auditCheckedInStage();
  if(process.argv.length!==3||process.argv[2]!=='--audit'){
    process.stderr.write('Stage deployment is NOT authorized by this script. Audit only.\n');
    process.exitCode=2;
  }else if(!result.templateSafe){
    process.stderr.write('Privacy stage template blocked: '+result.blockers.join(', ')+'\n');
    process.exitCode=1;
  }else{
    process.stdout.write('QA stage template safe and intentionally NONDEPLOYABLE. No remote resources touched.\n');
  }
}
