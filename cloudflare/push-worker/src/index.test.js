import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import worker, {resolveEvent, readEventBody} from './index.js';

const iso = () => new Date(Date.now() - 2000).toISOString();
const doc = (data={}) => ({fields:Object.fromEntries(Object.entries(data).map(([key,value]) =>
  [key, typeof value==='boolean' ? {booleanValue:value} : key.endsWith('At')
    ? {timestampValue:value} : {stringValue:value}]))});
const originalFetch = globalThis.fetch;
afterEach(() => {globalThis.fetch = originalFetch;});

function mocked(docs) {
  globalThis.fetch = async url => {
    const path = decodeURIComponent(new URL(url).pathname).split('/documents/')[1]
      +new URL(url).search;
    const result = docs[path] ?? docs[path.split('?')[0]];
    if(!result) return new Response('{}',{status:404});
    return new Response(JSON.stringify(result),{status:200});
  };
}
test('uma resposta válida aponta ao autor e não ao remetente',async()=>{
  mocked({
    'posts/p1':doc({uid:'dono'}),
    'posts/p1/replies/r1':doc({uid:'autor',createdAt:iso()}),
    'users/dono/notifications/r1':doc({actorUid:'autor',postId:'p1',replyId:'r1',read:false}),
  });
  const result=await resolveEvent({type:'reply',postId:'p1',replyId:'r1'},'autor','fake');
  assert.deepEqual(result.recipients,['dono']);
  assert.equal(result.kind,'reply');
});
test('um usuário não simula aviso de resposta escrita por outro',async()=>{
  mocked({
    'posts/p1':doc({uid:'dono'}),
    'posts/p1/replies/r1':doc({uid:'autor',createdAt:iso()}),
    'users/dono/notifications/r1':doc({actorUid:'autor',postId:'p1',replyId:'r1',read:false}),
  });
  assert.equal(await resolveEvent({type:'reply',postId:'p1',replyId:'r1'},'intruso','fake'),null);
});
test('não notifica resposta já lida',async()=>{
  mocked({
    'posts/p1':doc({uid:'dono'}),
    'posts/p1/replies/r1':doc({uid:'autor',createdAt:iso()}),
    'users/dono/notifications/r1':doc({actorUid:'autor',postId:'p1',replyId:'r1',read:true}),
  });
  assert.equal(await resolveEvent({type:'reply',postId:'p1',replyId:'r1'},'autor','fake'),null);
});
test('não notifica resposta sem notificação atômica',async()=>{
  mocked({
    'posts/p1':doc({uid:'dono'}),
    'posts/p1/replies/r1':doc({uid:'autor',createdAt:iso()}),
  });
  assert.equal(await resolveEvent({type:'reply',postId:'p1',replyId:'r1'},'autor','fake'),null);
});
test('pedidos avisam somente administradores ativos e que não sejam solicitantes',async()=>{
  mocked({
    'badge_requests/solicitante':doc({kind:'padre',status:'pending',createdAt:iso()}),
    'admins':{documents:[
      {...doc({enabled:true}),name:'projects/test/databases/(default)/documents/admins/admin1'},
      {...doc({enabled:false}),name:'projects/test/databases/(default)/documents/admins/admin2'},
      {...doc({enabled:true}),name:'projects/test/databases/(default)/documents/admins/solicitante'},
    ]},
  });
  const result=await resolveEvent({type:'badge_request'},'solicitante','fake');
  assert.deepEqual(result.recipients,['admin1']);
});
test('sem aprovação prévia, ninguém emite resultado de verificação',async()=>{
  mocked({
    'admins/admin1':doc({enabled:true}),
    'badge_requests/padre1':doc({status:'pending',reviewedBy:'admin1',reviewedAt:iso()}),
  });
  assert.equal(await resolveEvent({type:'badge_result',targetUid:'padre1'},'admin1','fake'),null);
});
test('revisor autorizado pode alertar titular sobre aprovação',async()=>{
  mocked({
    'admins/admin1':doc({enabled:true}),
    'badge_requests/padre1':doc({status:'approved',reviewedBy:'admin1',reviewedAt:iso()}),
  });
  let result=await resolveEvent({type:'badge_result',targetUid:'padre1'},'admin1','fake');
  assert.deepEqual(result.recipients,['padre1']);
  assert.equal(result.kind,'review');
});
test('revisor revogado não pode emitir resultado',async()=>{
  mocked({
    'admins/admin1':doc({enabled:false}),
    'badge_requests/padre1':doc({status:'approved',reviewedBy:'admin1',reviewedAt:iso()}),
  });
  assert.equal(await resolveEvent({type:'badge_result',targetUid:'padre1'},'admin1','fake'),null);
});
test('denúncia avisa administração, excluindo denunciante',async()=>{
  mocked({
    'reports/q1':doc({reporterUid:'alice',createdAt:iso()}),
    'admins':{documents:[
      {...doc({enabled:true}),name:'projects/test/databases/(default)/documents/admins/admin1'},
      {...doc({enabled:true}),name:'projects/test/databases/(default)/documents/admins/alice'},
    ]},
  });
  const result=await resolveEvent({type:'report',reportId:'q1'},'alice','fake');
  assert.deepEqual(result.recipients,['admin1']);
});
test('outra pessoa não pode avisar sobre denúncia alheia',async()=>{
  mocked({'reports/q1':doc({reporterUid:'alice',createdAt:iso()})});
  assert.equal(await resolveEvent({type:'report',reportId:'q1'},'bob','fake'),null);
});
test('bloqueia IDs inválidos antes de consultar dados',async()=>{
  mocked({});
  assert.equal(await resolveEvent({type:'reply',postId:'../admins',replyId:'a'},'alice','fake'),null);
  assert.equal(await resolveEvent({type:'other'},'alice','fake'),null);
});


