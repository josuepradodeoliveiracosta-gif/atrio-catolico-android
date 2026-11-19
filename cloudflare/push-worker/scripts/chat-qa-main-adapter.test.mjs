import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {adaptCurrentMainToQaBase} from './chat-qa-main-adapter.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'src/index.js'),'utf8');

test('main permanece fonte do QA e codigo oficial nao e modificado',()=>{
  const adapted=adaptCurrentMainToQaBase(source);
  assert.ok(source.includes("const PROJECT = 'atrio-catolico';"));
  assert.ok(adapted.includes("const PROJECT = 'atrio-catolico';"));
  assert.ok(adapted.includes("kind:'chat_message'"));
  assert.ok(adapted.includes("kind:'group_message'"));
  assert.equal(adapted.includes('qa-nav-alice'),false);
  assert.equal(adapted.includes('qa-nav-bob'),false);
  assert.equal(adapted.includes('QA_PROJECT'),false);
  assert.ok(source.includes("const QA_PROJECT = 'atrio-catolico-qa-general';"));
});

test('anchors da main alteradas negam geracao em vez de fallback silencioso',()=>{
  assert.throws(()=>adaptCurrentMainToQaBase(source.replace(
    "const QA_PROJECT = 'atrio-catolico-qa-general';",
    "const QA_PROJECT = 'projeto-inesperado';")) ,/chat_qa_/);
  assert.throws(()=>adaptCurrentMainToQaBase(source.replace(
    'async function handlePushEvent(request, env, configured, project)',
    'async function handlePushEvent(request, env, x, project)')),/chat_qa_/);
});

test('o adaptador conserva os controles de origem em sua fonte versionada',()=>{
  assert.ok(source.includes('function serviceAccount(env, project)'));
  assert.ok(source.includes('export async function verifyIdentity'));
  assert.ok(source.includes('export async function resolveEvent'));
  assert.ok(source.includes('async function send('));
});
