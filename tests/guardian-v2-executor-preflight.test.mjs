import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {assessOfflineExecutorPreflight,illustrativeBudget}
  from '../scripts/guardian_v2_executor_preflight.mjs';

const repo='josuepradodeoliveiracosta-gif/atrio-catolico-android';
const good={
  GITHUB_REPOSITORY:repo,
  GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_REF:'refs/heads/main',
  GITHUB_WORKFLOW_REF:repo+
    '/.github/workflows/guardiao-v2-executor-preflight.yml@refs/heads/main',
  GUARDIAN_EXECUTOR_DRY_RUN:'true',
  GUARDIAN_V2_TEST_MODE:'true',
  GUARDIAN_V2_ENABLED:'false',
  GUARDIAN_V2_HOLD_ENABLED:'false',
  GUARDIAN_V2_PRODUCTION_APPROVED:'false',
  GUARDIAN_V2_IDENTITY_APPROVED:'false',
  GUARDIAN_V2_HOLD_APPROVED:'false',
};

test('contexto preciso aprova APENAS plano offline, nunca operação autônoma',()=>{
  const r=assessOfflineExecutorPreflight(good);
  assert.equal(r.status,'OFFLINE_PREFLIGHT_ONLY');
  assert.equal(r.offlineAllowed,true);
  assert.equal(r.productionAuthorized,false);
  assert.equal(r.githubOidcRequested,false);
  assert.equal(r.firestoreRequestsAllowed,0);
  assert.equal(r.cloudflareRequestsAllowed,0);
  assert.equal(r.nextPhase,'NO_GO_PRODUCTION');
  assert.equal(r.missingProductionApprovals.length,6);
});

test('nenhum cron, PR, push, fork ou ramo diferente tem autorização',()=>{
  for(const patch of [
    {GITHUB_EVENT_NAME:'schedule'},
    {GITHUB_EVENT_NAME:'pull_request'},
    {GITHUB_EVENT_NAME:'push'},
    {GITHUB_REPOSITORY:'foreign/fork'},
    {GITHUB_REF:'refs/heads/feature'},
    {GITHUB_REF:'refs/tags/v1'},
  ]){
    const r=assessOfflineExecutorPreflight({...good,...patch});
    assert.equal(r.status,'DENIED');
    assert.equal(r.productionAuthorized,false);
  }
});

test('workflow de outra origem e workflow_ref ausente são negados',()=>{
  for(const ref of ['',undefined,
    repo+'/.github/workflows/build-apk.yml@refs/heads/main',
    repo+'/.github/workflows/guardiao-v2-executor-preflight.yml@refs/heads/qa']){
    assert.equal(assessOfflineExecutorPreflight(
      {...good,GITHUB_WORKFLOW_REF:ref}).offlineAllowed,false);
  }
});

test('flags de produção e retenção jamais são tratadas como simples QA',()=>{
  for(const flag of [
    'GUARDIAN_V2_ENABLED','GUARDIAN_V2_HOLD_ENABLED',
    'GUARDIAN_V2_PRODUCTION_APPROVED','GUARDIAN_V2_IDENTITY_APPROVED',
    'GUARDIAN_V2_HOLD_APPROVED']){
    assert.equal(assessOfflineExecutorPreflight({...good,[flag]:'true'}).offlineAllowed,false);
  }
});

test('sem modo teste e sem dry-run, o pré-voo é negado',()=>{
  for(const patch of [
    {GUARDIAN_EXECUTOR_DRY_RUN:'false'},
    {GUARDIAN_EXECUTOR_DRY_RUN:undefined},
    {GUARDIAN_V2_TEST_MODE:'false'},
    {GUARDIAN_V2_TEST_MODE:undefined}
  ]) assert.equal(assessOfflineExecutorPreflight({...good,...patch}).offlineAllowed,false);
});

