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
