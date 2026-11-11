import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderClosedBetaSelfDeclarationRules}
 from './closed-beta-rules.mjs';
import {renderSelfDeclarationRules} from './self-declaration-candidate.mjs';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const chat=read('../atrio-conversas-v1.rules.fragment');
const group=read('../atrio-grupos-v1.rules.fragment');
test('variante opcional somente offline inclui lista fechada sem ampliar grants',()=>{
 const beta=renderClosedBetaSelfDeclarationRules(chat,group);
 const standard=renderSelfDeclarationRules(chat,group);
 assert.doesNotMatch(standard,/qaClosedBetaTester/);
 assert.match(beta,/function qaClosedBetaTester\(uid\)/);
 assert.match(beta,/return qaClosedBetaTester\(uid\)/);
 assert.match(beta,/match \/qa_closed_testers\/\{uid\}/);
 assert.match(beta,/allow get, list, create, update, delete: if false;/);
 assert.match(beta,/qaChatAge18Eligible\(request.auth.uid\)/);
 assert.match(beta,/qaChatAge18Eligible\(inviteeUid\)/);
 assert.match(beta,/qaChatAge18Eligible\(request.resource.data.recipientUid\)/);
 assert.doesNotMatch(beta,/allow read, write: if true;/);
 assert.ok(beta.endsWith('  }\n}\n'));
});
test('sem ancora de eligibilidade o candidato falha fechado',()=>{
 assert.throws(()=>renderClosedBetaSelfDeclarationRules(
   chat.replace('function chatEnabled() {','function chatEnabledChanged() {'),
   group),/qa_source_fragment_incompatible|qa_chat_gate_changed/);
 assert.throws(()=>renderClosedBetaSelfDeclarationRules(
   chat,group.replace('function atrioGroupsEnabled() {',
      'function groupsEnabledChanged() {')),/qa_source_fragment_incompatible|qa_age18_|qa_/);
});