const configured = {PUSH_ENABLED:'true', PUSH_DB:{}, FIREBASE_WEB_API_KEY:'test', FIREBASE_SERVICE_ACCOUNT_JSON:'{}'};
const req = (body, headers={}) => new Request('https://example.workers.dev/event', {method:'POST',body,headers});
test('emissor desativado nunca acessa Google ou D1',async()=>{
  globalThis.fetch = async()=>{throw Error('Não deveria acessar rede');};
  const result=await worker.fetch(req('{}'),{...configured,PUSH_ENABLED:'false'});
  assert.equal(result.status,503);
  assert.equal((await result.json()).status,'disabled');
});
test('health informa somente estado e não testa envio',async()=>{
  const result=await worker.fetch(new Request('https://example.workers.dev/health'),{});
  assert.deepEqual(await result.json(),{status:'disabled'});
});
test('sem credenciais não tenta enviar',async()=>{
  const result=await worker.fetch(req('{}'),{PUSH_ENABLED:'true'});
  assert.equal((await result.json()).status,'not_configured');
});
test('bloqueia corpo grande mesmo sem content-length',async()=>{
  const result=await worker.fetch(req('x'.repeat(513)),configured);
  assert.equal(result.status,413);
});
test('limite conta bytes UTF-8, não caracteres',async()=>{
  await assert.rejects(()=>readEventBody(req('é'.repeat(257))),RangeError);
});
test('cancela leitura assim que ultrapassa limite',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(513));},cancel(){cancelled=true;}});
  const request=new Request('https://example.workers.dev/event',{method:'POST',body:stream,duplex:'half'});
  await assert.rejects(()=>readEventBody(request),RangeError);
  assert.equal(cancelled,true);
});
test('JSON ou tipo inválido são recusados antes de autenticação remota',async()=>{
  globalThis.fetch=async()=>{throw Error('Não deveria acessar rede');};
  for(const body of ['{','null','[]','{}','{"type":"unknown"}'])
    assert.equal((await worker.fetch(req(body),configured)).status,400);
});
test('token ausente é recusado sem obter credencial administrativa',async()=>{
  assert.equal((await worker.fetch(req('{"type":"reply"}'),configured)).status,401);
});
test('corpo válido é lido corretamente',async()=>{
  assert.deepEqual(await readEventBody(req('{"type":"badge_request"}')),{type:'badge_request'});
});


