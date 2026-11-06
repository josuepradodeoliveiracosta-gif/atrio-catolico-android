import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  badgesRulesPresence, markerNames,
  summarizeBadgesDeployment, auditProductionBadges
} from './selos-v2-production-preflight.mjs';

const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const token = 'oauth-mock-not-a-real-token-abcdefghijklmnopqrstuvwxyz';
const projectRelease = 'projects/atrio-catolico/releases/cloud.firestore';
const projectRuleset = 'projects/atrio-catolico/rulesets/audit-preview-20261106';
const mockFetcher = (remote, calls) => async (url, opts) => {
  calls.push({url, opts});
  assert.equal(opts.method, 'GET');
  assert.equal(opts.redirect, 'error');
  assert.equal(opts.cache, 'no-store');
  assert.equal(opts.headers.Authorization, 'Bearer ' + token);
  assert.match(url, /^https:\/\/firebaserules\.googleapis\.com\/v1\/projects\/atrio-catolico\//);
  if (url.endsWith('/releases/cloud.firestore')) {
    return Response.json({
      name: projectRelease,
      rulesetName: projectRuleset,
      updateTime: '2026-11-06T18:00:00Z'
    });
  }
  if (url.endsWith('/rulesets/audit-preview-20261106')) {
    return Response.json({
      name: projectRuleset,
      source: {files: [{name: 'firestore.rules', content: remote}]}
    });
  }
  throw Error('Unexpected read');
};

test('os sete controles mínimos estão presentes nas regras integradas', () => {
  assert.equal(markerNames.length, 7);
  const actual = badgesRulesPresence(rules);
  assert.equal(Object.values(actual).every(Boolean), true);
});

test('consulta somente 2 GET e nunca autoriza deploy, nem com regras idênticas', async () => {
  const calls = [];
  let logins = 0;
  const report = await auditProductionBadges({
    repositoryRules: rules,
    tokenProvider: async () => {logins++; return token;},
    fetcher: mockFetcher(rules, calls)
  });
  assert.equal(logins, 1);
  assert.equal(calls.length, 2);
  assert.equal(report.project, 'atrio-catolico');
  assert.equal(report.mode, 'READ_ONLY_NO_DEPLOY_NO_BACKUP');
  assert.equal(report.exactMatch, true);
  assert.equal(report.requiresManualReview, false);
  assert.equal(report.deploymentApproved, false);
  assert.equal(report.releaseApproved, false);
  assert.equal(report.backupModified, false);
  assert.equal(report.publishedSha256, report.repositorySha256);
  assert.ok(Object.values(report.publishedBadgeControls).every(Boolean));
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes('rules_version'), false);
  assert.equal(serialized.includes('service cloud.firestore'), false);
});

test('diferença em produção é sinalizada sem imprimir a fonte e sem autorização', async () => {
  const calls = [];
  const remote = rules + '\n// bloco específico de produção, precisa revisão humana';
  const report = await auditProductionBadges({
    repositoryRules: rules,
    tokenProvider: async () => token,
    fetcher: mockFetcher(remote, calls)
  });
  assert.equal(calls.length, 2);
  assert.equal(report.exactMatch, false);
  assert.equal(report.requiresManualReview, true);
  assert.ok(report.publishedOnlyLines > 0);
  assert.equal(report.deploymentApproved, false);
  assert.equal(JSON.stringify(report).includes('bloco específico'), false);
});

test('função de auditoria rejeita marcadores de segurança ausentes no repositório', async () => {
  const missing = rules.replace('function badgeEventMatchesTransition(', 'function alteredTransition(');
  let tokenAccesses = 0;
  await assert.rejects(auditProductionBadges({
    repositoryRules: missing,
    tokenProvider: async () => {tokenAccesses++; return token;}
  }), /atrio_selos_preflight_repository_missing_badge_controls/);
  assert.equal(tokenAccesses, 0);
});

test('403 da API falha fechado sem registrar deploy ou aceitação', async () => {
  await assert.rejects(auditProductionBadges({
    repositoryRules: rules,
    tokenProvider: async () => token,
    fetcher: async () => new Response('', {status: 403})
  }), /atrio_rules_diff_permission_denied/);
});

test('relatório puro preserva a exigência de revisão mesmo com estrutura presente', () => {
  const published = rules.replace(
    'match /badge_events/{eventId} {',
    'match /badge_events/{eventId} {\n      // alteração não auditada'
  );
  const output = summarizeBadgesDeployment({
    repositoryRules: rules,
    publishedRules: published
  });
  assert.equal(output.publishedBadgeControls.privateAuditEvents, true);
  assert.equal(output.requiresManualReview, true);
  assert.equal(output.deploymentApproved, false);
});
