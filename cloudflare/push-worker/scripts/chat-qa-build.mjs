#!/usr/bin/env node
/** Gera somente um bundle QA local, sem credenciais, rede ou deploy. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const PROD_PROJECT = 'atrio-catolico';
const PROD_D1 = '6b04fad3-619a-4cc5-a4b3-d31c3a18e911';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(reason) { throw Error('chat_qa_' + reason); }
function exactlyOnce(input, anchor, replacement) {
  if (input.split(anchor).length !== 2) fail('source_anchor_changed');
  return input.replace(anchor, replacement);
}
export function validateQaIdentity(project, d1) {
  if (typeof project !== 'string' ||
      !/^[a-z][a-z0-9-]{4,40}$/.test(project) ||
      !/(^qa-|[-]qa(?:-|$))/.test(project) || project === PROD_PROJECT)
    fail('separate_firebase_project_required');
  if (typeof d1 !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d1) ||
      d1.toLowerCase() === PROD_D1)
    fail('separate_d1_required');
}
export function renderQaWorker(original, project) {
  validateQaIdentity(project, '11111111-2222-4333-8444-555555555555');
  if (typeof original !== 'string' || original.split(PROD_PROJECT).length !== 2)
    fail('unexpected_production_project_literals');
  let code = original;
  code = exactlyOnce(code, "import {executeQaCommand} from './qa-manual.js';",
    "const executeQaCommand = async () => 'disabled'; // QA never runs legacy bots");
  code = exactlyOnce(code,
    "import {emailAllowsCommunity} from '../../email-verification-policy.mjs';",
    "const emailAllowsCommunity = async (_token, verified) => verified === true;");
  code = exactlyOnce(code, "const PROJECT = 'atrio-catolico';",
    "const PROJECT = '" + project + "';");
  code = exactlyOnce(code,
    'if (service.project_id !== PROJECT || !service.client_email || !service.private_key)',
    "if (service.project_id !== PROJECT ||\n" +
    "      !service.client_email?.endsWith('@' + PROJECT + '.iam.gserviceaccount.com') ||\n" +
    "      !service.private_key)");
  const queueStart = '  async queue(batch,env) {';
  const fetchStart = '  async fetch(request, env) {';
  const blocks = code.split(queueStart);
  if (blocks.length !== 2 || blocks[1].split(fetchStart).length !== 2)
    fail('queue_fetch_layout_changed');
  // O QA não consome comandos legados de bots nem faz escrita administrativa.
  code = blocks[0] +
    "  async queue(batch) {\n" +
    "    for (const item of batch.messages) item.ack();\n" +
    "  },\n" + fetchStart + blocks[1].split(fetchStart)[1];
  const gate = [
    '  async fetch(request, env) {',
    "    if (env.ATRIO_CHAT_QA_MODE !== 'true' ||",
    '        env.ATRIO_CHAT_QA_PROJECT !== PROJECT ||',
    "        env.QA_MANUAL_ENABLED === 'true' ||",
    "        env.GUARDIAO_ENABLED === 'true' ||",
    "        env.GUARDIAO_AI_ENABLED === 'true' ||",
    "        env.BROADCAST_ENABLED === 'true')",
    "      return response(503,'qa_configuration_denied');",
    '    const qaPath = new URL(request.url).pathname;',
    "    if (!((request.method==='GET' && qaPath==='/health') ||",
    "          (request.method==='POST' && qaPath==='/event')))",
    "      return response(404,'qa_route_denied');",
    '    if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {',
    '      try {',
    '        const meta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);',
    '        if (meta.project_id !== PROJECT ||',
    "            !meta.client_email?.endsWith('@' + PROJECT + '.iam.gserviceaccount.com'))",
    "          return response(503,'qa_service_identity_denied');",
    '      } catch { return response(503,\'qa_service_identity_denied\'); }',
    '    }'
  ].join('\n');
  code = exactlyOnce(code, fetchStart, gate);
  code = exactlyOnce(code,
    "!['reply','badge_request','badge_result','report','chat_message','group_message'].includes(data.type)",
    "!['chat_message','group_message'].includes(data.type)");
  if (code.includes(PROD_PROJECT) || code.includes("qa-manual.js") ||
      code.includes("email-verification-policy.mjs") ||
      code.includes("qa-real-auth.js"))
    fail('production_reference_remained');
  return '// GERADO AUTOMATICAMENTE. NÃO PUBLICAR SEM AUDITORIA E AUTORIZAÇÃO.\n' + code;
}
export function renderQaWrangler(project, d1) {
  validateQaIdentity(project, d1);
  return [
    '# GERADO. Somente homologação aprovada; NÃO executar deploy automaticamente.',
    'name = "atrio-chat-qa"',
    'main = "src/index.chat-qa.generated.js"',
    'compatibility_date = "2026-10-26"',
    'workers_dev = true',
    '',
    '[vars]',
    'ATRIO_CHAT_QA_MODE = "true"',
    'ATRIO_CHAT_QA_PROJECT = "' + project + '"',
    'PUSH_ENABLED = "false"',
    'BROADCAST_ENABLED = "false"',
    'GUARDIAO_ENABLED = "false"',
    'GUARDIAO_AI_ENABLED = "false"',
    'GUARDIAO_AUTOHIDE_ENABLED = "false"',
    'QA_MANUAL_ENABLED = "false"',
    '',
    '[[d1_databases]]',
    'binding = "PUSH_DB"',
    'database_name = "atrio-chat-qa-delivery"',
    'database_id = "' + d1 + '"',
    '',
    '# Secrets de QA somente no Worker QA:',
    '# FIREBASE_WEB_API_KEY e FIREBASE_SERVICE_ACCOUNT_JSON.',
    '# Sem secrets e PUSH_ENABLED=false, nenhuma entrega FCM é habilitada.',
    ''
  ].join('\n');
}
export function generate(project, d1, dir = ROOT) {
  validateQaIdentity(project,d1);
  const original = fs.readFileSync(path.join(dir,'src/index.js'),'utf8');
  const src = renderQaWorker(original,project);
  const toml = renderQaWrangler(project,d1);
  const output = path.join(dir,'src/index.chat-qa.generated.js');
  const config = path.join(dir,'wrangler.chat-qa.generated.toml');
  // Gerar somente arquivos ignorados pelo Git; nunca tocar src/index.js.
  fs.writeFileSync(output,src,{flag:'w',mode:0o600});
  fs.writeFileSync(config,toml,{flag:'w',mode:0o600});
  return {output,config};
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const project=process.env.ATRIO_CHAT_QA_PROJECT;
    const d1=process.env.ATRIO_CHAT_QA_D1_ID;
    generate(project,d1);
    console.log('Chat QA: fontes/configuração segregadas geradas localmente; nenhum deploy.');
  } catch (error) {
    console.error('Chat QA REPROVADO: ' + String(error.message).replace(/[^a-z0-9_]/gi,''));
    process.exitCode=1;
  }
}
