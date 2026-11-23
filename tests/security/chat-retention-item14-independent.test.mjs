// Chat 5: prova independente da persistência do item 14 no Firestore Emulator.
// Não altera o executor de QA; usa casos/IDs próprios, dados sintéticos e leitura
// administrativa direta apenas do emulador local.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {FieldPath, FieldValue, Firestore} from '@google-cloud/firestore';
import {createItem14Qa, DAY} from '../../firebase/qa-general/chat-retention-item14.mjs';

const HOST = '127.0.0.1:8089';
const PROJECT = 'demo-atrio-v11';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, HOST, 'Somente Firestore Emulator local');
const T0 = Date.parse('2030-01-01T12:00:00.000Z');
const ids = {
  clara: 'qa-clara', miguel: 'qa-miguel', lucia: 'qa-lucia',
  mod: 'qa-moderador', outsider: 'qa-terceiro', dm: 'qa-dm', group: 'qa-grupo',
  job: 'qa-operacao-clara', report: 'qa-denuncia-minima',
};
const session = uid => 'fixture-' + uid;
const expectedReport = {protocol: 'PROTOCOLO-QA-14', excerpt: 'Trecho mínimo sintético'};
const seed = () => {
  const all = [ids.clara,ids.miguel,ids.lucia,ids.mod,ids.outsider];
  return {
    accounts: Object.fromEntries(all.map(uid => [uid, {
      active: true, approved18: true, preferences: {inbox:'contacts'},
    }])),
    sessions: Object.fromEntries(all.map(uid => [session(uid),uid])),
    chats: {
      [ids.dm]: {kind:'direct', members:[ids.clara,ids.miguel]},
      [ids.group]: {kind:'group',members:[ids.clara,ids.miguel]},
    },
    messages: {}, derived: {}, indexes: {}, invites: {}, notices: {}, blocks: {},
  };
};
function message(data, id, chatId, author, sentAt) {
  data.messages[id] = {chatId, author, sentAt, text:'conteúdo QA de '+id};
  data.indexes[chatId] = true;
}
function report() {
  return {
    [ids.report]: {...expectedReport, status:'open', subjectUid:ids.clara, reviewers:[ids.mod]},
  };
}
function assertUnlinked(data) {
  for (const chat of [ids.dm,ids.group]) {
    assert.deepEqual(data.chats[chat].members, [ids.miguel], chat+' membro excluído persistiu');
    assert.equal(data.chats[chat].members.includes(ids.clara),false);
  }
}
async function probe(t) {
  const caseId = 'qa-chat5-14-'+randomUUID();
  let clock = T0;
  const api = () => createItem14Qa({Firestore,caseId,clock:()=>clock});
  let executor = api();
  const admin = new Firestore({projectId:PROJECT, host:HOST, ssl:false});
  const refs = {
    data:admin.collection('qa_item14_data').doc(caseId),
    control:admin.collection('qa_item14_control').doc(caseId),
    copies:admin.collection('qa_item14_copies').doc(caseId),
  };
  t.after(async () => {await executor.dispose(); await admin.terminate();});
  const advance = (days,offset=0) => {clock=T0+days*DAY+offset;};
  const restart = async () => {
    await executor.dispose();
    executor=api();
    return executor;
  };
  const persisted = async () => {
    const [d,c] = await Promise.all([refs.data.get(),refs.control.get()]);
    assert.equal(d.exists,true);assert.equal(c.exists,true);
    return {data:d.data(), control:c.data()};
  };
  return {get executor(){return executor;},refs,caseId,admin,advance,restart,persisted};
}

