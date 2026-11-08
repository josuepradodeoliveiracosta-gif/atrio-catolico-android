import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderQaWorker,renderQaWrangler,validateQaIdentity} from './chat-qa-build.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const original=fs.readFileSync(path.join(root,'src/index.js'),'utf8');
const qaProject='qa-atrio-conversas-2026';
const qaD1='11111111-2222-4333-8444-555555555555';
const generated=renderQaWorker(original,qaProject);

test('bundle QA contém o projeto segregado sem literal do Firebase oficial',()=>{
  assert.match(generated,/const PROJECT = 'qa-atrio-conversas-2026'/);
  assert.doesNotMatch(generated,/atrio-catolico/);
  assert.match(generated,/ATRIO_CHAT_QA_MODE/);
  assert.match(generated,/ATRIO_CHAT_QA_PROJECT/);
});
test('QA desativa bots, política externa oficial e fila de usuários',()=>{
  assert.doesNotMatch(generated,/from '.\/qa-manual\.js'/);
  assert.doesNotMatch(generated,/email-verification-policy\.mjs/);
  assert.match(generated,/verified === true/);
  assert.match(generated,/for \(const item of batch.messages\) item.ack\(\)/);
});
test('QA só aceita rotas/eventos de chat, grupos e health',()=>{
  assert.match(generated,/qa_route_denied/);
  assert.match(generated,/\['chat_message','group_message'\].includes\(data.type\)/);
  assert.match(generated,/qa_configuration_denied/);
  assert.match(generated,/qa_service_identity_denied/);
});
test('QA exige e-mail do domínio da service account do projeto aprovado',()=>{
  assert.match(generated,/client_email\?\.endsWith\('@' \+ PROJECT \+ '\.iam\.gserviceaccount\.com'\)/);
});
test('produção permanece imutável: fonte de entrada ainda usa projeto oficial',()=>{
  assert.match(original,/const PROJECT = 'atrio-catolico';/);
  assert.match(original,/from '.\/qa-manual.js';/);
});
test('identidade QA rejeita projeto oficial, suspeito ou vazia',()=>{
  for (const p of ['atrio-catolico','', 'prod-atrio','qa/x','abc_qa']) {
    assert.throws(()=>validateQaIdentity(p,qaD1),/chat_qa_/);
  }
});
test('identidade QA exige D1 diferente do oficial',()=>{
  for (const id of ['', 'invalid','6b04fad3-619a-4cc5-a4b3-d31c3a18e911']) {
    assert.throws(()=>validateQaIdentity(qaProject,id),/chat_qa_/);
  }
});
test('falha fechada diante de mudanças nas âncoras do código original',()=>{
  assert.throws(()=>renderQaWorker(original.replace("const PROJECT = 'atrio-catolico';",
    "const PROJECT = 'outro';"),qaProject),/chat_qa_/);
  assert.throws(()=>renderQaWorker(original.replace('  async queue(batch,env) {',
    '  async queue(messages,env) {'),qaProject),/chat_qa_/);
});
test('configuração de QA não reutiliza nome, projeto, D1 ou switches de produção',()=>{
  const config=renderQaWrangler(qaProject,qaD1);
  assert.match(config,/name = "atrio-chat-qa"/);
  assert.match(config,/PUSH_ENABLED = "false"/);
  assert.match(config,/QA_MANUAL_ENABLED = "false"/);
  assert.match(config,/database_id = "11111111-2222-4333-8444-555555555555"/);
  assert.doesNotMatch(config,/atrio-catolico|6b04fad3-619a-4cc5-a4b3-d31c3a18e911/);
});
test('worker QA bloqueia por padrão, antes de acessar banco ou Firebase',async()=>{
  const workerModule=await import('data:text/javascript;charset=utf-8,' +
    encodeURIComponent(generated));
  const worker=workerModule.default;
  for(const [url,method,env,code] of [
    ['https://qa.example/event','POST',{},503],
    ['https://qa.example/event','POST',
      {ATRIO_CHAT_QA_MODE:'true',ATRIO_CHAT_QA_PROJECT:'atrio-catolico'},503],
    ['https://qa.example/moderation/event','POST',
      {ATRIO_CHAT_QA_MODE:'true',ATRIO_CHAT_QA_PROJECT:qaProject},404],
    ['https://qa.example/event','POST',
      {ATRIO_CHAT_QA_MODE:'true',ATRIO_CHAT_QA_PROJECT:qaProject,
        FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'atrio-catolico'})},503],
    ['https://qa.example/event','POST',
      {ATRIO_CHAT_QA_MODE:'true',ATRIO_CHAT_QA_PROJECT:qaProject,PUSH_ENABLED:'false'},503]
  ]) {
    const result=await worker.fetch(new Request(url,{method,body:'{}'}),env);
    assert.equal(result.status,code);
  }
});
