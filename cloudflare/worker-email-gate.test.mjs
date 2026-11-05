import test from 'node:test';
import assert from 'node:assert/strict';
import avatarHandler, {verify as verifyAvatar} from './avatar-worker/src/index.js';
import pushHandler, {verifyIdentity as verifyPush} from './push-worker/src/index.js';

const token='a'.repeat(150);
const authHeaders={Authorization:'Bearer '+token};
const config={FIREBASE_WEB_API_KEY:'fake-qa-key'};
const policy=(enabled,version='2026-11-v1')=>Response.json({
  fields:{enabled:{booleanValue:enabled},version:{stringValue:version}}
});

/**
 * As duas portas consultam o mesmo Firebase real, mas cada integracao deve
 * recusar uma conta nao verificada ANTES de qualquer operacao privilegiada.
 * Simulamos apenas rede local com respostas sinteticas, sem Firebase produtivo.
 */
for (const [name,identify] of [['avatar',verifyAvatar],['push',verifyPush]]) {
  async function scenario({emailVerified=false,disabled=false,uid='qa-member',
    policyReply=()=>policy(true),expectedPolicyCalls=1}={}) {
    const old=globalThis.fetch;
    let authCalls=0,policyCalls=0;
    globalThis.fetch=async(url,options={})=>{
      const target=String(url);
      if(target.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=')) {
        authCalls++;
        assert.equal(options.method,'POST');
        assert.equal(JSON.parse(options.body).idToken,token);
        return Response.json({users:[{
          localId:uid,disabled,emailVerified,
          // A marca do perfil NAO tem autoridade para aprovar o acesso.
          email_verified:true,profile:{email_verified:true}
        }]});
      }
      if(target.endsWith('/documents/app_config/email_verification')) {
        policyCalls++;
        assert.equal(options.headers.Authorization,'Bearer '+token);
        return policyReply();
      }
      throw Error('rede externa inesperada: '+target);
    };
    try {
      const user=await identify(new Request('https://qa.invalid/test',{
        headers:authHeaders
      }),config);
      assert.equal(authCalls,1);
      assert.equal(policyCalls,expectedPolicyCalls);
      return user;
    } finally {globalThis.fetch=old;}
  }

  test(name+': nao verificado e bloqueado com flag ativa, apesar de perfil falsificado',async()=>{
    assert.equal(await scenario(),null);
  });
  test(name+': apenas emailVerified boolean true do Firebase permite entrada direta',async()=>{
    assert.equal(await scenario({emailVerified:true,expectedPolicyCalls:0}),'qa-member');
  });
  test(name+': sem configuracao ainda aceita cliente legado',async()=>{
    assert.equal(await scenario({policyReply:()=>new Response('',{status:404})}),'qa-member');
  });
  test(name+': politica desativada aceita usuario nao verificado',async()=>{
    assert.equal(await scenario({policyReply:()=>policy(false)}),'qa-member');
  });
  test(name+': politica de versao divergente preserva estado legado',async()=>{
    assert.equal(await scenario({policyReply:()=>policy(true,'outro-contrato')}),'qa-member');
  });
  test(name+': conta desativada e bloqueada sem consultar politica',async()=>{
    assert.equal(await scenario({disabled:true,expectedPolicyCalls:0}),null);
  });
  test(name+': falha na politica resulta em indisponibilidade, nunca bypass',async()=>{
    await assert.rejects(scenario({policyReply:()=>new Response('',{status:503})}),
      /email_policy_unavailable/);
  });
}

/** Requisicoes HTTP diretas nao podem contornar o portao antes do servico. */
const endpoints=[
  {
    name:'avatar/status',
    handler:avatarHandler,
    url:'https://qa.invalid/avatar/status',
    env:{
      CLOUDINARY_CLOUD_NAME:'qa',CLOUDINARY_API_KEY:'qa',
      CLOUDINARY_API_SECRET:'qa',FIREBASE_WEB_API_KEY:'fake-qa-key',
      FIREBASE_SERVICE_ACCOUNT_JSON:'{}',AVATAR_DB:{}
    },
    body:undefined
  },
  {
    name:'push/event',
    handler:pushHandler,
    url:'https://qa.invalid/event',
    env:{
      PUSH_ENABLED:'true',PUSH_DB:{},
      FIREBASE_WEB_API_KEY:'fake-qa-key',FIREBASE_SERVICE_ACCOUNT_JSON:'{}'
    },
    body:JSON.stringify({type:'reply'})
  }
];
for(const endpoint of endpoints) {
  for(const [policyCode,expected] of [['required',401],['unavailable',503]]) {
    test(endpoint.name+': HTTP nao aceita bypass quando politica '+policyCode,async()=>{
      const old=globalThis.fetch;
      const contacted=[];
      globalThis.fetch=async(url,options={})=>{
        const target=String(url);
        contacted.push(target);
        if(target.includes('identitytoolkit.googleapis.com/v1/accounts:lookup'))
          return Response.json({users:[{localId:'qa-member',disabled:false,emailVerified:false}]});
        if(target.endsWith('/documents/app_config/email_verification')) {
          assert.equal(options.headers.Authorization,'Bearer '+token);
          return policyCode==='required'?policy(true):new Response('',{status:503});
        }
        throw Error('Operacao privilegiada indevida: '+target);
      };
      try {
        const resp=await endpoint.handler.fetch(new Request(endpoint.url,{
          method:'POST',headers:{
            ...authHeaders,...(endpoint.body?{'Content-Type':'application/json'}:{})
          },
          body:endpoint.body
        }),endpoint.env);
        assert.equal(resp.status,expected);
        assert.equal(contacted.length,2);
        assert.equal((await resp.json()).status,
          policyCode==='required'?'unauthorized':
          endpoint.name==='avatar/status'?'temporarily_unavailable':'unavailable');
      } finally {globalThis.fetch=old;}
    });
  }
}
