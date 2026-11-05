import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findAndroidApiKey,signInQa,runRealAccountQa,evaluateQaStatuses
} from './termux-real-email-auth-smoke.mjs';

const key='AIza'+'A'.repeat(36);
const oauth='o'.repeat(150);
const userToken='t'.repeat(220);
const appId='1:123456789:android:deadbeefabc123';
const config={project_info:{project_id:'atrio-catolico'},client:[{
  client_info:{android_client_info:{package_name:'br.com.atriocatolico'}},
  api_key:[{current_key:key}]
}]};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function authStub({verified=false,policy='MISSING',forbidden=false}={}) {
  const calls=[];
  const fetcher=async(url,options)=>{
    const target=String(url),body=options.body?JSON.parse(options.body):null;
    calls.push({url:target.replace(/key=[^&]+/g,'key=[redacted]'),
      method:options.method,hasToken:!!options.headers.Authorization,bodyKeys:body&&Object.keys(body).sort()});
    if(target.includes('accounts:signInWithPassword')){
      assert.equal(options.method,'POST');
      assert.equal(body.email,'qa@example.invalid');
      assert.equal(body.password,'password-not-logged');
      return json({localId:'qa-account',idToken:userToken});
    }
    if(target.includes('accounts:lookup')){
      assert.equal(body.idToken,userToken);
      return json({users:[{localId:'qa-account',emailVerified:verified,disabled:false}]});
    }
    if(target.endsWith('/documents/app_config/email_verification'))
      return policy==='MISSING'?new Response('',{status:404}):
        json({fields:{enabled:{booleanValue:true},version:{stringValue:'2026-11-v1'}}});
    if(target.includes('/documents/posts/')){
      assert.equal(options.method,'GET');
      return new Response('',{status:forbidden?403:404});
    }
    if(target.endsWith('/avatar/moderation/preview')){
      assert.equal(options.method,'GET');
      assert.equal(options.headers.Authorization,'Bearer '+userToken);
      return json({status:forbidden?'unauthorized':'forbidden'},forbidden?401:403);
    }
    if(target.endsWith('/moderation/event')){
      assert.equal(options.method,'POST');
      assert.equal(body.type,'post');
      assert.ok(/^atrio-qa-nonexistent-/.test(body.postId));
      return json({status:forbidden?'unauthorized':'ignored'},forbidden?401:202);
    }
    throw Error('unexpected endpoint');
  };
  return {fetcher,calls};
}

test('descobre app Android e extrai somente key correta sem expor a configuração',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push(url);
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer '+oauth);
    if(url.endsWith('/androidApps'))
      return json({apps:[{appId,packageName:'br.com.atriocatolico',state:'ACTIVE'}]});
    if(url.endsWith('/config'))return json({
      configFileContents:Buffer.from(JSON.stringify(config),'utf8').toString('base64')
    });
    throw Error('unexpected');
  };
  assert.equal(await findAndroidApiKey(oauth,fetcher),key);
  assert.equal(calls.length,2);
  assert.ok(calls.every(url=>url.startsWith('https://firebase.googleapis.com/')));
});

test('qualquer app duplicado ou de outro projeto impede uso da API key',async()=>{
  const duplicate=async()=>json({apps:[
    {appId,packageName:'br.com.atriocatolico'},
    {appId,packageName:'br.com.atriocatolico'}
  ]});
  await assert.rejects(findAndroidApiKey(oauth,duplicate),
    /atrio_real_auth_qa_android_application_not_unique/);
  const wrong=async(url)=>{
    if(url.endsWith('/androidApps'))return json({
      apps:[{appId,packageName:'br.com.atriocatolico'}]});
    return json({configFileContents:Buffer.from(JSON.stringify({
      ...config,project_info:{project_id:'another-project'}
    })).toString('base64')});
  };
  await assert.rejects(findAndroidApiKey(oauth,wrong),/atrio_real_auth_qa_wrong_firebase_project/);
});

test('conta QA nao verificada com politica ativa recebe negacao no Firebase e Workers',async()=>{
  const f=authStub({verified:false,policy:'ACTIVE',forbidden:true});
  const out=await runRealAccountQa({
    apiKey:key,email:'qa@example.invalid',password:'password-not-logged',
    expectedPolicy:'ACTIVE',expectedVerified:false,fetcher:f.fetcher,
    randomId:()=> '12345678-1234-4234-a234-123456789abc'
  });
  assert.equal(out.allPassed,true);
  assert.deepEqual(out.checks.map(x=>x.actualHttp),[403,401,401]);
  assert.equal(f.calls.length,6);
  assert.equal(f.calls.filter(x=>x.method==='POST').length,3);
  assert.equal(JSON.stringify(out).includes(userToken),false);
  assert.equal(JSON.stringify(out).includes('qa@example.invalid'),false);
});

test('conta confirmada, politica ativa: Firestore e endpoints reconhecem a sessao',async()=>{
  const f=authStub({verified:true,policy:'ACTIVE'});
  const out=await runRealAccountQa({apiKey:key,email:'qa@example.invalid',
    password:'password-not-logged',expectedPolicy:'ACTIVE',expectedVerified:true,
    fetcher:f.fetcher,randomId:()=> '12345678-1234-4234-a234-123456789abc'});
  assert.equal(out.allPassed,true);
  assert.deepEqual(out.checks.map(x=>x.actualHttp),[404,403,202]);
});

test('conta nao confirmada ainda entra quando documento nao existe (baseline)',async()=>{
  const f=authStub({verified:false,policy:'MISSING'});
  const out=await runRealAccountQa({
    apiKey:key,email:'qa@example.invalid',password:'password-not-logged',
    expectedPolicy:'MISSING',expectedVerified:false,
    fetcher:f.fetcher,randomId:()=> '12345678-1234-4234-a234-123456789abc'
  });
  assert.equal(out.allPassed,true);
  assert.deepEqual(out.checks.map(x=>x.actualHttp),[404,403,202]);
});

test('estado de verificacao diferente do informado aborta antes de consultar dados',async()=>{
  const f=authStub({verified:false,policy:'ACTIVE'});
  await assert.rejects(runRealAccountQa({
    apiKey:key,email:'qa@example.invalid',password:'password-not-logged',
    expectedPolicy:'ACTIVE',expectedVerified:true,fetcher:f.fetcher,
  }),/atrio_real_auth_qa_account_verification_mismatch/);
  assert.equal(f.calls.length,2);
});

test('politica de producao diferente da solicitada aborta antes das rotas Workers',async()=>{
  const f=authStub({verified:false,policy:'MISSING'});
  await assert.rejects(runRealAccountQa({
    apiKey:key,email:'qa@example.invalid',password:'password-not-logged',
    expectedPolicy:'ACTIVE',expectedVerified:false,fetcher:f.fetcher,
  }),/atrio_real_auth_qa_unexpected_production_policy/);
  assert.equal(f.calls.length,3);
});

test('respostas de Worker divergentes nao produzem falso sucesso',()=>{
  const x=evaluateQaStatuses({policyState:'ACTIVE',verified:false,
    results:{firestore:403,avatar:401,push:202}});
  assert.equal(x.allPassed,false);
  assert.equal(x.checks.find(i=>i.service==='push').pass,false);
});

test('servico de autenticacao indisponivel falha fechado sem mensagens pessoais',async()=>{
  const f=async()=>json({error:{message:'senha-informada'}},400);
  await assert.rejects(signInQa(key,'qa@example.invalid','password-not-logged',f),
    e=>{assert.equal(e.message,'atrio_real_auth_qa_qa_signin_failed');return true;});
});