test('14.5 independente: vínculos e subcoleções removidos; contraparte e prova mínima preservadas',async t=>{
  const h=await probe(t);
  const data=seed();
  message(data,'qa-clara-dm',ids.dm,ids.clara,T0);
  message(data,'qa-clara-grupo',ids.group,ids.clara,T0);
  message(data,'qa-miguel-dm',ids.dm,ids.miguel,T0);
  message(data,'qa-miguel-grupo',ids.group,ids.miguel,T0);
  data.derived['qa-quote-excluida']={
    kind:'quote',sourceId:'qa-clara-dm',parentId:'qa-miguel-dm',
    chatId:ids.dm,text:'citação fictícia',
  };
  data.derived['qa-previa-miguel']={
    kind:'preview',sourceId:'qa-miguel-dm',chatId:ids.dm,text:'prévia fictícia',
  };
  await h.executor.createFixture(data,{
    reports:report(),moderators:{[ids.mod]:true,[ids.outsider]:false},
  });
  const before=(await h.persisted()).data;
  assert.deepEqual(before.chats[ids.dm].members,[ids.clara,ids.miguel]);
  assert.deepEqual(before.chats[ids.group].members,[ids.clara,ids.miguel]);
  h.advance(1);
  const first=await h.executor.confirmDeletion(session(ids.clara),ids.job);
  assert.equal(first.phase,'messages');
  assert.equal(first.dueAt,T0+31*DAY);
  let state=await h.persisted();
  assertUnlinked(state.data); // direto nos documentos persistidos, antes da limpeza
  assert.ok(state.control.deleted[ids.clara]);
  assert.equal(await h.executor.read(session(ids.clara),'account'),null);
  assert.equal(await h.executor.send(session(ids.clara),ids.dm,'qa-excluida-envio','recusar'),false);
  assert.equal(await h.executor.send(session(ids.miguel),ids.dm,'qa-dm-sem-par','recusar'),false);
  assert.deepEqual(await h.executor.confirmDeletion(session(ids.clara),ids.job),first);
  const intermediate=await h.executor.stepDeletion(ids.job);
  assert.equal(intermediate.phase,'derived');
  assert.equal((await h.refs.data.collection('messages').doc('qa-clara-dm').get()).exists,false);
  assert.equal((await h.refs.data.collection('derived').doc('qa-quote-excluida').get()).exists,true);
  await h.restart();
  state=await h.persisted();
  assert.deepEqual(state.control.jobs[ids.job],intermediate);
  assertUnlinked(state.data);
  h.advance(31);
  const finished=await h.executor.stepDeletion(ids.job);
  assert.equal(finished.phase,'done');
  assert.equal(finished.withinTarget,true);
  assert.equal(finished.completedAt,T0+31*DAY);
  state=await h.persisted();
  assertUnlinked(state.data);
  assert.equal(state.data.accounts[ids.clara],undefined);
  assert.equal(state.data.sessions[session(ids.clara)],undefined);
  assert.deepEqual(await h.executor.stepDeletion(ids.job),finished);
  for(const chat of [ids.dm,ids.group]){
    const res=await h.executor.read(session(ids.miguel),'chat',chat);
    assert.ok(res,'contraparte perdeu acesso à '+chat);
    const expected=chat===ids.dm?'qa-miguel-dm':'qa-miguel-grupo';
    assert.deepEqual(Object.keys(res.messages),[expected]);
    assert.equal((await h.refs.data.collection('messages').doc(expected).get()).exists,true);
  }
  assert.equal((await h.refs.data.collection('derived').doc('qa-quote-excluida').get()).exists,false);
  assert.equal((await h.refs.data.collection('derived').doc('qa-previa-miguel').get()).exists,true);
  assert.deepEqual(await h.executor.read(session(ids.mod),'report',ids.report),expectedReport);
  assert.equal(await h.executor.read(session(ids.mod),'chat',ids.dm),null);
  assert.equal(await h.executor.read(session(ids.mod),'chat',ids.group),null);
  assert.equal(await h.executor.read(session(ids.outsider),'report',ids.report),null);
  assert.equal(await h.executor.read(session(ids.lucia),'report',ids.report),null);
  assert.equal(await h.executor.read(session(ids.clara),'chat',ids.dm),null);
});

