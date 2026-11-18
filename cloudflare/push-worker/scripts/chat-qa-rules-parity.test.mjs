import test from 'node:test';
import assert from 'node:assert/strict';
import {QA_AGE18_GATE} from '../../../firebase/qa-general/age18-gate.mjs';
import {renderQaWorker,renderQaWrangler} from './chat-qa-build.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const production=fs.readFileSync(path.join(root,'src/index.js'),'utf8');
test('main: gate Firestore QA atual aceita legado, nao autodeclaracao',()=>{
  assert.match(QA_AGE18_GATE,/proof\.get\('status',''\) == 'eligible'/);
  assert.match(QA_AGE18_GATE,/proof\.get\('policyVersion',''\) == '2026-11-18plus-qa-v1'/);
  assert.doesNotMatch(QA_AGE18_GATE,/declared_18_plus/);
});
test('Worker QA nao envia com modo etario desligado por padrao',()=>{
  const qa=renderQaWorker(production,'atrio-catolico-qa-geral');
  assert.match(qa,/qa_age_policy_disabled/);
  assert.match(qa,/ATRIO_QA_AGE_POLICY/);
  const config=renderQaWrangler('atrio-catolico-qa-geral','11111111-2222-4333-8444-555555555555');
  assert.match(config,/PUSH_ENABLED = "false"/);
  assert.match(config,/ATRIO_QA_AGE_POLICY = "disabled"/);
});
