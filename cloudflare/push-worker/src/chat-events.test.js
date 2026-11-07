import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {resolveEvent} from './index.js';

const now = () => new Date(Date.now()-1500).toISOString();
const validReview = () => new Date(Date.now()+86_400_000).toISOString();
const field = (name,value) => {
  if (typeof value === 'boolean') return {booleanValue:value};
  if (Array.isArray(value)) return {arrayValue:{values:value.map(v=>({stringValue:v}))}};
  if (name.endsWith('At')) return {timestampValue:value};
  return {stringValue:value};
};
const doc = obj => ({fields:Object.fromEntries(
  Object.entries(obj).map(([key,val])=>[key,field(key,val)]))});
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
function mocked(extra={}) {
  const entries={
    'app_config/conversations':doc({
      enabled:true,version:'2026-11-v1',
      minorPolicyApproved:true,safetyReviewVersion:'2026-11-safety-v1'
    }),
    'chats/chat-alice__chat-bob':doc({
      requesterUid:'chat-alice',recipientUid:'chat-bob',status:'accepted',initialId:'m1'
    }),
    'chats/chat-alice__chat-bob/messages/m2':doc({
      uid:'chat-alice',kind:'text',text:'Paz e bem!',createdAt:now()
    }),
    ...extra
  };
  globalThis.fetch=async input=>{
    const url=new URL(input);
    const name=decodeURIComponent(url.pathname.split('/documents/').slice(1).join('/documents/'));
    return entries[name]?
      new Response(JSON.stringify(entries[name]),{status:200}):
      new Response('{}',{status:404});
  };
}
test('Chat: remetente autenticado gera um aviso ao destinatário, sem texto no payload',async()=>{
  mocked();
  const event=await resolveEvent({
    type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'
  },'chat-alice','fake');
  assert.deepEqual(event.recipients,['chat-bob']);
  assert.equal(event.kind,'chat_message');
  assert.equal(event.messageId,'m2');
  assert.equal(event.text,undefined);
});
test('Chat: terceiro não gera push em nome de outro',async()=>{
  mocked();
  assert.equal(await resolveEvent({
    type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'
  },'chat-stranger','fake'),null);
});
test('Chat: destinatário que silenciou não recebe push',async()=>{
  mocked({'users/chat-bob/chatBox/chat-alice__chat-bob':doc({muted:true})});
  assert.equal(await resolveEvent({
    type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'
  },'chat-alice','fake'),null);
});
test('Chat: bloqueio unilateral impede o aviso',async()=>{
  mocked({'users/chat-bob/blockedMembers/chat-alice':doc({createdAt:now()})});
  assert.equal(await resolveEvent({
    type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'
  },'chat-alice','fake'),null);
});
test('Chat: não avisa em status recusado',async()=>{
  mocked({'chats/chat-alice__chat-bob':doc({
    requesterUid:'chat-alice',recipientUid:'chat-bob',status:'declined',initialId:'m1'
  })});
  assert.equal(await resolveEvent({
    type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'
  },'chat-alice','fake'),null);
});
test('Chat: primeiro pedido só notifica quando destinatário permite',async()=>{
  const pending=doc({
    requesterUid:'chat-alice',recipientUid:'chat-bob',status:'pending',initialId:'m2'
  });
  mocked({'chats/chat-alice__chat-bob':pending});
  assert.equal(await resolveEvent({
    type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'
  },'chat-alice','fake'),null);
  mocked({'chats/chat-alice__chat-bob':pending,
    'users/chat-bob/chatSettings/privacy':doc({requests:'all'})});
  assert.deepEqual((await resolveEvent({
    type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'
  },'chat-alice','fake')).recipients,['chat-bob']);
});
test('Chat: serviço desligado não notifica ninguém',async()=>{
  mocked({'app_config/conversations':doc({enabled:false,version:'2026-11-v1'})});
  assert.equal(await resolveEvent({
    type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'
  },'chat-alice','fake'),null);
});

