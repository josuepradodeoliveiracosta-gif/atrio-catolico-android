import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {resolveEvent} from './index.js';

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
