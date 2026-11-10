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
      project !== 'atrio-catolico-qa-geral')
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
  // O Worker de homologação não deve continuar a enviar FCM para contas
  // cuja prova etária individual foi revogada ou expirou.
  code = exactlyOnce(code,
    'const recent = time => time > Date.now() - MAX_AGE_MS && time < Date.now() + 60_000;',
    'const recent = time => time > Date.now() - MAX_AGE_MS && time < Date.now() + 60_000;\n' +
      "// QA somente: conferência independente de maioridade ANTES do FCM.\n// Credencial de serviço contorna as Security Rules, por isso revalidamos\n// tanto remetente quanto cada destinatário sem confiar no cliente.\nconst qaChatAge18ValidForPush = record => {\n  const fields = record?.fields;\n  if (!fields || typeof fields !== 'object' ||\n      Object.keys(fields).sort().join('|') !==\n        'minimumAge|policyVersion|reviewExpiresAt|status') return false;\n  const expiry = fields.reviewExpiresAt?.timestampValue;\n  return fields.status?.stringValue === 'eligible'\n    && fields.minimumAge?.integerValue === '18'\n    && fields.policyVersion?.stringValue === '2026-11-18plus-qa-v1'\n    && typeof expiry === 'string' && Date.parse(expiry) > Date.now();\n};\n// Segundo bloqueio QA contra revogacao ocorrida entre selecao e despacho.\n// Sem transacao atomica entre Firestore e FCM; nao garante janela zero.\nexport async function qaChatPushPreSendAllowed(token,sender,recipient,groupId=null) {\n  if (!uidPart(sender) || !uidPart(recipient) || sender === recipient ||\n      (groupId !== null && !uidPart(groupId))) return false;\n  try {\n    const [a,b,blockA,blockB] = await Promise.all([\n      firestoreGet(token,'users/'+enc(sender)+'/chatAgeEligibility/current'),\n      firestoreGet(token,'users/'+enc(recipient)+'/chatAgeEligibility/current'),\n      firestoreGet(token,'users/'+enc(sender)+'/blockedMembers/'+enc(recipient)),\n      firestoreGet(token,'users/'+enc(recipient)+'/blockedMembers/'+enc(sender))\n    ]);\n    if (!qaChatAge18ValidForPush(a) || !qaChatAge18ValidForPush(b) ||\n        blockA || blockB) return false;\n    // Mensagem de grupo: a prova 18+ sozinha nao autoriza permanecer membro.\n    // Saida, encerramento ou revogacao de elegibilidade impedem o push.\n    if (groupId === null) return true;\n    if (!uidPart(groupId)) return false;\n    const [group,senderAccess,recipientAccess,mute] = await Promise.all([\n      firestoreGet(token,'chat_groups/'+enc(groupId)),\n      firestoreGet(token,'users/'+enc(sender)+'/chatGroupAccess/eligibility'),\n      firestoreGet(token,'users/'+enc(recipient)+'/chatGroupAccess/eligibility'),\n      firestoreGet(token,'users/'+enc(recipient)+'/chatGroupBox/'+enc(groupId))\n    ]);\n    if (stringField(group,'status') !== 'active' ||\n        !groupReviewValid(senderAccess) || !groupReviewValid(recipientAccess) ||\n        boolField(mute,'muted'))\n      return false;\n    const values = group?.fields?.memberUids?.arrayValue?.values;\n    if (!Array.isArray(values) || values.length<2 || values.length>8) return false;\n    const members = values.map(v=>v?.stringValue);\n    return members.every(uidPart) && new Set(members).size===members.length &&\n      members.includes(sender) && members.includes(recipient);\n  } catch { return false; }\n}");
  code = exactlyOnce(code,
    '    const peer = actor === requester ? recipient : requester;\n    const [blockA,blockB,mute,setting]',
    `    const peer = actor === requester ? recipient : requester;
    const [senderAge,receiverAge] = await Promise.all([
      firestoreGet(token,'users/'+enc(actor)+'/chatAgeEligibility/current'),
      firestoreGet(token,'users/'+enc(peer)+'/chatAgeEligibility/current')
    ]);
    if (!qaChatAge18ValidForPush(senderAge) ||
        !qaChatAge18ValidForPush(receiverAge)) return null;
    const [blockA,blockB,mute,setting]`);
  code = exactlyOnce(code,
    "    const actorAccess=await firestoreGet(token,\n      'users/'+enc(actor)+'/chatGroupAccess/eligibility');\n    if(!groupReviewValid(actorAccess)) return null;",
    `    const [actorAccess,actorAge] = await Promise.all([
      firestoreGet(token,'users/'+enc(actor)+'/chatGroupAccess/eligibility'),
      firestoreGet(token,'users/'+enc(actor)+'/chatAgeEligibility/current')
    ]);
    if(!groupReviewValid(actorAccess) ||
       !qaChatAge18ValidForPush(actorAge)) return null;`);
  code = exactlyOnce(code,
    '      const [access,blockedA,blockedB,muted]=await Promise.all([',
    '      const [access,blockedA,blockedB,muted,peerAge]=await Promise.all([');
  code = exactlyOnce(code,
    "        firestoreGet(token,'users/'+enc(peer)+'/chatGroupBox/'+enc(event.groupId))\n      ]);",
    `        firestoreGet(token,'users/'+enc(peer)+'/chatGroupBox/'+enc(event.groupId)),
        firestoreGet(token,'users/'+enc(peer)+'/chatAgeEligibility/current')
      ]);`);
  code = exactlyOnce(code,
    '      if(!groupReviewValid(access) ||\n         blockedA || blockedB || boolField(muted,\'muted\')) continue;',
    `      if(!groupReviewValid(access) || !qaChatAge18ValidForPush(peerAge) ||
         blockedA || blockedB || boolField(muted,'muted')) continue;`);
  // Revalidar elegibilidade apos buscar dispositivos, mas ANTES de reservar
  // deduplicacao D1 ou chamar FCM. Modificacao exclusiva do candidato QA.
  code = exactlyOnce(code,
    '        if(!list.length) continue;\n        // At most once:',
    `        if(!list.length) continue;
        if (event.kind==='chat_message' &&
            !(await qaChatPushPreSendAllowed(token,uid,recipient))) continue;
        if (event.kind==='group_message' &&
            !(await qaChatPushPreSendAllowed(token,uid,recipient,event.groupId))) continue;
        // At most once:`);
  // A web API key pode, por engano, pertencer à produção. O lookup remoto
  // valida o token, mas a origem assinada também deve ser o Firebase QA.
  // A checagem local apenas rejeita; não autentica JWT por si só.
  code = exactlyOnce(code, '  if (!match) return null;\n  const validated =',
    `  if (!match) return null;
  try {
    const parts = match[1].split('.');
    if (parts.length !== 3 || parts[1].length > 4000) return null;
    const b64 = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims) ||
        claims.aud !== PROJECT ||
        claims.iss !== 'https://securetoken.google.com/' + PROJECT)
      return null;
  } catch { return null; }
  const validated =`);
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
    "    if (env.ATRIO_GENERAL_QA_MODE !== 'true' ||",
    '        env.ATRIO_GENERAL_QA_PROJECT !== PROJECT ||',
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
    '    }',
    '    // D1 não fornece UUID no binding em execução: conferir marcador persistente.',
    '    if (!env.PUSH_DB || typeof env.PUSH_DB.prepare !== "function")',
    "      return response(503,'qa_d1_identity_denied');",
    '    try {',
    '      const identity = await env.PUSH_DB.prepare(',
    '        "SELECT project_id FROM atrio_qa_identity WHERE name = ? LIMIT 1"',
    '      ).bind("atrio-qa-geral").first();',
    '      if (identity?.project_id !== PROJECT)',
    "        return response(503,'qa_d1_identity_denied');",
    "    } catch { return response(503,'qa_d1_identity_denied'); }"
  ].join('\n');
  code = exactlyOnce(code, fetchStart, gate);
  code = exactlyOnce(code,
    "!['reply','badge_request','badge_result','report','chat_message','group_message'].includes(data.type)",
    "!['chat_message','group_message'].includes(data.type)");
  if (code.includes("const PROJECT = 'atrio-catolico';") ||
      code.includes("atrio-push.atrio-catolico.workers.dev") ||
      code.includes("qa-manual.js") ||
      code.includes("email-verification-policy.mjs") ||
      code.includes("qa-real-auth.js"))
    fail('production_reference_remained');
  return '// GERADO AUTOMATICAMENTE. NÃO PUBLICAR SEM AUDITORIA E AUTORIZAÇÃO.\n' + code;
}
export function renderQaWrangler(project, d1) {
  validateQaIdentity(project, d1);
  return [
    '# GERADO. Somente homologação aprovada; NÃO executar deploy automaticamente.',
    'name = "atrio-qa-geral"',
    'main = "src/index.general-qa.generated.js"',
    'compatibility_date = "2026-10-26"',
    // Produzir candidato inacessível por padrão; ativação externa exige
    // revisão e aprovação manual separada, mesmo que o Worker QA já exista.
    'workers_dev = false',
    'preview_urls = false',
    '',
    '[vars]',
    'ATRIO_GENERAL_QA_MODE = "true"',
    'ATRIO_GENERAL_QA_PROJECT = "' + project + '"',
    'PUSH_ENABLED = "false"',
    'BROADCAST_ENABLED = "false"',
    'GUARDIAO_ENABLED = "false"',
    'GUARDIAO_AI_ENABLED = "false"',
    'GUARDIAO_AUTOHIDE_ENABLED = "false"',
    'QA_MANUAL_ENABLED = "false"',
    '',
    '[[d1_databases]]',
    'binding = "PUSH_DB"',
    'database_name = "atrio-qa-geral-db"',
    'database_id = "' + d1 + '"',
    '',
    '# Secrets de QA somente no Worker QA:',
    '# FIREBASE_WEB_API_KEY e FIREBASE_SERVICE_ACCOUNT_JSON.',
    '# Sem secrets e PUSH_ENABLED=false, nenhuma entrega FCM é habilitada.',
    ''
  ].join('\n');
}
/**
 * A tabela abaixo fica SOMENTE no D1 de homologação. Se faltar ou apontar
 * para outro projeto, o Worker QA recusa até GET /health e POST /event.
 * A geração não executa SQL nem cria bancos de dados.
 */