test('Chat: ativação sem aprovação etária não envia push',async()=>{
  mocked({'app_config/conversations':doc({
    enabled:true,version:'2026-11-v1',safetyReviewVersion:'2026-11-safety-v1'
  })});
  assert.equal(await resolveEvent({
    type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'
  },'chat-alice','fake'),null);
});
test('Chat: aprovação sem versão de revisão não envia push',async()=>{
  mocked({'app_config/conversations':doc({
    enabled:true,version:'2026-11-v1',minorPolicyApproved:true
  })});
  assert.equal(await resolveEvent({
    type:'chat_message',chatId:'chat-alice__chat-bob',messageId:'m2'
  },'chat-alice','fake'),null);
});
const groupEvent = {type:'group_message',groupId:'grp-qa',messageId:'m3'};
const groupFixture={
  'app_config/chat_groups':doc({enabled:true,pushEnabled:true,minorPolicyApproved:true,version:'2026-11-groups-v1'}),
  'chat_groups/grp-qa':doc({status:'active',memberUids:['chat-alice','chat-bob','chat-charlie']}),
  'chat_groups/grp-qa/messages/m3':doc({uid:'chat-alice',kind:'text',text:'Mensagem privada',createdAt:now()}),
  'users/chat-alice/chatGroupAccess/eligibility':
    doc({status:'approved',policyVersion:'2026-11-group-safety-v1',
      reviewExpiresAt:validReview()}),
  'users/chat-bob/chatGroupAccess/eligibility':
    doc({status:'approved',policyVersion:'2026-11-group-safety-v1',
      reviewExpiresAt:validReview()}),
  'users/chat-charlie/chatGroupAccess/eligibility':
    doc({status:'approved',policyVersion:'2026-11-group-safety-v1',
      reviewExpiresAt:validReview()})
};
test('Grupo: destinatários participantes autorizados, nunca corpo da mensagem',async()=>{
  mocked(groupFixture);
  const event=await resolveEvent(groupEvent,'chat-alice','fake');
  assert.deepEqual(event.recipients,['chat-bob','chat-charlie']);
  assert.equal(event.kind,'group_message');
  assert.equal(event.groupId,'grp-qa');
  assert.equal(event.messageId,'m3');
  assert.equal(event.text,undefined);
});
test('Grupo: terceiros não disparam aviso nem recebem mensagens',async()=>{
  mocked(groupFixture);
  assert.equal(await resolveEvent(groupEvent,'chat-stranger','fake'),null);
});
test('Grupo: filtro de silêncio e suspensão individual',async()=>{
  mocked({...groupFixture,
    'users/chat-bob/chatGroupBox/grp-qa':doc({muted:true}),
    'users/chat-charlie/chatGroupAccess/eligibility':
      doc({status:'suspended',policyVersion:'2026-11-group-safety-v1'})
  });
  assert.deepEqual((await resolveEvent(groupEvent,'chat-alice','fake')).recipients,[]);
});
test('Grupo: bloqueio de qualquer lado remove o destinatário',async()=>{
  mocked({...groupFixture,
    'users/chat-bob/blockedMembers/chat-alice':doc({createdAt:now()}),
    'users/chat-alice/blockedMembers/chat-charlie':doc({createdAt:now()})
  });
  assert.deepEqual((await resolveEvent(groupEvent,'chat-alice','fake')).recipients,[]);
});
test('Grupo: controle global desativado impede envio',async()=>{
  mocked({...groupFixture,
    'app_config/chat_groups':doc({enabled:false,minorPolicyApproved:true,version:'2026-11-groups-v1'})
  });
  assert.equal(await resolveEvent(groupEvent,'chat-alice','fake'),null);
});
test('Grupo: política para menores não aprovada impede envio',async()=>{
  mocked({...groupFixture,
    'app_config/chat_groups':doc({enabled:true,minorPolicyApproved:false,version:'2026-11-groups-v1'})
  });
  assert.equal(await resolveEvent(groupEvent,'chat-alice','fake'),null);
});
test('Grupo: sem chat individual habilitado, nenhum grupo notifica',async()=>{
  mocked({...groupFixture,
    'app_config/conversations':doc({enabled:false,version:'2026-11-v1'})
  });
  assert.equal(await resolveEvent(groupEvent,'chat-alice','fake'),null);
});
test('Grupo: membro já removido não recebe notificação antiga',async()=>{
  mocked({...groupFixture,
    'chat_groups/grp-qa':doc({status:'active',memberUids:['chat-alice','chat-bob']})
  });
  assert.deepEqual((await resolveEvent(groupEvent,'chat-alice','fake')).recipients,['chat-bob']);
});
test('Grupo: autor/espécie/frescor inválidos são recusados',async()=>{
  mocked({...groupFixture,
    'chat_groups/grp-qa/messages/m3':
      doc({uid:'chat-stranger',kind:'image',text:'Oculto',createdAt:now()})
  });
  assert.equal(await resolveEvent(groupEvent,'chat-alice','fake'),null);
  mocked({...groupFixture,
    'chat_groups/grp-qa/messages/m3':
      doc({uid:'chat-alice',kind:'text',createdAt:new Date(Date.now()-7*60_000).toISOString()})
  });
  assert.equal(await resolveEvent(groupEvent,'chat-alice','fake'),null);
});
test('Grupo: membros duplicados, acima do limite ou dados inválidos não recebem push',async()=>{
  for(const members of [
    ['chat-alice','chat-bob','chat-bob'],
    ['chat-alice','chat-bob','a','b','c','d','e','f','g'],
    ['chat-alice','unsafe uid']
  ]) {
    mocked({...groupFixture,'chat_groups/grp-qa':doc({status:'active',memberUids:members})});
    assert.equal(await resolveEvent(groupEvent,'chat-alice','fake'),null);
  }
});

