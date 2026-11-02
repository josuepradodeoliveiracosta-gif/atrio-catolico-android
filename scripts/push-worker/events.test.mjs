import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, safeTimestamp, notificationRecipient, replyEvent, reviewEvent,
  pendingAdminEvents, eventMarkerId, eligibleDevices, validateRecipient,
} from './events.mjs';

const time = ms => ({toMillis:() => ms});
const ref = (collection, uid='alice') => ({
  parent: {id:collection, parent:{id:uid, parent:{id:'users'}}},
});
const snapshot = (id, fields={}, collection='notifications', uid='alice') => ({
  id, ref:ref(collection,uid), get:key=>fields[key],
});
test('identifica o dono da subcoleção de notificações',()=>{
  assert.equal(notificationRecipient(snapshot('n')), 'alice');
  assert.equal(notificationRecipient(snapshot('n',{},'other')), null);
  assert.equal(notificationRecipient({}), null);
});
test('aceita respostas não lidas e associa a conta, sem revelar corpo',()=>{
  const event=replyEvent(snapshot('r1',{createdAt:time(1234),actorUid:'bob',read:false}));
  assert.equal(event.recipient,'alice');
  assert.equal(event.kind,'reply');
  assert.equal(event.key,'reply:alice:r1');
  assert.equal(JSON.stringify(event).includes('conteúdo privado'),false);
});
test('ignora resposta já lida e aviso da própria conta',()=>{
  assert.equal(replyEvent(snapshot('r1',{createdAt:time(1234),actorUid:'bob',read:true})),null);
  assert.equal(replyEvent(snapshot('r1',{createdAt:time(1234),actorUid:'alice',read:false})),null);
  assert.equal(replyEvent(snapshot('r1',{actorUid:'bob',read:false})),null);
});
test('gera resultado somente após revisão de selo válida',()=>{
  let accepted=reviewEvent(snapshot('alice',{
    kind:'padre',status:'approved',reviewedAt:time(3333)
  }));
  assert.equal(accepted.kind,'review');
  assert.equal(accepted.recipient,'alice');
  assert.ok(accepted.key.includes('3333'));
  assert.equal(reviewEvent(snapshot('alice',{
    kind:'padre',status:'pending',reviewedAt:time(3333)
  })),null);
  assert.equal(reviewEvent(snapshot('alice',{
    kind:'moderador',status:'approved',reviewedAt:time(3333)
  })),null);
});
test('não notifica administrador sobre pedido próprio',()=>{
  const event=pendingAdminEvents(snapshot('adminA',{
    status:'pending',createdAt:time(5000)
  }), 'request', ['adminA','adminB']);
  assert.deepEqual(event.map(x=>x.recipient),['adminB']);
});
test('rejeita pedidos encerrados e denúncias analisadas',()=>{
  assert.deepEqual(pendingAdminEvents(snapshot('q',{
    status:'approved',createdAt:time(5000)
  }), 'request', ['adminB']),[]);
  assert.deepEqual(pendingAdminEvents(snapshot('q',{
    status:'removed',createdAt:time(5000)
  }), 'report', ['adminB']),[]);
});
test('denúncias legadas sem status continuam pendentes',()=>{
  const found=pendingAdminEvents(snapshot('q',{
    reporterUid:'bob',createdAt:time(5000)
  }), 'report', ['adminA','bob']);
  assert.deepEqual(found.map(x=>x.recipient), ['adminA']);
});
test('marcador idempotente tem tamanho fixo, sem dados expostos',()=>{
  let event={key:'review:alice:3333'};
  let id=eventMarkerId(event);
  assert.equal(id.length,64);
  assert.equal(id,eventMarkerId(event));
  assert.notEqual(id,eventMarkerId({key:'review:alice:4444'}));
  assert.equal(id.includes('alice'),false);
});
test('aceita somente tokens recentes e distintos',()=>{
  const now=100*86400000;
  let devices=[
    snapshot('a',{token:'token_valido_aparelho12345',updatedAt:time(now-1000)}),
    snapshot('b',{token:'token_valido_aparelho12345',updatedAt:time(now-2000)}),
    snapshot('c',{token:'token_expirado_aparelho33',updatedAt:time(now-61*86400000)}),
    snapshot('d',{token:'muito-curto',updatedAt:time(now-1000)}),
  ];
  assert.deepEqual(eligibleDevices(devices,now),['token_valido_aparelho12345']);
});
test('filtra uid inválido',()=>{
  assert.equal(validateRecipient('alice'),true);
  assert.equal(validateRecipient(''),false);
  assert.equal(validateRecipient('alice/other'),false);
  assert.equal(validateRecipient('x'.repeat(129)),false);
});
test('limites têm valores seguros por padrão',()=>{
  assert.ok(LIMITS.maxEvents<=200);
  assert.ok(LIMITS.maxTokensPerMember<=10);
  assert.ok(LIMITS.lookbackHours<=24);
  assert.ok(LIMITS.maxAttempts<=3);
});
test('timestamps inválidos não viram eventos',()=>{
  assert.equal(safeTimestamp(null),0);
  assert.equal(safeTimestamp({toMillis:()=>Infinity}),0);
  assert.equal(safeTimestamp(time(1234)),1234);
});
