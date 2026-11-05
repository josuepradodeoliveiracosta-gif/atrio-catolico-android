import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchPublishedRules,summarizePublishedVsRepository,compareProductionReadOnly
} from './termux-firestore-rules-diff-readonly.mjs';

const token='mock-oauth-do-not-share-1234567890';
const release='projects/atrio-catolico/releases/cloud.firestore';
const ruleset='projects/atrio-catolico/rulesets/01234567-abcd-abcd-abcd-9876543210ab';
const old=[
  "rules_version = '2';",
  "service cloud.firestore {",
  "  match /databases/{database}/documents {",
  "    function signedIn() {",
  "      return request.auth != null;",
  "    }",
  "    match /posts/{id} {",
  "      allow get, list: if signedIn();",
  "      allow create: if signedIn();",
  "    }",
  "  }",
  "}",
  '//'.padEnd(1200,' ')
].join('\n');
const updated=old.replace('    match /posts/{id} {',[
  '    function emailVerificationAllowsCommunityAccess() {',
  '      return request.auth.token.get("email_verified", false) == true;',
  '    }',
  '    match /posts/{id} {'].join('\n'))
  .replace('allow get, list: if signedIn();',
    'allow get, list: if signedIn() && emailVerificationAllowsCommunityAccess();');
const json=value=>Response.json(value);
const fixture=(rules=old)=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    assert.ok(options.signal);
    calls.push(url);
    if(url.endsWith('/releases/cloud.firestore'))return json({
      name:release,rulesetName:ruleset,updateTime:'2026-11-05T14:00:00Z'
    });
    if(url.endsWith('/rulesets/01234567-abcd-abcd-abcd-9876543210ab'))
      return json({name:ruleset,source:{files:[{name:'firestore.rules',content:rules}]}});
    throw Error('Unexpected network operation');
  };
  return {calls,fetcher};
};

test('duas leituras GET, sem gravar ou criar backups',async()=>{
  const t=fixture();
  const out=await compareProductionReadOnly({
    tokenProvider:async()=>token,
    fetcher:t.fetcher,
    localRules:updated
  });
  assert.equal(out.mode,'READ_ONLY_NO_DEPLOY_NO_BACKUP');
  assert.equal(t.calls.length,2);
  assert.equal(out.publishedContainsEmailGate,false);
  assert.equal(out.repositoryContainsEmailGate,true);
  assert.equal(out.exactMatch,false);
  assert.equal(out.deploymentApproved,false);
  assert.equal(out.releaseApproved,false);
});

test('localiza alteracao das permissoes e declaracoes sem imprimir todas as regras',()=>{
  const report=summarizePublishedVsRepository(old,updated);
  assert.equal(report.exactMatch,false);
  assert.ok(report.differentRegions>=1);
  assert.ok(report.repositoryOnlyLines>=4);
  assert.ok(report.repositoryOnlyDeclarations.some(x=>x.includes('emailVerificationAllowsCommunityAccess')));
  assert.ok(report.shownRegions.some(x=>
    x.repositoryExamples.some(e=>e.includes('emailVerificationAllowsCommunityAccess'))));
  assert.ok(report.publishedSha256!==report.repositorySha256);
  assert.ok(JSON.stringify(report).length<5000);
});

test('regras iguais produzem zero diferencas e fingerprint igual',()=>{
  const report=summarizePublishedVsRepository(old,old);
  assert.equal(report.exactMatch,true);
  assert.equal(report.differentRegions,0);
  assert.equal(report.publishedSha256,report.repositorySha256);
  assert.equal(report.publishedOnlyLines,0);
  assert.equal(report.repositoryOnlyLines,0);
});

test('segredos e e-mails nao sao exibidos em trechos de diferenca',()=>{
  const withEmail=old.replace('allow create: if signedIn();',
    'allow create: if signedIn() && request.auth.email == "pessoa@exemplo.com";');
  const report=summarizePublishedVsRepository(old,withEmail);
  const result=JSON.stringify(report);
  assert.equal(result.includes('pessoa@exemplo.com'),false);
  assert.ok(result.includes('[email ocultado]'));
});

test('fonte incompleta, API HTTP negada e erros de rede nao viram permissao de deploy',async()=>{
  assert.throws(()=>summarizePublishedVsRepository('a',updated),/atrio_rules_diff_invalid_source/);
  await assert.rejects(fetchPublishedRules({token,fetcher:async()=>new Response('',{status:403})}),
    /atrio_rules_diff_permission_denied/);
  await assert.rejects(fetchPublishedRules({token,fetcher:async()=>{throw Error('network');}}),
    /atrio_rules_diff_network_unavailable/);
});

test('rejeita ruleset errado sem consultar outros projetos',async()=>{
  let count=0;
  const fetcher=async(url)=>{
    count++;
    assert.ok(url.includes('/projects/atrio-catolico/'));
    return json({name:release,rulesetName:'projects/outro-projeto/rulesets/abcdef'});
  };
  await assert.rejects(fetchPublishedRules({token,fetcher}),/atrio_rules_diff_unexpected_release/);
  assert.equal(count,1);
});

test('rejeita origem com varios arquivos para evitar comparacao incompleta',async()=>{
  const fetcher=async(url)=>{
    if(url.endsWith('/releases/cloud.firestore'))
      return json({name:release,rulesetName:ruleset});
    return json({name:ruleset,source:{files:[
      {name:'one',content:old},{name:'two',content:updated}
    ]}});
  };
  await assert.rejects(fetchPublishedRules({token,fetcher}),
    /atrio_rules_diff_invalid_ruleset_source/);
});

test('limita o resumo se houver muitas regioes diferentes',()=>{
  const prefix='//'.padEnd(1000,' ');
  const published=[prefix,...Array.from({length:85},(_,i)=>'allow '+i+';')].join('\n');
  const repository=[prefix,...Array.from({length:85},(_,i)=>
    i%2===0?'allow '+i+';':'allow '+i+' changed;')].join('\n');
  const summary=summarizePublishedVsRepository(published,repository);
  assert.ok(summary.differentRegions>16);
  assert.equal(summary.shownRegions.length,16);
  assert.equal(summary.moreRegionsOmitted,summary.differentRegions-16);
});