test('Grupo: não notifica quando o próprio autor foi suspenso depois do envio',async()=>{
  mocked({...groupFixture,
    'users/chat-alice/chatGroupAccess/eligibility':
      doc({status:'suspended',policyVersion:'2026-11-group-safety-v1'})
  });
  assert.equal(await resolveEvent(groupEvent,'chat-alice','fake'),null);
});

test('Grupo: push exige ativação explícita, separada da criação dos grupos',async()=>{
  mocked({...groupFixture,
    'app_config/chat_groups':doc({
      enabled:true,pushEnabled:false,minorPolicyApproved:true,version:'2026-11-groups-v1'
    })
  });
  assert.equal(await resolveEvent(groupEvent,'chat-alice','fake'),null);
  mocked({...groupFixture,
    'app_config/chat_groups':doc({
      enabled:true,minorPolicyApproved:true,version:'2026-11-groups-v1'
    })
  });
  assert.equal(await resolveEvent(groupEvent,'chat-alice','fake'),null);
});

test('Grupo: revisão vencida do destinatário suspende avisos',async()=>{
  mocked({...groupFixture,
    'users/chat-bob/chatGroupAccess/eligibility':doc({
      status:'approved',policyVersion:'2026-11-group-safety-v1',
      reviewExpiresAt:new Date(Date.now()-60_000).toISOString()
    })
  });
  assert.deepEqual((await resolveEvent(groupEvent,'chat-alice','fake')).recipients,
    ['chat-charlie']);
});
test('Grupo: revisão vencida do remetente cancela todo evento',async()=>{
  mocked({...groupFixture,
    'users/chat-alice/chatGroupAccess/eligibility':doc({
      status:'approved',policyVersion:'2026-11-group-safety-v1',
      reviewExpiresAt:new Date(Date.now()-60_000).toISOString()
    })
  });
  assert.equal(await resolveEvent(groupEvent,'chat-alice','fake'),null);
});
test('Grupo: ausência de revisão válida não autoriza aviso',async()=>{
  mocked({...groupFixture,
    'users/chat-bob/chatGroupAccess/eligibility':
      doc({status:'approved',policyVersion:'2026-11-group-safety-v1'})
  });
  assert.deepEqual((await resolveEvent(groupEvent,'chat-alice','fake')).recipients,
    ['chat-charlie']);
});
