import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyBadgeDeployment, SELLOS_V2_RULES} from './selos-v2-production-guarded-deploy.mjs';

const sha256 = str => createHash('sha256').update(str, 'utf8').digest('hex');
const rulesText = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const oldFixture = rulesText + '\n// Fixture historica ficticia, nao producao';
const pins = {
  project: SELLOS_V2_RULES.project,
  previousSha256: sha256(oldFixture),
  targetSha256: sha256(rulesText)
};
const release = 'projects/atrio-catolico/releases/cloud.firestore';
const rulesets = {
  old: 'projects/atrio-catolico/rulesets/rules-old-tests',
  new: 'projects/atrio-catolico/rulesets/rules-new-tests'
};
const TOKEN = 'unit-test-oauth-token-not-real-123456789';
const makeFixture = ({
  initial = oldFixture,
  usePins = pins,
  afterFirstRead = null,
  config = '{"firestore":{"rules":"firestore.rules"}}'
} = {}) => {
  let active = initial;
  let deployed = 0;
  let readCount = 0;
  let tokenReads = 0;
  const requests = [];
  const queries = [];
  const fetcher = async(url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    assert.match(url, /^https:\/\/firebaserules.googleapis.com\/v1\/projects\/atrio-catolico\//);
    requests.push(url);
    if (url.endsWith('/releases/cloud.firestore')) {
      const wasTarget = active === rulesText;
      return Response.json({
        name: release, rulesetName: wasTarget ? rulesets.new : rulesets.old,
        updateTime: '2026-11-06T20:00:00Z'
      });
    }
    if (url.includes('/rulesets/')) {
      readCount++;
      queries.push(active);
      const response = Response.json({
        name: active === rulesText ? rulesets.new : rulesets.old,
        source: {files: [{name: 'firestore.rules', content: active}]}
      });
      if (afterFirstRead && readCount === 1) active = afterFirstRead;
      return response;
    }
    throw Error('GET endpoint inesperado');
  };
  let execDetails;
  const execute = (cmd, args, options) => {
    deployed++;
    execDetails = {cmd, args, options};
    active = rulesText;
  };
  const readFileFn = async (url, encoding) => {
    assert.equal(encoding, 'utf8');
    if (url.pathname.endsWith('/firebase.json')) return config;
    return rulesText;
  };
  const opts = {
    rulesText, fingerprints: usePins,
    tokenProvider: async() => {tokenReads++; return TOKEN;},
    fetcher, execute, readFileFn
  };
  return {opts, stats:() => ({
    deployed, requests: requests.length, readCount, tokenReads, execDetails, queries
  })};
};

test('fingerprint real do arquivo versionado coincide com o selo V2 fixado', () => {
  assert.equal(sha256(rulesText), SELLOS_V2_RULES.targetSha256);
  assert.match(SELLOS_V2_RULES.previousSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(SELLOS_V2_RULES.previousSha256, SELLOS_V2_RULES.targetSha256);
});

test('sem argumentos faz apenas GET e nunca chama Firebase CLI', async() => {
  const f = makeFixture();
  const r = await verifyBadgeDeployment(f.opts);
  assert.equal(r.mode, 'READ_ONLY_PREVIEW');
  assert.equal(r.canDeployWhenAuthorized, true);
  assert.equal(r.changedByThisCommand, false);
  assert.equal(r.backupModified, false);
  assert.equal(r.releaseApproved, false);
  assert.deepEqual({deployed:f.stats().deployed,requests:f.stats().requests,tokenReads:f.stats().tokenReads},
    {deployed:0,requests:2,tokenReads:1});
});

test('publicação exige SHA remoto antigo, revalida e confirma novo SHA', async() => {
  const f = makeFixture();
  const r = await verifyBadgeDeployment({...f.opts, apply:true});
  assert.equal(r.mode, 'GUARDED_FIRESTORE_RULES_ONLY');
  assert.equal(r.changedByThisCommand, true);
  assert.equal(r.publishedSha256, pins.targetSha256);
  assert.equal(f.stats().deployed, 1);
  assert.equal(f.stats().requests, 6);
  assert.deepEqual(f.stats().execDetails.args,
    ['deploy','--only','firestore:rules','--project','atrio-catolico','--non-interactive']);
  assert.equal(f.stats().execDetails.cmd, 'firebase');
  assert.equal(f.stats().execDetails.options.timeout, 180000);
  assert.equal(r.backupModified, false);
  assert.equal(r.releaseApproved, false);
});

test('mudança concorrente das regras aborta sem executar deploy', async() => {
  const f = makeFixture({afterFirstRead:rulesText+'\n// versão remota modificada durante a auditoria'});
  await assert.rejects(verifyBadgeDeployment({...f.opts,apply:true}),
    /atrio_selos_guard_production_rules_changed_during_run/);
  assert.equal(f.stats().deployed, 0);
});

test('regras de produção inesperadas falham antes de qualquer escrita', async() => {
  const f = makeFixture({initial:rulesText+'\n// regras alteradas por outra publicação'});
  await assert.rejects(verifyBadgeDeployment({...f.opts,apply:true}),
    /atrio_selos_guard_production_rules_changed_since_audit/);
  assert.equal(f.stats().deployed, 0);
  assert.equal(f.stats().requests, 2);
});

test('se o destino já estiver publicado, não reimplanta', async() => {
  const f = makeFixture({initial:rulesText});
  const r = await verifyBadgeDeployment({...f.opts,apply:true});
  assert.equal(r.alreadyPublished, true);
  assert.equal(r.changedByThisCommand, false);
  assert.equal(f.stats().deployed, 0);
});

test('repositório modificado aborta antes de obter token', async() => {
  const f = makeFixture();
  await assert.rejects(verifyBadgeDeployment({...f.opts,rulesText:rulesText+' alterado',apply:true}),
    /atrio_selos_guard_repository_rules_changed/);
  assert.equal(f.stats().requests, 0);
  assert.equal(f.stats().tokenReads, 0);
});

test('firebase.json alterado bloqueia antes de rede', async() => {
  const f = makeFixture({config:'{"firestore":{"rules":"outro-arquivo.rules"}}'});
  await assert.rejects(verifyBadgeDeployment({...f.opts,apply:true}),
    /atrio_selos_guard_firebase_config_changed/);
  assert.equal(f.stats().deployed, 0);
  assert.equal(f.stats().tokenReads, 0);
});

test('falha de confirmação após CLI não declara publicação concluída', async() => {
  const f = makeFixture();
  const opts = {
    ...f.opts, apply:true,
    execute: () => { /* Simula CLI retornando sem publicar */ }
  };
  await assert.rejects(verifyBadgeDeployment(opts),
    /atrio_selos_guard_published_sha_not_confirmed/);
});

test('CLI que falha não vira sucesso ou rollback automático', async() => {
  const f = makeFixture();
  await assert.rejects(verifyBadgeDeployment({
    ...f.opts, apply:true, execute:()=>{throw Error('CLI falhou');}
  }), /atrio_selos_guard_firebase_cli_failed_verify_production_manually/);
});
