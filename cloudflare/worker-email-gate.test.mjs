import test from 'node:test';
import assert from 'node:assert/strict';
import avatarHandler, {verify as verifyAvatar} from './avatar-worker/src/index.js';
import pushHandler, {verifyIdentity as verifyPush} from './push-worker/src/index.js';

const token='a'.repeat(150);
const accessToken='service-qa-oauth-'+ 's'.repeat(150);
const authHeaders={Authorization:'Bearer '+token};
// Chave RSA efemera gerada somente na memoria do teste. Nunca usa
// credenciais reais ou acessa Firebase produtivo.
const keypair=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'
},true,['sign','verify']);
const pkcs8=await crypto.subtle.exportKey('pkcs8',keypair.privateKey);
const serviceJson=JSON.stringify({
  project_id:'atrio-catolico',
  client_email:'qa-policy@atrio-catolico.iam.gserviceaccount.com',
  private_key:'-----BEGIN PRIVATE KEY-----\n'+Buffer.from(pkcs8).toString('base64')+'\n-----END PRIVATE KEY-----'
});
const config={
  FIREBASE_WEB_API_KEY:'fake-qa-key',
  FIREBASE_SERVICE_ACCOUNT_JSON:serviceJson
};
const policy=(enabled,version='2026-11-v1')=>Response.json({
  fields:{enabled:{booleanValue:enabled},version:{stringValue:version}}
});

const identityUrl='https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=';
const policyUrl='/documents/app_config/email_verification';

/** Rede 100% simulada: nao usamos usuarios nem tokens verdadeiros. */
function fakeNetwork({emailVerified=false,disabled=false,uid='qa-member',
  policyReply=()=>policy(true),serviceError=false}={}){
  const record={authCalls:0,oauthCalls:0,policyCalls:0,unexpected:0};
  const fetcher=async(url,options={})=>{
    const target=String(url);
    if(target.startsWith(identityUrl)) {
      record.authCalls++;
      assert.equal(options.method,'POST');
      assert.equal(JSON.parse(options.body).idToken,token);
      return Response.json({users:[{
        localId:uid,disabled,emailVerified,
        email_verified:true,profile:{email_verified:true}
      }]});
    }
    if(target==='https://oauth2.googleapis.com/token') {
      record.oauthCalls++;
      assert.equal(options.method,'POST');
      if(serviceError)return new Response('',{status:503});
      return Response.json({access_token:accessToken,expires_in:3600});
    }
    if(target.endsWith(policyUrl)) {
      record.policyCalls++;
      // O token do cliente tem autorizacao APENAS para validar identidade.
      // A politica e sempre consultada pelo OAuth da conta de servico.
      assert.equal(options.headers.Authorization,'Bearer '+accessToken);
      assert.notEqual(options.headers.Authorization,'Bearer '+token);
      assert.equal(options.method,'GET');
      assert.equal(options.cache,'no-store');
      return policyReply();
    }
    record.unexpected++;
    throw Error('rede externa inesperada');
  };
  return {record,fetcher};
}

for(const [name,identify] of [['avatar',verifyAvatar],['push',verifyPush]]) {
  async function scenario(opts={}, expectedPolicyCalls=1){
    const old=globalThis.fetch;
    const mock=fakeNetwork(opts);
    globalThis.fetch=mock.fetcher;
    try {
      const user=await identify(new Request('https://qa.invalid/test',{
        headers:authHeaders
      }),config);
      assert.equal(mock.record.authCalls,1);
      assert.equal(mock.record.policyCalls,expectedPolicyCalls);
      assert.equal(mock.record.unexpected,0);
      return user;
    } finally {globalThis.fetch=old;}
  }

  test(name+': conta nao verificada bloqueada quando politica ativa; perfil nao tem autoridade',async()=>{
    assert.equal(await scenario(),null);
  });
  test(name+': conta verificada no Auth ignora completamente leitura da politica',async()=>{
    assert.equal(await scenario({emailVerified:true},0),'qa-member');
  });
  test(name+': politica ausente deixa cliente legado entrar sem alterar documento',async()=>{
    assert.equal(await scenario({policyReply:()=>new Response('',{status:404})}),'qa-member');
  });
  test(name+': politica desativada permite uso nao verificado',async()=>{
    assert.equal(await scenario({policyReply:()=>policy(false)}),'qa-member');
  });
  test(name+': versao de politica divergente preserva rollout antigo',async()=>{
    assert.equal(await scenario({policyReply:()=>policy(true,'outro-contrato')}),'qa-member');
  });
  test(name+': conta desativada e bloqueada antes da consulta privilegiada',async()=>{
    assert.equal(await scenario({disabled:true},0),null);
  });
  test(name+': falha da politica resulta em indisponibilidade, nunca bypass',async()=>{
    await assert.rejects(scenario({
      policyReply:()=>new Response('',{status:503})
    }),/email_policy_unavailable/);
  });

}

