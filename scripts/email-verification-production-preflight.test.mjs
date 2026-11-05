import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectProduction} from './email-verification-production-preflight.mjs';

const project='atrio-catolico';
const release='projects/'+project+'/releases/cloud.firestore';
const ruleset='projects/'+project+'/rulesets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const policy='projects/'+project+'/databases/(default)/documents/app_config/email_verification';
const localRules=[
  "rules_version = '2';",
  "service cloud.firestore {",
  "  match /databases/{database}/documents {",
  "  function emailVerificationAllowsCommunityAccess() {",
  "    return request.auth.token.get('email_verified', false) == true;",
  "  }",
  ...Array.from({length:24},(_,i)=>
    "  // "+i+" emailVerificationAllowsCommunityAccess()"),
  "  }",
  "}"
].join('\n')+' '.repeat(500);
const token='qa-oauth-token-not-real-1234567890';
const asJson=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'Content-Type':'application/json'}
});
const pathOf=url=>new URL(url).pathname;
function fixture({rules=localRules,enabled=true,version='2026-11-v1',
  missing=false,deny=null,policyFields=null,brokenName=false}={}) {
  const calls=[];
  const fetcher=async(url,options)=>{
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    assert.equal(options.redirect,'error');
    calls.push({url,method:options.method});
    const path=pathOf(url);
    if(deny && path.endsWith(deny))return new Response('',{status:403});
    if(path.endsWith('/releases/cloud.firestore'))
      return asJson({name:release,rulesetName:ruleset,updateTime:'2026-11-05T12:00:00Z'});
    if(path.endsWith('/rulesets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'))
      return asJson({name:ruleset,source:{files:[{name:'firestore.rules',content:rules}]}});
    if(path.endsWith('/app_config/email_verification')) {
      if(missing)return new Response('',{status:404});
      return asJson({name:brokenName?'invalid':policy,
        fields:policyFields||{enabled:{booleanValue:enabled},version:{stringValue:version}},
        updateTime:'2026-11-05T13:00:00Z'});
    }
    throw Error('unexpected get');
  };
  return {fetcher,calls};
}

test('somente GET para release, ruleset e documento: pronto quando tudo coincide',async()=>{
  const fixtureResult=fixture();
  const result=await inspectProduction({token,expectedRules:localRules,fetcher:fixtureResult.fetcher});
  assert.equal(result.ready,true);
  assert.equal(result.rules.exactRepositoryMatch,true);
  assert.equal(result.emailPolicy.state,'ACTIVE');
  assert.equal(fixtureResult.calls.length,3);
  assert.ok(fixtureResult.calls.every(x=>x.method==='GET'));
});

test('documento ausente nao autoriza Release',async()=>{
  const x=await inspectProduction({token,expectedRules:localRules,fetcher:fixture({missing:true}).fetcher});
  assert.equal(x.emailPolicy.state,'MISSING');
  assert.equal(x.ready,false);
});

test('flag inativa ou versao divergente nao autoriza Release',async()=>{
  for(const params of [{enabled:false},{version:'outra'}]){
    const x=await inspectProduction({token,expectedRules:localRules,fetcher:fixture(params).fetcher});
    assert.equal(x.ready,false);
  }
});

test('ruleset remoto divergente nega aceite mesmo com mesma funcao',async()=>{
  const x=await inspectProduction({token,expectedRules:localRules,
    fetcher:fixture({rules:localRules+'\n//alterado'}).fetcher});
  assert.equal(x.rules.exactRepositoryMatch,false);
  assert.equal(x.ready,false);
});

test('documento malformado nao autoriza Release',async()=>{
  const x=await inspectProduction({token,expectedRules:localRules,
    fetcher:fixture({policyFields:{enabled:{stringValue:'true'}}}).fetcher});
  assert.equal(x.emailPolicy.state,'INVALID');
  assert.equal(x.ready,false);
});

test('403 e identidade de documento diferente encerram auditoria com erro seguro',async()=>{
  await assert.rejects(inspectProduction({token,expectedRules:localRules,
    fetcher:fixture({deny:'/app_config/email_verification'}).fetcher}),/permission_denied/);
  await assert.rejects(inspectProduction({token,expectedRules:localRules,
    fetcher:fixture({brokenName:true}).fetcher}),/unexpected_policy_document/);
});

test('sem credencial nao faz requisicao e nao vaza token',async()=>{
  let called=0;
  await assert.rejects(inspectProduction({token:'',expectedRules:localRules,
    fetcher:async()=>{called++;throw Error('never');}}),/missing_oauth_token/);
  assert.equal(called,0);
});