test('fluxo completo autenticado, deduplicação e falha FCM sem credenciais reais',async()=>{
  // Credenciais RSA efêmeras apenas para o JWT simulado. Nenhuma API real é acessada.
  const pair=await crypto.subtle.generateKey(
    {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
    true,['sign','verify']);
  const pkcs8=await crypto.subtle.exportKey('pkcs8',pair.privateKey);
  const service=JSON.stringify({
    project_id:'atrio-catolico',
    client_email:'test-push@atrio-catolico.iam.gserviceaccount.com',
    private_key:'-----BEGIN PRIVATE KEY-----\n'+Buffer.from(pkcs8).toString('base64')+'\n-----END PRIVATE KEY-----',
  });
  const records=new Set();
  const db={prepare(sql){return {bind(...params){return {async run(){
    if(sql.startsWith('DELETE FROM delivered')) return {meta:{changes:0}};
    if(!sql.startsWith('INSERT OR IGNORE INTO delivered')) throw Error('SQL inesperado');
    if(records.has(params[0])) return {meta:{changes:0}};
    records.add(params[0]);
    return {meta:{changes:1}};
  }};}};}};
  const documents={
    'posts/p1':doc({uid:'dono'}),
    'posts/p1/replies/r1':doc({uid:'autor',createdAt:iso()}),
    'posts/p1/replies/r2':doc({uid:'autor',createdAt:iso()}),
    'users/dono/notifications/r1':doc({
      actorUid:'autor',postId:'p1',replyId:'r1',read:false,
    }),
    'users/dono/notifications/r2':doc({
      actorUid:'autor',postId:'p1',replyId:'r2',read:false,
    }),
    'users/dono/pushDevices':{documents:[doc({token:'token-test-device-1234567890',updatedAt:iso()})]},
  };
  let sent=0;
  let failFCM=false;
  globalThis.fetch=async (input,options={})=>{
    const url=String(input);
    if(url.startsWith('https://identitytoolkit.googleapis.com/')) {
      assert.equal(new URL(url).searchParams.get('key'),'only-identity-toolkit');
      return new Response(JSON.stringify({users:[{localId:'autor',disabled:false}]}),{status:200});
    }
    if(url==='https://oauth2.googleapis.com/token') {
      assert.match(String(options.body),/jwt-bearer/);
      return new Response(JSON.stringify({access_token:'fake-oauth',expires_in:3600}),{status:200});
    }
    if(url.includes('firestore.googleapis.com/')) {
      assert.equal(options.headers.Authorization,'Bearer fake-oauth');
      const u=new URL(url);
      const path=decodeURIComponent(u.pathname).split('/documents/')[1];
      const content=documents[path];
      return content
        ? new Response(JSON.stringify(content),{status:200})
        : new Response('{}',{status:404});
    }
    if(url.includes('fcm.googleapis.com/')) {
      assert.equal(options.headers.Authorization,'Bearer fake-oauth');
      const message=JSON.parse(options.body).message;
      assert.deepEqual(message.data,{uid:'dono',kind:'reply'});
      assert.equal(message.token,'token-test-device-1234567890');
      sent++;
      return new Response('{}',{status:failFCM ? 503 : 200});
    }
    throw Error('Acesso inesperado: '+url);
  };
  const env={
    PUSH_ENABLED:'true',PUSH_DB:db,
    FIREBASE_WEB_API_KEY:'only-identity-toolkit',
    FIREBASE_SERVICE_ACCOUNT_JSON:service,
  };
  const headers={Authorization:'Bearer '+'a'.repeat(120)};
  const emit=(replyId)=>worker.fetch(req(JSON.stringify({type:'reply',postId:'p1',replyId}),headers),env);

  const ok=await emit('r1');
  assert.equal(ok.status,202);
  assert.deepEqual(await ok.json(),{status:'accepted_by_fcm'});
  assert.equal(sent,1);

  const duplicate=await emit('r1');
  assert.equal(duplicate.status,202);
  assert.deepEqual(await duplicate.json(),{status:'no_devices_or_duplicate'});
  assert.equal(sent,1,'evento repetido não pode duplicar o push');

  failFCM=true;
  const failed=await emit('r2');
  assert.equal(failed.status,503);
  assert.deepEqual(await failed.json(),{status:'delivery_failed'});
  assert.equal(sent,2);
});


test('comunicado geral permanece bloqueado mesmo com push individual ativado',async()=>{
  globalThis.fetch=async()=>{throw Error('rede não deveria ser acessada');};
  const response=await worker.fetch(req('{"title":"Aviso do Átrio","body":"Comunicado importante de teste.","requestId":"8c14e77a-3668-4d55-8000-dd5196a55c9b"}'),
    {...configured,BROADCAST_ENABLED:'false'});
  // A requisição acima tem /event; testar o caminho de comunicado.
  const request=new Request('https://example.workers.dev/broadcast',{method:'POST',
    body:JSON.stringify({title:'Aviso do Átrio',body:'Comunicado importante de teste.',
      requestId:'8c14e77a-3668-4d55-8000-dd5196a55c9b'})});
  const blocked=await worker.fetch(request,{...configured,BROADCAST_ENABLED:'false'});
  assert.equal(blocked.status,503);
  assert.deepEqual(await blocked.json(),{status:'broadcast_disabled'});
  assert.equal(response.status,400,'eventos comuns não aceitam corpo de comunicado');
});

test('somente fundador administrador envia a tópico FCM e há limitação de frequência',async()=>{
  const pair=await crypto.subtle.generateKey(
    {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
    true,['sign','verify']);
  const pkcs8=await crypto.subtle.exportKey('pkcs8',pair.privateKey);
  const service=JSON.stringify({
    project_id:'atrio-catolico',
    client_email:'test-push@atrio-catolico.iam.gserviceaccount.com',
    private_key:'-----BEGIN PRIVATE KEY-----\n'+Buffer.from(pkcs8).toString('base64')+'\n-----END PRIVATE KEY-----',
  });
  let actor='intruso';
  let isAdmin=true;
  let isFounder=true;
  let sent=0;
  let locked=false;
  const db={prepare(sql){
    assert.match(sql,/broadcast:cooldown/);
    return {bind(now,cutoff){return {async run(){
      if(locked) return {meta:{changes:0}};
      locked=true;
      return {meta:{changes:1}};
    }};}};
  }};
  globalThis.fetch=async (input,options={})=>{
    const url=String(input);
    if(url.startsWith('https://identitytoolkit.googleapis.com/'))
      return new Response(JSON.stringify({users:[{localId:actor,disabled:false}]}),{status:200});
    if(url==='https://oauth2.googleapis.com/token')
      return new Response(JSON.stringify({access_token:'fake-oauth',expires_in:3600}),{status:200});
    if(url.includes('/documents/admins/'))
      return new Response(JSON.stringify(doc({enabled:isAdmin})),{status:200});
    if(url.endsWith('/documents/app_config/founder'))
      return new Response(JSON.stringify(doc({uid:isFounder?actor:'outro'})),{status:200});
    if(url.includes('fcm.googleapis.com/')) {
      sent++;
      const body=JSON.parse(options.body).message;
      assert.equal(body.topic,'atrio_comunicados_v1');
      assert.equal(body.data.kind,'broadcast');
      assert.equal(body.data.title,'Novidades do Átrio');
      assert.equal(body.data.body,'Confira o nosso comunicado de teste.');
      assert.equal(body.token,undefined);
      return new Response('{}',{status:200});
    }
    throw Error('Unexpected request '+url);
  };
  const env={PUSH_ENABLED:'true',BROADCAST_ENABLED:'true',PUSH_DB:db,
    FIREBASE_WEB_API_KEY:'test',FIREBASE_SERVICE_ACCOUNT_JSON:service};
  const url='https://example.workers.dev/broadcast';
  const payload={title:'Novidades do Átrio',body:'Confira o nosso comunicado de teste.',
    requestId:'8c14e77a-3668-4d55-8000-dd5196a55c9b'};
  const make=()=>new Request(url,{method:'POST',headers:{
    Authorization:'Bearer '+'a'.repeat(120)},body:JSON.stringify(payload)});

  assert.equal((await worker.fetch(make(),env)).status,403);
  assert.equal(sent,0);
  actor='fundador';isAdmin=false;
  assert.equal((await worker.fetch(make(),env)).status,403);
  assert.equal(sent,0);
  isAdmin=true;isFounder=false;
  assert.equal((await worker.fetch(make(),env)).status,403);
  assert.equal(sent,0);
  isFounder=true;
  assert.deepEqual(await (await worker.fetch(make(),env)).json(),{status:'accepted_by_fcm'});
  assert.equal(sent,1);
  assert.equal((await worker.fetch(make(),env)).status,429);
  assert.equal(sent,1);
  assert.equal((await worker.fetch(new Request(url,{method:'POST',body:JSON.stringify(payload)}),env)).status,401);
  assert.equal(sent,1);
});

test('comunicado rejeita título, corpo e identificador inválidos antes de acessar Google',async()=>{
  globalThis.fetch=async()=>{throw Error('Não deveria acessar rede');};
  const env={...configured,BROADCAST_ENABLED:'true'};
  const url='https://example.workers.dev/broadcast';
  const base={title:'Aviso do Átrio',body:'Uma mensagem geral de teste.',
    requestId:'8c14e77a-3668-4d55-8000-dd5196a55c9b'};
  const invalid=[
    {...base,title:'oi'},
    {...base,title:'\nAviso do Átrio'},
    {...base,body:'x'.repeat(181)},
    {...base,requestId:'forjado'},
    {...base,actorUid:'hacker'},
  ];
  for(const data of invalid){
    const result=await worker.fetch(new Request(url,{method:'POST',body:JSON.stringify(data)}),env);
    assert.equal(result.status,400);
  }
});