const endpoints=[
  {name:'avatar/status',handler:avatarHandler,url:'https://qa.invalid/avatar/status',
    env:{...config,CLOUDINARY_CLOUD_NAME:'qa',CLOUDINARY_API_KEY:'qa',
      CLOUDINARY_API_SECRET:'qa',AVATAR_DB:{}},body:undefined},
  {name:'push/event',handler:pushHandler,url:'https://qa.invalid/event',
    env:{...config,PUSH_ENABLED:'true',PUSH_DB:{}},
    body:JSON.stringify({type:'reply'})}
];

for(const endpoint of endpoints){
  for(const [scenarioName,policyReply,expectedState,expectedHttp] of [
    ['required',()=>policy(true),'unauthorized',401],
    ['unavailable',()=>new Response('',{status:503}),
      endpoint.name==='avatar/status'?'temporarily_unavailable':'unavailable',503]
  ]){
    test(endpoint.name+': porta HTTP '+scenarioName+' valida OAuth administrativo primeiro',async()=>{
      const old=globalThis.fetch;
      const mock=fakeNetwork({policyReply});
      globalThis.fetch=mock.fetcher;
      try{
        const resp=await endpoint.handler.fetch(new Request(endpoint.url,{
          method:'POST',
          headers:{...authHeaders,...(endpoint.body?{'Content-Type':'application/json'}:{})},
          body:endpoint.body
        }),endpoint.env);
        assert.equal(resp.status,expectedHttp);
        assert.equal((await resp.json()).status,expectedState);
        assert.equal(mock.record.authCalls,1);
        assert.equal(mock.record.policyCalls,1);
        assert.equal(mock.record.unexpected,0);
      }finally{globalThis.fetch=old;}
    });
  }
}


test('Push 503 inclui apenas codigo seguro quando QA pede explicitamente',async()=>{
  const old=globalThis.fetch;
  const mocked=fakeNetwork({policyReply:()=>new Response('secret-token-in-body',{status:403})});
  globalThis.fetch=mocked.fetcher;
  try{
    const base={method:'POST',
      headers:{...authHeaders,'Content-Type':'application/json',
        'X-Atrio-QA-Diagnostic':'1'},
      body:JSON.stringify({type:'post',postId:'qa-nonexistent-1234'})};
    const res=await pushHandler.fetch(new Request('https://qa.invalid/moderation/event',base),{
      ...config,PUSH_ENABLED:'true',GUARDIAO_ENABLED:'true',PUSH_DB:{}
    });
    assert.equal(res.status,503);
    const body=await res.json();
    assert.deepEqual(body,{status:'unavailable',qaDiagnostic:'policy_http_403'});
    assert.ok(!JSON.stringify(body).includes(token));
    assert.ok(!JSON.stringify(body).includes('secret-token-in-body'));
    assert.equal(mocked.record.policyCalls,1);
  } finally{globalThis.fetch=old;}
});
test('Push 503 continua generico sem diagnostico voluntario',async()=>{
  const old=globalThis.fetch;
  const mocked=fakeNetwork({policyReply:()=>new Response('',{status:403})});
  globalThis.fetch=mocked.fetcher;
  try{
    const res=await pushHandler.fetch(new Request('https://qa.invalid/moderation/event',{
      method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},
      body:JSON.stringify({type:'post',postId:'qa-nonexistent-1234'})
    }),{...config,PUSH_ENABLED:'true',GUARDIAO_ENABLED:'true',PUSH_DB:{}});
    assert.equal(res.status,503);
    assert.deepEqual(await res.json(),{status:'unavailable'});
  }finally{globalThis.fetch=old;}
});
