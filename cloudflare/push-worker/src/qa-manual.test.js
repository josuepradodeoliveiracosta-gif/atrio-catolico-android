import test from 'node:test';
import assert from 'node:assert/strict';
import {QA_BOTS,planQaSession,validQaCommand,executeQaCommand} from './qa-manual.js';

test('os três bots são transparentes, independentes e sem privilégios',()=>{
  assert.deepEqual(QA_BOTS.map(x=>x.uid),[
    'qa_clara_v19','qa_miguel_v19','qa_lucia_v19']);
  assert.equal(new Set(QA_BOTS.map(x=>x.uid)).size,3);
  for(const bot of QA_BOTS)assert.match(bot.name,/\\(BOT DE TESTE\\)/);
});
test('uma solicitação cria no máximo 1 discussão, 2 respostas e 2 avisos internos',()=>{
  const plan=planQaSession('solicitacao001',new Date('2026-10-26T20:00:00Z'));
  assert.equal(plan.writes.length,6);
  assert.equal(plan.writes.filter(x=>x.update.name.includes('/replies/')).length,2);
  assert.equal(plan.writes.filter(x=>x.update.name.includes('/notifications/')).length,2);
  assert.equal(plan.writes.filter(x=>x.update.name.includes('/posts/')&&!x.update.name.includes('/replies/')).length,1);
  assert.equal(new Set(plan.writes.map(x=>x.update.name)).size,6);
  assert.ok(plan.writes.every(x=>x.currentDocument?.exists===false));
  assert.ok(plan.writes.every(x=>JSON.stringify(x).includes('BOT DE TESTE')||x.update.name.includes('/qa_bot_runs/')));
  assert.ok(!JSON.stringify(plan).includes('admins/'));
});
test('respostas e notificações usam IDs únicos por sessão e compatíveis com regras',()=>{
  const a=planQaSession('sessao_primeira_01');
  const b=planQaSession('sessao_segunda_02');
  assert.notEqual(a.replyIds.miguel,b.replyIds.miguel);
  assert.notEqual(a.replyIds.lucia,b.replyIds.lucia);
  for(const plan of [a,b]) {
    const replyIds=plan.writes.filter(x=>x.update.name.includes('/replies/'))
      .map(x=>x.update.name.split('/').pop()).sort();
    const noticeIds=plan.writes.filter(x=>x.update.name.includes('/notifications/'))
      .map(x=>x.update.name.split('/').pop()).sort();
    assert.deepEqual(replyIds,noticeIds,
      'as regras Firestore exigem notificationId igual a replyId');
    assert.ok(plan.writes.every(x=>x.currentDocument?.exists===false));
  }
});
test('comando só é aceito por solicitação fresca, fechada e sem campos extras',()=>{
  const now=Date.parse('2026-10-26T20:00:00.000Z');
  const good={kind:'manual_chat_qa_v1',requestId:'mensagem-001',createdAt:new Date(now).toISOString()};
  assert.equal(validQaCommand(good,now),true);
  for(const invalid of [
    {...good,extra:'bad'}, {...good,kind:'cron'}, {...good,requestId:'../admin'},
    {...good,createdAt:'2020-10-26T20:00:00Z'},
    {...good,createdAt:new Date(now+3600000).toISOString()},
    {kind:'manual_chat_qa_v1'},null,[],
  ])assert.equal(Boolean(validQaCommand(invalid,now)),false);
});
test('flag desligada rejeita antes de consultar Firestore',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('Nenhuma chamada de rede permitida');};
  try{
    const command={kind:'manual_chat_qa_v1',requestId:'mensagem-002',
      createdAt:new Date().toISOString()};
    assert.equal(await executeQaCommand(command,{QA_MANUAL_ENABLED:'false'},'token'),'disabled');
    assert.equal(await executeQaCommand({...command,extra:'x'},{
      QA_MANUAL_ENABLED:'true'},'token'),'invalid_command');
  }finally{globalThis.fetch=original;}
});
test('reenvio do mesmo comando não grava conteúdo duplicado',async()=>{
  const original=globalThis.fetch;
  let commits=0;
  globalThis.fetch=async (url)=>{
    if(String(url).includes('/qa_bot_runs/repeticao001'))
      return Response.json({fields:{status:{stringValue:'created'}}});
    commits++;
    throw Error('Não deveria gravar');
  };
  try{
    const now=new Date();
    assert.equal(await executeQaCommand({
      kind:'manual_chat_qa_v1',requestId:'repeticao001',
      createdAt:now.toISOString(),
    },{QA_MANUAL_ENABLED:'true'},'oauth',now),'already_completed');
    assert.equal(commits,0);
  }finally{globalThis.fetch=original;}
});
