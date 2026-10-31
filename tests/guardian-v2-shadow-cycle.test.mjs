import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runShadowCycle,checkDailyWorkflowRuns,validateShadowContext}
  from '../scripts/guardian-v2-shadow-cycle.mjs';

const repo='josuepradodeoliveiracosta-gif/atrio-catolico-android';
const env={
  GITHUB_REPOSITORY:repo,GITHUB_REF:'refs/heads/main',
  GITHUB_WORKFLOW_REF:repo+'/.github/workflows/guardiao-v2-prod-runner.yml@refs/heads/main',
  GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ATTEMPT:'1',
  GUARDIAN_V2_SHADOW_ONLY:'true',GUARDIAN_V2_HOLD_ENABLED:'false',
  GUARDIAN_V2_WRITE_ENABLED:'false',
  GH_READ_TOKEN:'github-test-token-of-valid-length',
  WIF_ACCESS_TOKEN:'fake-access-token-of-valid-length',
};
const root='projects/atrio-catolico/databases/(default)/documents';
const response=(value,status=200)=>({
  status,headers:{get:()=>null},json:async()=>value,text:async()=>JSON.stringify(value)
});
const policy=(enabled=false,stop=false,hold=false,shadow=true)=>({
  name:root+'/guardian_config/policy',
  fields:{enabled:{booleanValue:enabled},
    emergencyStop:{booleanValue:stop},allowHold:{booleanValue:hold},
    shadowEnabled:{booleanValue:shadow}}
});
function mocked({config=policy(),docs=[[],[]],count=1,http=200}={}){
  const calls=[];let n=0;
  const fn=async(url,opts={})=>{
    calls.push({url,opts});
    if(url.startsWith('https://api.github.com/'))return response({total_count:count});
    if(url.includes('guardian_config/policy'))return response(config,http);
    if(url.endsWith(':runQuery'))return response(docs[n++]||[]);
    throw Error('unexpected network request');
  };
  return {fn,calls};
}
test('somente contexto exato, sem escrita, nem branches/retentativas indevidas',()=>{
  assert.doesNotThrow(()=>validateShadowContext(env));
  for(const patch of [
    {GITHUB_REPOSITORY:'some/fork'},{GITHUB_REF:'refs/heads/dev'},
    {GITHUB_WORKFLOW_REF:'other'},{GITHUB_EVENT_NAME:'pull_request'},
    {GITHUB_RUN_ATTEMPT:'2'},{GUARDIAN_V2_SHADOW_ONLY:'false'},
    {GUARDIAN_V2_HOLD_ENABLED:'true'},{GUARDIAN_V2_WRITE_ENABLED:'true'},
    {GH_READ_TOKEN:''},{WIF_ACCESS_TOKEN:''},
    {GITHUB_EVENT_NAME:'workflow_dispatch',CONFIRM_IDENTITY:'false',CONFIRM_SHADOW:'true'},
    {GITHUB_EVENT_NAME:'workflow_dispatch',CONFIRM_IDENTITY:'true',CONFIRM_SHADOW:'false'}
  ])assert.throws(()=>validateShadowContext({...env,...patch}),/context_denied/);
  assert.doesNotThrow(()=>validateShadowContext({...env,GITHUB_EVENT_NAME:'workflow_dispatch',
    CONFIRM_IDENTITY:'true',CONFIRM_SHADOW:'true'}));
});
test('limite cumulativo de execuções deste workflow; falhar fechado sem API',async()=>{
  assert.equal(await checkDailyWorkflowRuns(env,mocked({count:24}).fn,'2026-10-31'),24);
  await assert.rejects(checkDailyWorkflowRuns(env,mocked({count:25}).fn,'2026-10-31'),/daily_run_cap/);
  await assert.rejects(checkDailyWorkflowRuns(env,async()=>response({},403),'2026-10-31'),/budget_unavailable/);
  await assert.rejects(checkDailyWorkflowRuns(env,async()=>{throw Error('offline')},'2026-10-31'),/budget_unavailable/);
});
test('emergência, desativação ou autorização de retenção pausam antes de consultar posts',async()=>{
  for(const config of [
    policy(false,false,false,false), // Observador desligado
    policy(false,true,false,true),  // Emergência geral
    policy(false,false,true,true),  // Retenção incompatível
    policy(true,false,false,true),  // Nunca observar com motor ligado
  ]){
    const {fn,calls}=mocked({config});
    assert.deepEqual(await runShadowCycle(env,fn,undefined,'2026-10-31'),
      {status:'PAUSED_BY_POLICY',documents:0,signals:0});
    assert.equal(calls.filter(c=>c.url.endsWith(':runQuery')).length,0);
  }
});
test('política anterior sem shadowEnabled desliga a observação por padrão',async()=>{
  const legacy={name:root+'/guardian_config/policy',
    fields:{enabled:{booleanValue:false},emergencyStop:{booleanValue:false},
      allowHold:{booleanValue:false}}};
  const {fn,calls}=mocked({config:legacy});
  assert.deepEqual(await runShadowCycle(env,fn,undefined,'2026-10-31'),
    {status:'PAUSED_BY_POLICY',documents:0,signals:0});
  assert.equal(calls.filter(x=>x.url.endsWith(':runQuery')).length,0);
});
test('modo sombra aprovado funciona com motor de moderação desligado',async()=>{
  const {fn,calls}=mocked({config:policy(false,false,false,true)});
  assert.deepEqual(await runShadowCycle(env,fn,undefined,'2026-10-31'),
    {status:'READONLY_SHADOW_OK',documents:0,signals:0});
  assert.equal(calls.filter(x=>x.url.endsWith(':runQuery')).length,2);
});
test('apenas dois posts e duas respostas, sem texto ou IDs no resultado',async()=>{
  const docs=[
    [{document:{name:root+'/posts/abc123',
      fields:{title:{stringValue:'Saudação'},body:{stringValue:'Tudo bem'}}}}],
    [{document:{name:root+'/posts/abc123/replies/reply123',
      fields:{body:{stringValue:'Vou te matar amanhã'}}}}]
  ];
  const {fn,calls}=mocked({docs});
  const result=await runShadowCycle(env,fn,undefined,'2026-10-31');
  assert.deepEqual(result,{status:'READONLY_SHADOW_OK',documents:2,signals:1});
  const f=calls.filter(c=>c.url.includes('firestore.googleapis.com'));
  assert.deepEqual(f.map(c=>c.opts.method),['GET','POST','POST']);
  for(const q of f.slice(1))assert.equal(JSON.parse(q.opts.body).structuredQuery.limit,2);
  assert.ok(!JSON.stringify(result).includes('abc123'));
  assert.ok(!JSON.stringify(result).includes('matar'));
});
test('permissão negada, configuração inválida e path privado bloqueiam leitura',async()=>{
  await assert.rejects(runShadowCycle(env,mocked({http:403}).fn),/firestore_http_403/);
  await assert.rejects(runShadowCycle(env,mocked({
    config:{name:root+'/guardian_config/policy',fields:{enabled:{booleanValue:true}}}
  }).fn),/policy_invalid/);
  await assert.rejects(runShadowCycle(env,mocked({docs:[
    [{document:{name:root+'/profiles/user',fields:{body:{stringValue:'private'}}}}],[]
  ]}).fn),/unexpected_document_path/);
});
test('workflow tem cron read-only, escopo OIDC e não contém deploy',()=>{
  const yml=readFileSync(new URL('../.github/workflows/guardiao-v2-prod-runner.yml',import.meta.url),'utf8');
  assert.match(yml,/cron: '17 \* \* \* \*'/);
  assert.match(yml,/actions: read/);
  assert.match(yml,/id-token: write/);
  assert.match(yml,/GUARDIAN_V2_SHADOW_ONLY: 'true'/);
  assert.match(yml,/GUARDIAN_V2_HOLD_ENABLED: 'false'/);
  assert.match(yml,/GUARDIAN_V2_WRITE_ENABLED: 'false'/);
  assert.doesNotMatch(yml,/firebase deploy|wrangler deploy|roles\/datastore.user/i);
});