export function renderQaSchema(project, d1) {
  validateQaIdentity(project, d1);
  return [
    '-- GERADO: aplicar somente no D1 QA aprovado, nunca em produção.',
    'CREATE TABLE IF NOT EXISTS atrio_qa_identity (',
    '  name TEXT PRIMARY KEY NOT NULL,',
    '  project_id TEXT NOT NULL',
    ');',
    'INSERT OR IGNORE INTO atrio_qa_identity (name, project_id)',
    "  VALUES ('atrio-qa-geral', '" + project + "');",
    'CREATE TABLE IF NOT EXISTS delivered (',
    '  event_key TEXT PRIMARY KEY NOT NULL,',
    '  created_at INTEGER NOT NULL',
    ');',
    'CREATE INDEX IF NOT EXISTS delivered_created_at ON delivered(created_at);',
    'CREATE TABLE IF NOT EXISTS push_delivery_stats (',
    '  hour_bucket INTEGER NOT NULL,',
    '  kind TEXT NOT NULL,',
    '  outcome TEXT NOT NULL,',
    '  fcm_http_status INTEGER NOT NULL DEFAULT 0,',
    '  events INTEGER NOT NULL DEFAULT 1,',
    '  attempted INTEGER NOT NULL DEFAULT 0,',
    '  accepted INTEGER NOT NULL DEFAULT 0,',
    '  PRIMARY KEY (hour_bucket, kind, outcome, fcm_http_status)',
    ');',
    'CREATE INDEX IF NOT EXISTS push_delivery_stats_hour ON push_delivery_stats(hour_bucket);',
    ''
  ].join('\n');
}
export function generate(project, d1, dir = ROOT) {
  validateQaIdentity(project,d1);
  const original = fs.readFileSync(path.join(dir,'src/index.js'),'utf8');
  const src = renderQaWorker(original,project);
  const toml = renderQaWrangler(project,d1);
  const schema = renderQaSchema(project,d1);
  const output = path.join(dir,'src/index.general-qa.generated.js');
  const config = path.join(dir,'wrangler.general-qa.generated.toml');
  const sql = path.join(dir,'schema.general-qa.generated.sql');
  // Gerar somente arquivos ignorados pelo Git; nunca tocar src/index.js.
  fs.writeFileSync(output,src,{flag:'w',mode:0o600});
  fs.writeFileSync(config,toml,{flag:'w',mode:0o600});
  fs.writeFileSync(sql,schema,{flag:'w',mode:0o600});
  return {output,config,sql};
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const project=process.env.ATRIO_GENERAL_QA_PROJECT;
    const d1=process.env.ATRIO_GENERAL_QA_D1_ID;
    generate(project,d1);
    console.log('Chat QA: fontes/configuração segregadas geradas localmente; nenhum deploy.');
  } catch (error) {
    console.error('Chat QA REPROVADO: ' + String(error.message).replace(/[^a-z0-9_]/gi,''));
    process.exitCode=1;
  }
}
