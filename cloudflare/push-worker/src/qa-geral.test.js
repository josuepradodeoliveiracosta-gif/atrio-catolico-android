import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import qaWorker, {createQaRelay} from './qa-geral.js';

const qaProject = 'atrio-catolico-qa-general';
const qaService = 'atrio-qa-general-push@' + qaProject + '.iam.gserviceaccount.com';
const alice = {localId:'qa-nav-alice', email:'alice.navegacao@qa.invalid', emailVerified:true};
const bob = 'qa-nav-bob';
const base64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (project = qaProject) => base64({alg:'RS256'}) + '.' +
  base64({aud:project, iss:'https://securetoken.google.com/' + project}) + '.fake-signature';
const replyRequest = (project = qaProject) => new Request('https://qa.invalid/event', {
  method:'POST', headers:{Authorization:'Bearer ' + jwt(project)},
  body:JSON.stringify({type:'reply', postId:'qa-post', replyId:'qa-reply'})
});
const forbiddenDb = {prepare() { assert.fail('D1 foi acessado sem autorização'); }};
const qaConfig = {
  QA_PUSH_ENABLED:'true',
  QA_PUSH_DB:forbiddenDb,
  QA_FIREBASE_WEB_API_KEY:'chave-cliente-de-teste',
  QA_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({
    project_id:qaProject, client_email:qaService, private_key:'chave-fictícia'
  }),
};
const health = () => new Request('https://qa.invalid/health');

test('relay de QA recusa configuração de produção, conta divergente e rotas de outros serviços', async t => {
  const access = t.mock.method(globalThis, 'fetch', () => assert.fail('Não deve consultar a rede'));
  for (const credential of [
    {project_id:'atrio-catolico', client_email:'producao@example.test', private_key:'x'},
    {project_id:qaProject, client_email:'outra@example.test', private_key:'x'},
  ]) {
    const env = {...qaConfig, QA_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(credential)};
    assert.deepEqual(await (await qaWorker.fetch(health(), env)).json(), {status:'disabled'});
    assert.equal((await qaWorker.fetch(replyRequest(),env)).status, 503);
  }
  assert.deepEqual(await (await qaWorker.fetch(health(), {PUSH_ENABLED:'true'})).json(), {status:'disabled'});
  for (const path of ['/broadcast', '/moderation/event', '/moderation/review']) {
    const request = new Request('https://qa.invalid' + path, {method:'POST'});
    assert.equal((await qaWorker.fetch(request,qaConfig)).status, 404);
  }
  assert.equal(access.mock.callCount(), 0);
});

test('recusa token do projeto errado e autentica apenas as contas fictícias verificadas', async t => {
  let account = {...alice, emailVerified:false};
  const auth = t.mock.method(globalThis, 'fetch', async () => Response.json({users:[account]}));
  assert.equal((await qaWorker.fetch(replyRequest('atrio-catolico'),qaConfig)).status, 401);
  assert.equal(auth.mock.callCount(), 0);
  assert.equal((await qaWorker.fetch(replyRequest('atrio-catolico-qa-geral'),qaConfig)).status, 401);
  assert.equal(auth.mock.callCount(), 0);
  assert.equal((await qaWorker.fetch(replyRequest(),qaConfig)).status, 401);
  assert.equal(auth.mock.callCount(), 1);
  account = {...alice, email:'bob.navegacao@qa.invalid'};
  assert.equal((await qaWorker.fetch(replyRequest(),qaConfig)).status, 401);
  account = {...alice, localId:'conta-de-fora'};
  assert.equal((await qaWorker.fetch(replyRequest(),qaConfig)).status, 401);
  assert.equal(auth.mock.callCount(), 3);
});

