#!/usr/bin/env node
/**
 * Átrio Católico — diagnóstico somente leitura da ativação dos selos V2.
 *
 * Exige sessão Firebase CLI JÁ autenticada no Termux. Consulta a release
 * Firestore realmente publicada (dois GET HTTPS); não modifica a produção,
 * não cria arquivos, não acessa bancos de usuários e não lê segredos em disco.
 * A saída omite as fontes completas das regras e credenciais.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  fetchPublishedRules, summarizePublishedVsRepository
} from './termux-firestore-rules-diff-readonly.mjs';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const error = code => { throw Error('atrio_selos_preflight_' + code); };

// Estes marcadores são apenas uma pré-checagem estrutural, nunca uma prova de
// segurança. A aprovação depende de CI, conferência humana e ambiente de teste.
const MARKERS = Object.freeze({
  founderAuthorization: /function\s+isFounderAdmin\s*\(/,
  publicBadges: /match\s+\/badges\/\{uid\}\s*\{/,
  verificationRequests: /match\s+\/badge_requests\/\{uid\}\s*\{/,
  privateAuditEvents: /match\s+\/badge_events\/\{eventId\}\s*\{/,
  atomicApproval: /function\s+approvedClergyGrant\s*\(/,
  atomicRevocation: /function\s+revokedVerifiedBadge\s*\(/,
  auditedTransition: /function\s+badgeEventMatchesTransition\s*\(/
});
export const markerNames = Object.freeze(Object.keys(MARKERS));

export function badgesRulesPresence(source) {
  if (typeof source !== 'string' || source.length < 1000)
    error('invalid_rules_source');
  return Object.fromEntries(
    Object.entries(MARKERS).map(([key, regex]) => [key, regex.test(source)])
  );
}

/** Resumo de hashes e presença, sem linhas completas ou dados pessoais. */
export function summarizeBadgesDeployment({
  publishedRules, repositoryRules, publishedAt = null, rulesetName = null
}) {
  const local = badgesRulesPresence(repositoryRules);
  const published = badgesRulesPresence(publishedRules);
  if (!Object.values(local).every(Boolean))
    error('repository_missing_badge_controls');

  const diff = summarizePublishedVsRepository(publishedRules, repositoryRules);
  return {
    project: 'atrio-catolico',
    mode: 'READ_ONLY_NO_DEPLOY_NO_BACKUP',
    publishedAt,
    publishedRuleset: rulesetName,
    publishedSha256: sha256(publishedRules),
    repositorySha256: sha256(repositoryRules),
    exactMatch: diff.exactMatch,
    publishedBadgeControls: published,
    repositoryBadgeControls: local,
    publishedOnlyLines: diff.publishedOnlyLines,
    repositoryOnlyLines: diff.repositoryOnlyLines,
    differentRegions: diff.differentRegions,
    // Pode haver regras de produção não presentes no GitHub. Não suprimimos
    // silenciosamente esse risco, mesmo quando todos os marcadores existem.
    publishedOnlyDeclarations: diff.publishedOnlyDeclarations,
    repositoryOnlyDeclarations: diff.repositoryOnlyDeclarations,
    requiresManualReview: !diff.exactMatch,
    deploymentApproved: false,
    releaseApproved: false,
    backupModified: false,
    nextStep: diff.exactMatch
      ? 'As regras coincidem; validar comportamento no app e autorização operacional.'
      : 'Comparar todas as diferenças e preservar regras exclusivas da produção antes de qualquer deploy.'
  };
}

/** Consulta apenas as regras publicadas, usando token efêmero em memória. */
export async function auditProductionBadges({
  repositoryRules,
  tokenProvider = accessTokenFromExistingFirebaseCli,
  fetcher = fetch
} = {}) {
  // Falhar antes da autenticação se o código local não contém os controles.
  if (!Object.values(badgesRulesPresence(repositoryRules)).every(Boolean))
    error('repository_missing_badge_controls');
  const token = await tokenProvider();
  const current = await fetchPublishedRules({token, fetcher});
  return summarizeBadgesDeployment({
    publishedRules: current.publishedRules,
    repositoryRules,
    publishedAt: current.publishedAt,
    rulesetName: current.rulesetName
  });
}

if (process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) error('unknown_args');
    const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
    const report = await auditProductionBadges({repositoryRules: rules});
    console.log(JSON.stringify(report, null, 2));
    // Divergência é diagnóstico pendente, jamais autorização de implantação.
    if (report.requiresManualReview) process.exitCode = 2;
  } catch (e) {
    const code = /^atrio_(?:selos_preflight|rules_diff|termux_preflight)_[a-z0-9_]+$/.test(e?.message || '')
      ? e.message : 'atrio_selos_preflight_failed_closed';
    console.error(code);
    process.exitCode = 1;
  }
}