test('nenhuma credencial pode entrar no planejamento de simulação',()=>{
  for(const key of [
    'QA_ACCESS_TOKEN','GOOGLE_APPLICATION_CREDENTIALS',
    'GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON','GUARDIAN_FIREBASE_OAUTH_TOKEN',
    'GUARDIAN_V2_SERVICE_ACCOUNT_JSON','GUARDIAN_OAUTH_ACCESS_TOKEN',
    'GITHUB_TOKEN']){
    const result=assessOfflineExecutorPreflight({...good,[key]:'private-demo-token'});
    assert.equal(result.offlineAllowed,false);
    assert.ok(result.blockers.includes('credential_present'));
    assert.ok(!JSON.stringify(result).includes('private-demo-token'));
  }
});

test('ponte remota e despacho QA também são bloqueados',()=>{
  for(const key of [
    'GUARDIAN_V2_QA_AUTO_DISPATCH','GUARDIAN_QA_REMOTE_READY',
    'GUARDIAN_V2_QA_SHADOW_READS','GUARDIAN_V2_QA_FIRESTORE_BRIDGE']){
    const result=assessOfflineExecutorPreflight({...good,[key]:'true'});
    assert.equal(result.offlineAllowed,false);
    assert.ok(result.blockers.includes('remote_qa_enabled'));
  }
});

test('previsão de 24 execuções e 192 leituras NÃO representa reserva real',()=>{
  const result=illustrativeBudget();
  assert.equal(result.plannedRunsPerDay,24);
  assert.equal(result.illustrativeMaxDocumentReads,192);
  assert.equal(result.readCapPerRun,8);
  assert.equal(result.writesAllowed,0);
  assert.equal(result.deletesAllowed,0);
  assert.equal(result.persistentBudgetReservation,false);
  assert.equal(result.firestoreQuotaGuarantee,false);
});

test('planejamento rejeita intervalo inválido ou excessivo e leituras acima de oito',()=>{
  for(const plan of [
    {intervalMinutes:5},{intervalMinutes:31},{intervalMinutes:1441},
    {intervalMinutes:0},{intervalMinutes:NaN},{intervalMinutes:'60'},
    {readsPerRun:0},{readsPerRun:9},{readsPerRun:1.5}
  ]){
    assert.throws(()=>illustrativeBudget(plan),/invalid_/);
    assert.equal(assessOfflineExecutorPreflight(good,plan).offlineAllowed,false);
  }
});

test('um cenário permitido jamais deixa de indicar NO-GO de produção',()=>{
  for(const plan of [
    {},{intervalMinutes:60,readsPerRun:1},
    {intervalMinutes:30,readsPerRun:8},
    {intervalMinutes:1440,readsPerRun:8}
  ]){
    const r=assessOfflineExecutorPreflight(good,plan);
    assert.equal(r.productionAuthorized,false);
    assert.equal(r.nextPhase,'NO_GO_PRODUCTION');
    assert.ok(r.illustrativeBudget.illustrativeMaxDocumentReads<=384);
  }
});

test('workflow não possui cron, id-token, secrets, deploy ou Firebase remoto',()=>{
  const flow=readFileSync(new URL(
    '../.github/workflows/guardiao-v2-executor-preflight.yml',import.meta.url),'utf8');
  assert.match(flow,/workflow_dispatch:/);
  assert.match(flow,/pull_request:/);
  assert.match(flow,/permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(flow,/\bschedule\s*:/);
  assert.doesNotMatch(flow,/\bid-token\s*:/);
  assert.doesNotMatch(flow,/\b(firebase deploy|wrangler deploy|auth@v3|firebase emulators|service_account)\b/i);
  assert.match(flow,/node --test tests\/guardian-v2-executor-preflight\.test\.mjs/);
});

test('execução CLI imprime só estado e limites; sem token ou dados pessoais',()=>{
  const output=execFileSync(process.execPath,
    ['scripts/guardian_v2_executor_preflight.mjs'],{
      cwd:new URL('..',import.meta.url),
      env:{PATH:process.env.PATH,...good},
      encoding:'utf8',
    });
  assert.match(output,/OFFLINE_PREFLIGHT_ONLY/);
  assert.match(output,/NO_GO_PRODUCTION/);
  assert.doesNotMatch(output,/private_key|access_token|authorization: Bearer/i);
});
