import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkStagePreflight,auditCheckedInStage}
  from '../../privacy-freeze-stage/scripts/preflight.mjs';

const template=readFileSync(
  new URL('../../privacy-freeze-stage/wrangler.staging.example.toml',
    import.meta.url),'utf8');
const migration=readFileSync(
  new URL('../../privacy-freeze-stage/migrations/0001_fixture_only.sql',
    import.meta.url),'utf8');
const check=(extra={})=>checkStagePreflight({template,migration,...extra});
test('Cloudflare staging config remains a nondeployable fixture-only example',()=>{
  const current=auditCheckedInStage();
  assert.equal(current.ready,false);
  assert.equal(current.templateSafe,true,
    'Stage template must remain nondeployable and isolated');
  assert.deepEqual(current.blockers,[]);
});
test('a real D1 ID, workers_dev, a public route or live stage config fails preflight',()=>{
  const alternatives=[
    {template:template.replace('REPLACE_WITH_NEW_DEDICATED_STAGING_D1_ID',
      '11111111-2222-4333-8444-555555555555')},
    {template:template.replace('workers_dev = false','workers_dev = true')},
    {template:template+'\nroute = "example.com/stage/*"\n'},
    {template:template+'\n[[routes]]\npattern = "example.com"\n'},
    {template:template+'\naccount_id = "real-account"\n'},
    {activeStageFiles:['wrangler.toml']}
  ];
  for(const config of alternatives){
    const result=check(config);
    assert.equal(result.ready,false);
    assert.equal(result.templateSafe,false,JSON.stringify(config));
    assert.ok(result.blockers.length>0);
  }
});
test('secrets must not be committed to the staging template',()=>{
  for(const name of ['STAGE_AVATAR_HMAC','STAGE_RECONCILER_HMAC',
    'FIREBASE_SERVICE_ACCOUNT_JSON']){
    const result=check({template:template+'\n'+name+' = "not-allowed"\n'});
    assert.equal(result.templateSafe,false,name);
  }
});
test('the staging migration must reject real UIDs and not destroy tables',()=>{
  const cases=[
    migration.replace("'qa-freeze-alice','qa-freeze-bob'","'real-user','qa-freeze-bob'"),
    migration+'\nDROP TABLE qa_privileged_accounts;',
    migration.replace('CREATE TABLE qa_stage_nonces','CREATE TABLE unrelated')
  ];
  for(const sql of cases){
    const result=check({migration:sql});
    assert.equal(result.templateSafe,false);
    assert.ok(result.blockers.includes('schema_restricts_accounts_to_fixed_demo_users'));
  }
});
test('an actual Push/Avatar/Guardian deployment config may not enable QA bindings',()=>{
  for(const role of ['push','avatar','guardian']){
    for(const value of [
      'ATRIO_PRIVACY_QA_SHARED_MODE = "true"',
      'ATRIO_QA_PRIVACY_STAGE_BINDING = "stage"',
      'STAGE_FREEZE_DB = "production"'
    ]){
      const result=check({realWorkerConfigs:{[role]:value}});
      assert.equal(result.templateSafe,false,role+': '+value);
      assert.ok(result.blockers.some(b=>b.includes('live_'+role)));
    }
  }
});
test('no preflight option can declare stage ready for remote deployment',()=>{
  for(const config of [{},{activeStageFiles:['.env']},
    {template:template.replace('workers_dev = false','workers_dev = true')}]) {
    assert.equal(check(config).ready,false);
  }
});
