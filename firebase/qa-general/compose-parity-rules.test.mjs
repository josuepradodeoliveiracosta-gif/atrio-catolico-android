import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderParity} from './compose-parity-rules.mjs';
import {render as renderStandalone} from './compose-rules.mjs';

const base=readFileSync('firestore.rules','utf8');
const chat=readFileSync('firebase/atrio-conversas-v1.rules.fragment','utf8');
const group=readFileSync('firebase/atrio-grupos-v1.rules.fragment','utf8');
const tail=[
  '    match /{document=**} {',
  '      allow read, write: if false;',
  '    }',
  '  }',
  '}',
  ''
].join('\n');

test('preserva byte a byte a base revisada fora da adição QA',()=>{
  const candidate=renderParity(base,chat,group);
  const prefix=base.slice(0,-tail.length);
  assert.equal(candidate.slice(0,prefix.length),prefix);
  assert.equal(candidate.slice(-tail.length),tail);
  assert.equal(candidate.split('BEGIN QA PARITY ADDITIVE').length,2);
  assert.equal(candidate.split('END QA PARITY ADDITIVE').length,2);
  assert.equal(candidate.includes("request.auth.token.get('email_verified',false) == true"),true);
  assert.equal(candidate.includes('match /chats/{chatId}'),true);
  assert.equal(candidate.includes('match /chat_groups/{groupId}'),true);
  assert.equal(candidate.includes('allow read, write: if true;'),false);
});

test('qualquer modificação na base fixada exige revisão antes de gerar',()=>{
  assert.throws(()=>renderParity(base+'\n// alterado',chat,group),
    /qa_parity_baseline_unreviewed/);
  assert.throws(()=>renderParity(base.replace('if false;','if true;'),chat,group),
    /qa_parity_baseline_unreviewed/);
});

test('interrompe se o portão do chat ou a proteção de grupos mudar',()=>{
  assert.throws(()=>renderParity(base,chat.replace(
    'return signedIn() && exists(config)', 'return true'),group),
    /qa_parity_chat_gate_changed/);
  assert.throws(()=>renderParity(base,chat,group.replace('minorPolicyApproved','invalid')),
    /qa_parity_required_gate_missing/);
});

test('rejeita permissões abertas e declarações perigosas nos fragmentos',()=>{
  assert.throws(()=>renderParity(base,chat+'\nallow get: if true;',group),
    /qa_parity_fragment_unexpected_grant/);
  assert.throws(()=>renderParity(base,chat,group+'\nservice cloud.firestore {}'),
    /qa_parity_fragment_unexpected_grant/);
  assert.throws(()=>renderParity(base,chat+'\nfunction signedIn() { return true; }',group),
    /qa_parity_function_collision/);
});

test('ambos candidatos offline exigem 16+ sem escrita de cliente',()=>{
  for(const candidate of [renderParity(base,chat,group),renderStandalone(chat,group)]){
    assert.equal(candidate.includes('function qaChatAge16Eligible(uid)'),true);
    assert.equal(candidate.includes('qaChatAge16Eligible(request.auth.uid)'),true);
    assert.equal(candidate.includes("proof.get('minimumAge',0) == 16"),true);
    assert.equal(candidate.includes("proof.get('policyVersion','') == '2026-11-16plus-qa-v1'"),true);
    assert.equal(candidate.includes("allow list, create, update, delete: if false;"),true);
    assert.equal(candidate.split('function qaChatAge16Eligible(uid)').length,2);
  }
});

test('somente o QA exige elegibilidade do destinatario e do convidado',()=>{
  for(const candidate of [renderParity(base,chat,group),renderStandalone(chat,group)]){
    assert.equal(candidate.includes('qaChatAge16Eligible(request.resource.data.recipientUid)'),true);
    assert.equal(candidate.includes('qaChatAge16Eligible(getAfter(/databases/$(database)/documents/chats/$(chatId)).data.requesterUid)'),true);
    assert.equal(candidate.includes('qaChatAge16Eligible(getAfter(/databases/$(database)/documents/chats/$(chatId)).data.recipientUid)'),true);
    assert.equal(candidate.includes('qaChatAge16Eligible(inviteeUid)'),true);
    assert.equal(candidate.split('qaChatAge16Eligible(inviteeUid)').length,3);
  }
  assert.throws(()=>renderParity(base,chat.replace(
    'validId(request.resource.data.recipientUid)',
    'validId(request.resource.data.recipientUid) /* fonte mudou */'),group),
    /qa_age16_dm_recipient_anchor_changed/);
});