test('14.6 independente: cópia legada sem conta não reativa DM/grupo nem denúncia inteira',async t=>{
  const h=await probe(t);
  const data=seed();
  const sentAt=T0+60*DAY;
  message(data,'qa-preservar-dm',ids.dm,ids.miguel,sentAt);
  message(data,'qa-preservar-grupo',ids.group,ids.miguel,sentAt);
  message(data,'qa-descartar-dm',ids.dm,ids.clara,sentAt);
  message(data,'qa-descartar-grupo',ids.group,ids.clara,sentAt);
  data.derived['qa-previa-descartada']={
    kind:'preview',sourceId:'qa-descartar-dm',chatId:ids.dm,text:'prévia descartada',
  };
  await h.executor.createFixture(data,{
    reports:report(),moderators:{[ids.mod]:true,[ids.outsider]:false},
  });
  h.advance(80);
  assert.equal(await h.executor.takeCopy('qa-backup-legado','backup'),true);
  // Simula formato legado: membros persistidos, porém sem documento de conta.
  await h.refs.copies.update(
    new FieldPath('qa-backup-legado','data','accounts',ids.clara),FieldValue.delete(),
  );
  const copy=(await h.refs.copies.get()).data()['qa-backup-legado'].data;
  assert.equal(copy.accounts[ids.clara],undefined);
  assert.ok(copy.chats[ids.dm].members.includes(ids.clara));
  assert.ok(copy.chats[ids.group].members.includes(ids.clara));
  h.advance(82);
  const operation=await h.executor.confirmDeletion(session(ids.clara),ids.job);
  assert.equal(operation.phase,'messages');
  assertUnlinked((await h.persisted()).data);
  await h.executor.stepDeletion(ids.job);
  await h.executor.stepDeletion(ids.job);
  assertUnlinked((await h.persisted()).data);
  h.advance(90);
  assert.equal(await h.executor.startRestore('qa-backup-legado'),true);
  assertUnlinked((await h.persisted()).data); // antes de liberar a restauração
  assert.equal(await h.executor.read(session(ids.miguel),'chat',ids.dm),null);
  assert.equal(await h.executor.read(session(ids.mod),'report',ids.report),null);
  await assert.rejects(
    h.executor.send(session(ids.miguel),ids.group,'qa-durante-restore','recusar'),
    /item14_restore_in_progress/,
  );
  await h.restart(); // nova sessão de processo, estado persiste no Emulator
  assertUnlinked((await h.persisted()).data);
  assert.equal(await h.executor.finishRestore(),true);
  assertUnlinked((await h.persisted()).data);
  for(const [chat,expected] of [[ids.dm,'qa-preservar-dm'],[ids.group,'qa-preservar-grupo']]){
    const res=await h.executor.read(session(ids.miguel),'chat',chat);
    assert.deepEqual(Object.keys(res.messages),[expected]);
    assert.equal((await h.refs.data.collection('messages').doc(expected).get()).exists,true);
  }
  assert.equal((await h.refs.data.collection('messages').doc('qa-descartar-dm').get()).exists,false);
  assert.equal((await h.refs.data.collection('messages').doc('qa-descartar-grupo').get()).exists,false);
  assert.equal((await h.refs.data.collection('derived').doc('qa-previa-descartada').get()).exists,false);
  assert.equal(await h.executor.read(session(ids.clara),'account'),null);
  assert.equal(await h.executor.read(session(ids.clara),'chat',ids.group),null);
  assert.deepEqual(await h.executor.read(session(ids.mod),'report',ids.report),expectedReport);
  assert.equal(await h.executor.read(session(ids.mod),'chat',ids.dm),null);
  assert.equal(await h.executor.read(session(ids.outsider),'report',ids.report),null);
  h.advance(110,-1);
  await h.executor.sweep();
  assert.ok((await h.refs.copies.get()).data()['qa-backup-legado']);
  h.advance(110);
  await h.executor.sweep();
  assert.equal((await h.refs.copies.get()).data()['qa-backup-legado'],undefined);
  assert.equal(await h.executor.startRestore('qa-backup-legado'),false);
  h.advance(110,1);
  await h.executor.sweep();
  assertUnlinked((await h.persisted()).data);
  // Mesmo após o término da supressão, uma ligação legada é corrigida pelo sweep.
  await h.refs.data.update(
    new FieldPath('chats',ids.dm,'members'),[ids.clara,ids.miguel],
    new FieldPath('chats',ids.group,'members'),[ids.clara,ids.miguel],
  );
  await h.executor.sweep();
  assertUnlinked((await h.persisted()).data);
  assert.deepEqual(Object.keys((await h.executor.read(session(ids.miguel),'chat',ids.dm)).messages),['qa-preservar-dm']);
  assert.deepEqual(await h.executor.read(session(ids.mod),'report',ids.report),expectedReport);
});
