import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPerfilQaRules} from './termux-perfil-qa-rules-readonly.mjs';
const PROJECT='atrio-catolico-qa-perfil';
const TOKEN='mock-token-not-a-secret-abcdefghijklmnopqrstuvwxyz';
const RELEASE='projects/'+PROJECT+'/releases/cloud.firestore';
const RULESET='projects/'+PROJECT+'/rulesets/fixture123';
const DENY=`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;
const candidate=`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /posts/{postId} {
      allow get: if request.auth != null;
    }
    match /{document=**} { allow read, write: if false; }
  }
}`;
function mock({rules=DENY,release=RELEASE,ruleset=RULESET,status=200,files=true}={}){
  const urls=[];
  const fetcher=async(url,opts)=>{
    urls.push(url);
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);
    assert.ok(url.startsWith(
      'https://firebaserules.googleapis.com/v1/projects/'+PROJECT+'/'));
    if(status!==200)return new Response('',{status});
    if(url.endsWith('/releases/cloud.firestore'))
      return Response.json({name:release,rulesetName:ruleset});
    return Response.json({name:RULESET,source:{files:files?[{content:rules}]:[]}});
  };
  return {urls,fetcher};
}

test('release deny-all: 2 GET, hashes, nenhum segredo, sem deploy',async()=>{
  const q=mock();
  const r=await inspectPerfilQaRules({
    tokenProvider:async()=>TOKEN,fetcher:q.fetcher,candidateRules:candidate
  });
  assert.equal(q.urls.length,2);
  assert.equal(r.project,PROJECT);
  assert.equal(r.database,'(default)');
  assert.equal(r.publishedDenyAll,true);
  assert.equal(r.matchesCandidate,false);
  assert.equal(r.deployPerformed,false);
  assert.equal(r.productionContacted,false);
  assert.match(r.publishedSha256,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});

test('regras que permitam leitura não são classificadas como deny-all',async()=>{
  const q=mock({rules:candidate});
  const r=await inspectPerfilQaRules({
    tokenProvider:async()=>TOKEN,fetcher:q.fetcher,candidateRules:candidate
  });
  assert.equal(r.publishedDenyAll,false);
  assert.equal(r.matchesCandidate,true);
});

test('resposta com identidade de produção é rejeitada antes de segundo GET',async()=>{
  const q=mock({ruleset:'projects/atrio-catolico/rulesets/fixture123'});
  await assert.rejects(inspectPerfilQaRules({
    tokenProvider:async()=>TOKEN,fetcher:q.fetcher,candidateRules:candidate
  }),/perfil_qa_rules_readonly_release_identity_mismatch/);
  assert.equal(q.urls.length,1);
});

test('403, ausência de arquivo e ausência de login falham fechados',async()=>{
  const bad=mock({status:403});
  await assert.rejects(inspectPerfilQaRules({
    tokenProvider:async()=>TOKEN,fetcher:bad.fetcher,candidateRules:candidate
  }),/perfil_qa_rules_readonly_read_denied/);
  const empty=mock({files:false});
  await assert.rejects(inspectPerfilQaRules({
    tokenProvider:async()=>TOKEN,fetcher:empty.fetcher,candidateRules:candidate
  }),/perfil_qa_rules_readonly_ruleset_incomplete/);
  const invalid=mock();
  await assert.rejects(inspectPerfilQaRules({
    tokenProvider:async()=>'x',fetcher:invalid.fetcher,candidateRules:candidate
  }),/perfil_qa_rules_readonly_missing_login/);
  assert.equal(invalid.urls.length,0);
});
