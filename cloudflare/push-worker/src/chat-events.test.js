import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {resolveEvent} from './index.js';

const now = () => new Date(Date.now()-1500).toISOString();
const field = (name,value) => {
  if (typeof value === 'boolean') return {booleanValue:value};
  if (name.endsWith('At')) return {timestampValue:value};
  return {stringValue:value};
};
const doc = obj => ({fields:Object.fromEntries(
  Object.entries(obj).map(([key,val])=>[key,field(key,val)]))});
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
function mocked(extra={}) {
  const entries={
    'app_config/conversations':doc({enabled:true,version:'2026-11-v1'}),
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