test('resposta gera FCM apenas ao dispositivo de Bob, no projeto QA', async t => {
  const {privateKey} = generateKeyPairSync('rsa', {modulusLength:2048});
  const credential = JSON.stringify({
    project_id:qaProject, client_email:qaService,
    private_key:privateKey.export({type:'pkcs8',format:'pem'})
  });
  const markers = new Set();
  const db = {prepare(sql) {
    return {bind(key) {
      return {async run() {
        if (!sql.startsWith('INSERT OR IGNORE INTO delivered')) return {meta:{changes:1}};
        if (markers.has(key)) return {meta:{changes:0}};
        markers.add(key);
        return {meta:{changes:1}};
      }};
    }};
  }};
  const now = new Date().toISOString();
  const stamp = {timestampValue:now};
  const string = stringValue => ({stringValue});
  const doc = fields => Response.json({fields});
  const fcm = [];
  let retired = false;
  const access = t.mock.method(globalThis, 'fetch', async (target, options) => {
    const url = new URL(target);
    if (url.hostname === 'identitytoolkit.googleapis.com') {
      assert.equal(url.searchParams.get('key'), qaConfig.QA_FIREBASE_WEB_API_KEY);
      assert.equal(JSON.parse(options.body).idToken, jwt());
      return Response.json({users:[alice]});
    }
    if (url.hostname === 'oauth2.googleapis.com') {
      const [,claims] = options.body.get('assertion').split('.');
      assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).iss, qaService);
      return Response.json({access_token:'oauth-fictício', expires_in:3600});
    }
    assert.equal(options.headers.Authorization, 'Bearer oauth-fictício');
    if (url.hostname === 'fcm.googleapis.com') {
      assert.equal(url.pathname,'/v1/projects/' + qaProject + '/messages:send');
      fcm.push(JSON.parse(options.body).message);
      return Response.json({name:'simulado'});
    }
    assert.equal(url.hostname, 'firestore.googleapis.com');
    assert.ok(!options.method || options.method === 'GET');
    const prefix = '/v1/projects/' + qaProject + '/databases/(default)/documents/';
    assert.ok(url.pathname.startsWith(prefix), 'Todo acesso lê somente o Firestore de QA');
    switch (url.pathname.slice(prefix.length)) {
    case 'app_config/community_feed':
      return retired ? doc({forumRetired:{booleanValue:true}}) : new Response(null,{status:404});
    case 'posts/qa-post':
      return doc({uid:string(bob)});
    case 'posts/qa-post/replies/qa-reply':
      return doc({uid:string(alice.localId), authorName:string('Alice QA'), createdAt:stamp});
    case 'users/qa-nav-bob/notifications/qa-reply':
      return doc({actorUid:string(alice.localId), postId:string('qa-post'), replyId:string('qa-reply')});
    case 'posts/qa-post/replies':
      return Response.json({documents:[{fields:{uid:string('conta-de-fora'),createdAt:stamp}}]});
    case 'users/qa-nav-bob/pushDevices':
      return Response.json({documents:[{
        name:'projects/' + qaProject + '/databases/(default)/documents/users/qa-nav-bob/pushDevices/phone',
        fields:{token:string('token-do-aparelho-ficticio'), updatedAt:stamp}
      }]});
    default:
      assert.fail('Caminho de QA inesperado: ' + url.pathname);
    }
  });
  const env = {...qaConfig, QA_PUSH_DB:db, QA_FIREBASE_SERVICE_ACCOUNT_JSON:credential};
  assert.deepEqual(await (await qaWorker.fetch(health(),env)).json(), {status:'configured'});
  assert.equal(access.mock.callCount(), 0);
  const result = await qaWorker.fetch(replyRequest(),env);
  assert.equal(result.status,202);
  assert.deepEqual(await result.json(), {status:'accepted_by_fcm'});
  assert.equal(fcm.length, 1);
  assert.equal(fcm[0].topic, undefined);
  assert.equal(fcm[0].token, 'token-do-aparelho-ficticio');
  assert.equal(fcm[0].data.uid, bob);
  assert.equal(fcm[0].data.postId, 'qa-post');
  const repeated = await qaWorker.fetch(replyRequest(),env);
  assert.deepEqual(await repeated.json(), {status:'no_devices_or_duplicate'});
  assert.equal(fcm.length, 1);
  retired = true;
  const stopped = await qaWorker.fetch(replyRequest(),env);
  assert.equal(stopped.status,202);
  assert.deepEqual(await stopped.json(), {status:'ignored'});
  assert.equal(fcm.length,1);

});

test('rota de decisão fechada por padrão e restrita a identidade QA verificada', async t => {
  const route='/v1/qa/conversations/chats/qa-nav-alice__qa-nav-bob/decision';
  const now=Math.floor(Date.now()/1000);
  const claims={aud:qaProject,iss:'https://securetoken.google.com/'+qaProject,
    sub:alice.localId,email:alice.email,email_verified:true,
    auth_time:now-100,iat:now-5,exp:now+600,firebase:{sign_in_provider:'password'}};
  const signed=(project,extra={})=>base64({alg:'RS256'})+'.'+base64({
    ...claims,aud:project,iss:'https://securetoken.google.com/'+project,...extra
  })+'.synthetic-signature';
  const request=(project,extra={})=>new Request('https://qa.invalid'+route,{
    method:'POST',headers:{Authorization:'Bearer '+signed(project,extra)}
  });
  let account={...alice,emailVerified:false,validSince:String(now-100)};
  const auth=t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(new URL(url).hostname,'identitytoolkit.googleapis.com');
    assert.equal(options.redirect,'error');
    assert.equal(typeof JSON.parse(options.body).idToken,'string');
    return Response.json({users:[account]});
  });
  let forwarded=0;
  const relay=createQaRelay(null,{async fetch(req,context){
    forwarded++;
    assert.equal(new URL(req.url).pathname,route);
    assert.equal(context.uid,alice.localId);
    assert.equal(context.project,qaProject);
    return Response.json({committed:true});
  }});
  assert.equal((await relay.fetch(request(qaProject),qaConfig)).status,503);
  assert.equal(auth.mock.callCount(),0);
  const env={...qaConfig,QA_CONVERSATIONS_API_ENABLED:'true'};
  assert.equal((await relay.fetch(request('atrio-catolico'),env)).status,403);
  assert.equal(auth.mock.callCount(),0);
  assert.equal((await relay.fetch(request(qaProject),env)).status,403);
  assert.equal(forwarded,0);
  for(const invalid of [
    {...alice,validSince:String(now-99)}, // refreshed token from revoked sign-in
    {...alice}, {...alice,validSince:'malformed'},
    {...alice,validSince:String(now-100),disabled:true},
    {...alice,validSince:String(now-100),localId:bob},
  ]){
    account=invalid;
    assert.equal((await relay.fetch(request(qaProject),env)).status,403);
  }
  account={...alice,validSince:String(now-100)};
  const lookups=auth.mock.callCount();
  for(const invalid of [{exp:now-1},{iat:now+1},{auth_time:now+2},
    {sub:bob},{email_verified:false},{firebase:{sign_in_provider:'anonymous'}}]){
    assert.equal((await relay.fetch(request(qaProject,invalid),env)).status,403);
  }
  assert.equal(auth.mock.callCount(),lookups);
  assert.equal(forwarded,0);
  const allowed=await relay.fetch(request(qaProject),env);
  assert.equal(allowed.status,200);
  assert.match(allowed.headers.get('cache-control'),/no-store/);
  assert.equal(forwarded,1);
  account={...alice,validSince:String(now-99)};
  assert.equal((await relay.fetch(request(qaProject),env)).status,403);
  assert.equal(forwarded,1,'revocation must be checked on every operation');
});
