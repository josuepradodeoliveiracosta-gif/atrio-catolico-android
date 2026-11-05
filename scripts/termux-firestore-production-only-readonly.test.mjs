import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectProductionOnlyLines,reviewPublishedRules}
  from './termux-firestore-production-only-readonly.mjs';

const mockToken='fake-token-only-for-tests-abcdefghijklmnopqrstuvwxyz';
const release='projects/atrio-catolico/releases/cloud.firestore';
const set='projects/atrio-catolico/rulesets/12345678-1234-1234-1234-123456789abc';
const prefix=['rules_version = "2";','service cloud.firestore {',
  ' match /databases/{database}/documents {',' function signedIn() {',
  ' return request.auth != null;',' }'];
const postfix=['  }','}'];
const filler='// test content'.padEnd(1200,'x');
const old=[...prefix,'allow get: if signedIn();',
  'function emailVerificationAllowsPublishing() {',
  ' return true;',
  '}',filler,...postfix].join('\n');
const latest=[...prefix,
  'allow get: if signedIn() && emailVerificationAllowsCommunityAccess();',
  'function emailVerificationAllowsCommunityAccess() {',
  ' return request.auth.token.get("email_verified",false) == true;',
  '}',filler,...postfix].join('\n');
const response=value=>Response.json(value);

test('resumo inclui toda linha removida (inclusive antiga politica de email)',()=>{
  const report=inspectProductionOnlyLines(old,latest);
  assert.ok(report.publishedOnlyTotal>=3);
  assert.equal(report.publishedOnlyTotal,report.publishedOnlyShown);
  assert.ok(report.review.some(x=>x.text.includes('emailVerificationAllowsPublishing')));
  assert.ok(report.review.every(x=>Number.isInteger(x.publishedLine)));
  assert.equal(report.deploymentApproved,false);
  assert.equal(report.releaseApproved,false);
});

test('em regras iguais nao existe codigo unico, mas nem assim aprova deploy',()=>{
  const report=inspectProductionOnlyLines(old,old);
  assert.equal(report.publishedOnlyTotal,0);
  assert.equal(report.requiresManualReview,false);
  assert.equal(report.deploymentApproved,false);
});

test('limita o tamanho e omite segredos, enderecos e linhas longas',()=>{
  const sensitive=[
    ' let api_key = "valor_secreto";',
    ' allow get: if request.auth.token.email == "pessoa@exemplo.org";',
    ' allow get: if request.auth != null && "https://example.org/secret" != "";',
    ' allow get: if request.auth != null && "'+'t'.repeat(300)+'" == "";'
  ];
  const production=[...prefix,...sensitive,filler,...postfix].join('\n');
  const report=inspectProductionOnlyLines(production,latest);
  const output=JSON.stringify(report);
  assert.equal(output.includes('valor_secreto'),false);
  assert.equal(output.includes('pessoa@exemplo.org'),false);
  assert.equal(output.includes('https://example.org/secret'),false);
  assert.equal(output.includes('t'.repeat(90)),false);
  assert.ok(output.includes('ocultado'));
  assert.ok(report.review.some(x=>x.kind==='long_line'));
});

test('duas consultas GET, jamais escrita ou backup',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,method:options.method});
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer '+mockToken);
    if(url.endsWith('/releases/cloud.firestore'))
      return response({name:release,rulesetName:set});
    if(url.endsWith('/rulesets/12345678-1234-1234-1234-123456789abc'))
      return response({name:set,source:{files:[{name:'firestore.rules',content:old}]}});
    throw Error('unexpected path');
  };
  const result=await reviewPublishedRules({
    localRules:latest,tokenProvider:async()=>mockToken,fetcher
  });
  assert.equal(result.mode,'READ_ONLY_NO_BACKUP');
  assert.equal(calls.length,2);
  assert.ok(calls.every(x=>x.method==='GET'));
  assert.equal(result.deploymentApproved,false);
});

test('falta de acesso ou fonte invalida aborta sem falso positivo',async()=>{
  assert.throws(()=>inspectProductionOnlyLines('',latest),/atrio_rules_review_missing_rules/);
  await assert.rejects(reviewPublishedRules({
    localRules:latest,tokenProvider:async()=>mockToken,
    fetcher:async()=>new Response('',{status:403})
  }),/atrio_rules_diff_permission_denied/);
});
