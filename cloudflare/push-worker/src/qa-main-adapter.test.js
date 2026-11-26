import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adaptCurrentMainToQaBase} from '../scripts/chat-qa-main-adapter.mjs';

test('QA adapter accepts exactly the audited OAuth export without weakening source pin',()=>{
  const source=readFileSync(new URL('./index.js',import.meta.url),'utf8');
  const wrapper="export function getQaFirestoreAccessToken(env) {\n  return oauth(env, QA_PROJECT);\n}\n\n";
  assert.equal(source.split(wrapper).length,2);
  const original=source.replace(wrapper,'');
  const adapted=adaptCurrentMainToQaBase(source);
  assert.equal(adapted,adaptCurrentMainToQaBase(original));
  assert.ok(!adapted.includes('getQaFirestoreAccessToken'));
  assert.throws(()=>adaptCurrentMainToQaBase(source+'\n// unknown change'),/chat_qa_main_blob_changed/);
  assert.throws(()=>adaptCurrentMainToQaBase(source.replace('return oauth(env, QA_PROJECT);','return oauth(env);')),/chat_qa_main_blob_changed/);
});
