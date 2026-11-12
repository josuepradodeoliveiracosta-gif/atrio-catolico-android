import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderClosedQaParity} from './closed-qa-parity.mjs';
import {renderParity} from './compose-parity-rules.mjs';
const read=x=>readFileSync(new URL(x,import.meta.url),'utf8');
const base=read('../../firestore.rules');
const chat=read('../atrio-conversas-v1.rules.fragment');
const group=read('../atrio-grupos-v1.rules.fragment');

test('paridade offline conserva mural e cadastro comum mas exige políticas QA',()=>{
 const rules=renderClosedQaParity(base,chat,group);
 const source=renderParity(base,chat,group);
 assert.match(rules,/match \/posts\/\{postId\}/);
 assert.match(rules,/match \/replies\/\{replyId\}/);
 assert.match(rules,/match \/community_consents\/\{uid\}/);
 assert.match(rules,/match \/users\/\{uid\}\/private\/account/);
 assert.match(rules,/match \/chats\/\{chatId\}/);
 assert.match(rules,/match \/chat_groups\/\{groupId\}/);
 assert.match(rules,/return signedIn\(\) && exists\(settings\)/);
 assert.match(rules,/return signedIn\(\) && exists\(policy\)/);
 assert.match(rules,/proof.get\('status',''\) == 'declared_18_plus'/);
 assert.match(rules,/proof.get\('policyVersion',''\) == '2026-11-selfdecl-qa-v1'/);
 assert.doesNotMatch(rules,/qa_closed_testers|qaClosedBetaTester/);
 assert.doesNotMatch(rules,/allow read, write: if true;/);
 assert.ok(rules.length>source.length);
});
test('base ainda exige SHA revisado e fragmentos seguros',()=>{
 assert.throws(()=>renderClosedQaParity(base+'\n// mutado',chat,group),
  /qa_parity_baseline_unreviewed/);
 assert.throws(()=>renderClosedQaParity(base,chat.replace(
  'return signedIn() && exists(config)','return true'),group),
  /qa_parity_chat_gate_changed/);
 assert.throws(()=>renderClosedQaParity(base,chat,group+'\nallow get: if true;'),
  /qa_parity_fragment_unexpected_grant/);
});
test('transformação não publica nem introduz dispensa de e-mail e aceite',()=>{
 const rules=renderClosedQaParity(base,chat,group);
 assert.doesNotMatch(rules,/return !exists\(settings\)/);
 assert.doesNotMatch(rules,/return !exists\(policy\)/);
 assert.match(rules,/get\(settings\).data.get\('enabled', false\) == true/);
 assert.match(rules,/get\(policy\).data.get\('enabled', false\) == true/);
 assert.match(rules,/request.auth.token.get\('email_verified', false\) == true/);
 assert.match(rules,/allow list, update, delete: if false;/);
 assert.match(rules,/reviewExpiresAt <= request.time \+ duration.value\(366,'d'\)/);
});

test('todas as rotas existentes na base versionada persistem na cópia QA',()=>{
 const rules=renderClosedQaParity(base,chat,group);
 const routes=source=>[...source.matchAll(/^\\s*match\\s+(.+?)\\s+\\{\\s*$/gm)]
  .map(x=>x[1].trim());
 const before=routes(base),after=new Set(routes(rules));
 assert.ok(before.length>25,'base deve conter regras oficiais substanciais');
 for(const path of before)assert.ok(after.has(path),'rota herdada ausente: '+path);
 assert.ok(after.has('/chats/{chatId}'));
 assert.ok(after.has('/chat_groups/{groupId}'));
 assert.ok(after.has('/user_reports/{reportId}'));
});
