#!/usr/bin/env node
/**
 * Publicação guardada das regras de Selos V2 no Firebase 'atrio-catolico'.
 *
 * Sem argumentos: SOMENTE leitura, nunca publica.
 * Para publicar, é obrigatório fornecer AMBOS:
 *   --apply --confirm=atrio-catolico:selos-v2
 *
 * PROTEÇÕES:
 * 1. Firebase produção deve ter EXATAMENTE a versão histórica auditada
 *    em 06/11/2026, anterior aos selos V2 (SHA-256 fixo).
 * 2. O arquivo local deve ser EXATAMENTE o novo código revisado (SHA-256 fixo).
 * 3. Confirma estado remoto uma segunda vez imediatamente antes do deploy.
 * 4. Despacha apenas firestore:rules; nunca executa tarefas de dados, backups,
 *    usuários, Auth, Workers ou release de APK.
 * 5. Após publicar, consulta novamente as regras, sem declarar sucesso
 *    caso a confirmação falhe.
 *
 * Não edite os fingerprints para burlar recusas: uma divergência exige
 * reauditoria do conteúdo e aprovação explícita do proprietário.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {fetchPublishedRules} from './termux-firestore-rules-diff-readonly.mjs';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';

export const SELLOS_V2_RULES = Object.freeze({
  project: 'atrio-catolico',
  previousSha256: 'ddf58ff4a5db0b559b1162418006c69763381a37612933a4bf1c5b96e7b0d8f1',
  targetSha256: 'aa04c106e69287b7e7f513addf3dd4e9fc3ad246b69a7d20b2f38c5068c9899e'
});
const root = fileURLToPath(new URL('../', import.meta.url));
const fileUrl = new URL('../firestore.rules', import.meta.url);
const configUrl = new URL('../firebase.json', import.meta.url);
const fingerprint = value => createHash('sha256').update(value, 'utf8').digest('hex');
const fail = code => {throw Error('atrio_selos_guard_' + code);};

export async function verifyBadgeDeployment({
  apply = false,
  rulesText,
  tokenProvider = accessTokenFromExistingFirebaseCli,
  fetcher = fetch,
  execute = execFileSync,
  readFileFn = readFile,
  fingerprints = SELLOS_V2_RULES
} = {}) {
  if (typeof rulesText !== 'string' ||
      fingerprint(rulesText) !== fingerprints.targetSha256)
    fail('repository_rules_changed');
  // Fail closed se alguém alterar as referências do deploy ou da configuração.
  let config;
  try {
    config = JSON.parse(await readFileFn(configUrl, 'utf8'));
  } catch {fail('firebase_config_unreadable');}
  if (config?.firestore?.rules !== 'firestore.rules')
    fail('firebase_config_changed');

  const token = await tokenProvider();
  const query = () => fetchPublishedRules({token, fetcher});
  const current = await query();
  const before = fingerprint(current.publishedRules);

  if (before === fingerprints.targetSha256) {
    return {
      project: fingerprints.project, mode: 'READ_ONLY_ALREADY_PUBLISHED',
      previouslyPublishedSha256: before,
      expectedSha256: fingerprints.targetSha256,
      alreadyPublished: true, changedByThisCommand: false,
      deploymentApproved: false, backupModified: false, releaseApproved: false
    };
  }

  if (before !== fingerprints.previousSha256)
    fail('production_rules_changed_since_audit');

  const result = {
    project: fingerprints.project,
    mode: apply ? 'GUARDED_FIRESTORE_RULES_ONLY' : 'READ_ONLY_PREVIEW',
    previouslyPublishedSha256: before,
    expectedSha256: fingerprints.targetSha256,
    canDeployWhenAuthorized: true,
    changedByThisCommand: false,
    backupModified: false,
    releaseApproved: false
  };
  if (!apply) return result;

  // Revalida arquivos e release após a autorização de publicar.
  if (fingerprint(await readFileFn(fileUrl, 'utf8')) !== fingerprints.targetSha256)
    fail('repository_rules_modified_during_run');
  const immediate = await query();
  if (fingerprint(immediate.publishedRules) !== fingerprints.previousSha256 ||
      immediate.rulesetName !== current.rulesetName)
    fail('production_rules_changed_during_run');

  // Somente Firestore Rules. Projeto explícito, sem qualquer fallback.
  try {
    execute('firebase', [
      'deploy', '--only', 'firestore:rules',
      '--project', fingerprints.project, '--non-interactive'
    ], {
      cwd: root, stdio: 'inherit', timeout: 180000,
      env: {...process.env}
    });
  } catch {
    fail('firebase_cli_failed_verify_production_manually');
  }

  // Confirmação independente da saída da Firebase CLI.
  const published = await query();
  if (fingerprint(published.publishedRules) !== fingerprints.targetSha256)
    fail('published_sha_not_confirmed');
  return {
    ...result, changedByThisCommand: true,
    publishedSha256: fingerprint(published.publishedRules),
    verifiedRuleset: published.rulesetName,
    verifiedPublishedAt: published.publishedAt,
    backupModified: false, releaseApproved: false
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const apply = args.length === 2 &&
      args[0] === '--apply' && args[1] === '--confirm=atrio-catolico:selos-v2';
    if (args.length > 0 && !apply) fail('explicit_confirmation_required');
    const rulesText = await readFile(fileUrl, 'utf8');
    const result = await verifyBadgeDeployment({apply, rulesText});
    console.log(JSON.stringify(result, null, 2));
    if (result.alreadyPublished) {
      console.log('Regras já publicadas; nenhuma operação executada.');
    } else if (!apply) {
      console.log('Somente leitura: nenhuma regra foi publicada.');
    }
  } catch (error) {
    const code = /^atrio_(?:selos_guard|rules_diff|termux_preflight)_[a-z0-9_]+$/.test(error?.message || '')
      ? error.message : 'atrio_selos_guard_failed_closed';
    console.error(code);
    process.exitCode = 1;
  }
}
