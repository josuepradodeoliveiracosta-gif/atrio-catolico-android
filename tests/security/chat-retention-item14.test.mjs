import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {FieldPath, FieldValue, Firestore} from '@google-cloud/firestore';
import {assertFails, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc, getDoc} from 'firebase/firestore';
import {createItem14Qa, DAY} from '../../firebase/qa-general/chat-retention-item14.mjs';

const T0 = Date.parse('2030-01-01T12:00:00.000Z');
const clara = 'qa-clara';
const miguel = 'qa-miguel';
const lucia = 'qa-lucia';
const assigned = 'qa-moderador';
const outside = 'qa-fora-do-caso';
const revokedMod = 'qa-moderador-revogado';
const direct = 'qa-dm';
const group = 'qa-grupo';
const operation = 'qa-exclusao-clara';
const session = uid => 'fixture-' + uid;
const step = process.env.ATRIO_RETENTION_CASE;
assert.ok(!step || /^14\.[1-6]$/.test(step), 'Informe ATRIO_RETENTION_CASE=14.1 até 14.6');

function fixture() {
  const actors = [clara, miguel, lucia, assigned, outside, revokedMod];
  return {
    accounts: Object.fromEntries(actors.map(uid => [uid, {
      active: true, approved18: true, preferences: {inbox: 'contacts'},
    }])),
    sessions: Object.fromEntries(actors.map(uid => [session(uid), uid])),
    chats: {
      [direct]: {kind: 'direct', members: [clara, miguel]},
      [group]: {kind: 'group', members: [clara, miguel]},
    },
    messages: {}, derived: {}, indexes: {}, invites: {}, notices: {}, blocks: {},
  };
}

function seedMessage(data, id, chatId, author, sentAt = T0) {
  data.messages[id] = {chatId, author, sentAt, text: 'Mensagem fictícia ' + id};
  data.indexes[chatId] = true;
}

function seedCopy(data, id, sourceId, {kind = 'preview', parentId} = {}) {
  const source = data.messages[sourceId];
  data.derived[id] = {kind, sourceId, chatId: source.chatId, text: source.text};
  if (parentId) data.derived[id].parentId = parentId;
}

const invite = (at = T0) => ({status: 'pending', createdAt: at, chatId: group, sender: clara, recipient: miguel});
const report = (status, details = {}) => ({
  status, protocol: 'Protocolo fictício', excerpt: 'Trecho mínimo de Clara',
  subjectUid: clara, reviewers: [assigned, revokedMod], ...details,
});
const moderators = {[assigned]: true, [outside]: true, [revokedMod]: false};
function assertClaraUnlinked({data}) {
  assert.deepEqual(data.chats[direct].members, [miguel], 'vínculo ativo na DM');
  assert.deepEqual(data.chats[group].members, [miguel], 'vínculo ativo no grupo');
}

function assertMinimumEvidence(value) {
  assert.deepEqual(value, {protocol:'Protocolo fictício',excerpt:'Trecho mínimo de Clara'});
}

async function updateLegacyFixture(caseId, collection, ...updates) {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8089');
  const db = new Firestore({projectId:'demo-atrio-v11',host:'127.0.0.1:8089',ssl:false});
  try {
    await db.collection(collection).doc(caseId).update(...updates);
  } finally { await db.terminate(); }
}

const qa = (number, title, run) => {
  if (step && step !== number) return;
  test(number + ' ' + title, async t => {
    let now = T0;
    const caseId = 'qa-item14-' + randomUUID();
    const open = () => createItem14Qa({Firestore, caseId, clock: () => now});
    let current = open();
    t.after(() => current.dispose());
    const restart = async () => {
      await current.dispose();
      current = open();
      return current;
    };
    await run({service: current, restart, caseId, at: (days, offset = 0) => { now = T0 + days * DAY + offset; }});
  });
};

qa('14.1', 'vencimento da DM, edição e descarte de prévia, citação e índice', async ({service, at}) => {
  const data = fixture();
  data.chats['qa-dm-somente-vencida'] = {kind: 'direct', members: [clara, miguel]};
  seedMessage(data, 'qa-antiga', direct, clara);
  seedMessage(data, 'qa-resposta', direct, miguel, T0 + DAY);
  seedMessage(data, 'qa-unica', 'qa-dm-somente-vencida', clara);
  seedCopy(data, 'qa-previa', 'qa-antiga');
  seedCopy(data, 'qa-citacao', 'qa-antiga', {kind: 'quote', parentId: 'qa-resposta'});
  await service.createFixture(data);
  at(89);
  assert.equal(await service.edit(session(clara), 'qa-antiga', 'Editada'), true);
  const edited = (await service.inspect()).data.messages['qa-antiga'];
  assert.equal(edited.sentAt, T0);
  assert.equal(edited.editedAt, T0 + 89 * DAY);
  at(90, -1);
  let result = await service.read(session(miguel), 'chat', direct);
  assert.equal(result.messages['qa-antiga'].text, 'Editada');
  assert.equal(result.derived['qa-citacao'].text, 'Editada');
  assert.equal(result.derived['qa-previa'].text, 'Editada');
  at(90);
  result = await service.read(session(miguel), 'chat', direct);
  assert.deepEqual(Object.keys(result.messages), ['qa-resposta']);
  assert.deepEqual(result.derived, {});
  assert.equal((await service.read(session(miguel), 'chat', 'qa-dm-somente-vencida')).indexed, false);
  assert.equal(await service.edit(session(clara), 'qa-antiga', 'Reaparecer'), false);
  await service.sweep();
  at(90, 1);
  await service.sweep();
  const {data: persisted} = await service.inspect();
  assert.deepEqual(persisted.indexes, {[direct]: true});
  assert.deepEqual(Object.keys(persisted.messages), ['qa-resposta']);
  assert.deepEqual(persisted.derived, {});
  assert.equal(await service.read(session(lucia), 'chat', direct), null);
});

qa('14.2', 'grupo aberto e mínimos de 90 dias desde envio e 30 desde fechamento', async ({service, at}) => {
  const data = fixture();
  const groups = [group, 'qa-fecha-dia50', 'qa-fecha-dia60', 'qa-fecha-dia80'];
  for (const id of groups) {
    data.chats[id] = {kind:'group', members:[clara,miguel]};
    seedMessage(data, id + '-msg', id, clara);
    seedCopy(data, id + '-subcolecao', id + '-msg', {kind:'message_child'});
  }
  await service.createFixture(data);
  assert.equal(await service.send(session(miguel), group, 'qa-envio-aberto', 'Aceitar'), true);
  for (const [closing, id] of [[50,groups[1]],[60,groups[2]]]) {
    at(closing);
    assert.equal(await service.closeGroup(id), true);
    assert.equal(await service.send(session(miguel), id, id + '-nova', 'Recusar'), false);
  }
  at(80, -1);
  assert.ok((await service.read(session(miguel), 'chat', groups[1])).messages[groups[1] + '-msg']);
  at(80);
  assert.equal(await service.closeGroup(groups[3]), true);
  assert.equal(await service.send(session(miguel), groups[3], 'qa-nova', 'Recusar'), false);
  assert.deepEqual((await service.read(session(miguel), 'chat', groups[1])).messages, {});
  await service.sweep();
  at(80, 1);
  assert.equal((await service.inspect()).data.derived[groups[1] + '-subcolecao'], undefined);
  at(90, -1);
  for (const id of [group,groups[2],groups[3]]) {
    assert.ok((await service.read(session(miguel), 'chat', id)).messages[id + '-msg']);
  }
  at(90);
  for (const id of [group,groups[2],groups[3]]) {
    assert.deepEqual((await service.read(session(miguel), 'chat', id)).messages, {});
  }
  await service.sweep();
  at(90, 1);
  const {data: persisted} = await service.inspect();
  assert.deepEqual(persisted.messages, {});
  assert.deepEqual(persisted.derived, {});
  assert.deepEqual(persisted.indexes, {});
  assert.equal(await service.read(session(lucia), 'chat', group), null);
});

qa('14.3', 'convites, preferências e validade própria de avisos', async ({service, at}) => {
  const data = fixture();
  for (const id of ['qa-pendente','qa-aceito','qa-recusado']) data.invites[id] = invite();
  const notice = {recipient:miguel, actor:clara, expiresAt:T0 + 4 * DAY};
  await service.createFixture(data);
  assert.equal(await service.deliverNotice('qa-aviso', notice), true);
  at(2);
  assert.equal(await service.answerInvite(session(miguel), 'qa-aceito', 'accepted'), true);
  at(3);
  assert.equal(await service.answerInvite(session(miguel), 'qa-recusado', 'declined'), true);
  at(4, -1);
  assert.deepEqual(await service.read(session(miguel), 'notice', 'qa-aviso'), notice);
  at(4);
  assert.equal(await service.read(session(miguel), 'notice', 'qa-aviso'), null);
  await service.sweep();
  at(4, 1);
  assert.equal(await service.deliverNotice('qa-aviso', notice), false);
  at(7, -1);
  assert.equal((await service.read(session(miguel), 'invite', 'qa-pendente')).status, 'pending');
  at(7);
  assert.equal(await service.read(session(miguel), 'invite', 'qa-pendente'), null);
  assert.equal(await service.answerInvite(session(miguel), 'qa-pendente', 'accepted'), false);
  await service.sweep();
  at(7, 1);
  assert.deepEqual((await service.inspect()).data.invites['qa-pendente'],
    {...invite(), status:'expired', resolvedAt:T0 + 7 * DAY});
  for (const [day,id,status] of [[9,'qa-aceito','accepted'],[10,'qa-recusado','declined'],[14,'qa-pendente','expired']]) {
    at(day, -1);
    await service.sweep();
    assert.equal((await service.inspect()).data.invites[id].status, status);
    at(day);
    await service.sweep();
    assert.equal((await service.inspect()).data.invites[id], undefined);
    at(day, 1);
    assert.equal(await service.answerInvite(session(miguel), id, 'accepted'), false);
  }
  assert.deepEqual(await service.read(session(miguel), 'account'), {preferences:{inbox:'contacts'}});
});

qa('14.4', 'denúncia aberta, recurso, acesso por caso e vencimento da evidência', async ({service, at, caseId}) => {
  const data = fixture();
  seedMessage(data,'qa-denunciada',direct,clara);
  seedMessage(data,'qa-denunciada-grupo',group,clara);
  seedMessage(data,'qa-adjacente-1',direct,miguel);
  seedMessage(data,'qa-adjacente-2',group,miguel);
  const reports = {
    'qa-dm-aberta':report('open',{sourceId:'qa-denunciada'}),
    'qa-grupo-recurso':report('appeal',{sourceId:'qa-denunciada-grupo'}),
    'qa-encerrada':report('closed',{finalAt:T0}),
    'qa-excecao':report('closed',{finalAt:T0,hold:{reason:'Revisão documentada',responsible:assigned,reviewAt:T0+89*DAY}}),
  };
  await service.createFixture(data,{reports,moderators});
  const env = await initializeTestEnvironment({projectId:'demo-atrio-v11',firestore:{host:'127.0.0.1',port:8089}});
  try {
    const client = env.authenticatedContext(assigned).firestore();
    for (const collection of ['qa_item14_data','qa_item14_control','qa_item14_copies']) {
      await assertFails(getDoc(doc(client,collection,caseId)));
    }
  } finally { await env.cleanup(); }
  at(1);
  await service.confirmDeletion(session(clara), operation);
  await service.stepDeletion(operation);
  await service.stepDeletion(operation);
  assert.deepEqual(Object.keys((await service.inspect()).data.messages).sort(), ['qa-adjacente-1','qa-adjacente-2']);
  for (const who of [outside,revokedMod,lucia,clara]) {
    assert.equal(await service.read(session(who),'report','qa-dm-aberta'), null);
  }
  for (const id of ['qa-dm-aberta','qa-grupo-recurso']) {
    assert.deepEqual(await service.read(session(assigned),'report',id),
      {protocol:'Protocolo fictício',excerpt:'Trecho mínimo de Clara'});
  }
  assert.equal(await service.read(session(assigned),'chat',direct), null);
  assert.equal(await service.read(session(assigned),'chat',group), null);
  at(90, -1);
  assert.ok(await service.read(session(assigned),'report','qa-encerrada'));
  at(90);
  assert.equal(await service.read(session(assigned),'report','qa-encerrada'), null);
  await service.sweep();
  assert.equal((await service.inspect()).control.reports['qa-excecao'].hold.reviewDue, true);
  assert.ok(await service.read(session(assigned),'report','qa-excecao'));
  await service.releaseHold('qa-excecao');
  at(90, 1);
  await service.sweep();
  assert.deepEqual(Object.keys((await service.inspect()).control.reports).sort(), ['qa-dm-aberta','qa-grupo-recurso']);
});

qa('14.5', 'revogação imediata, limpeza com checkpoint e auditoria mínima', async ({service, at, restart}) => {
  const data = fixture();
  seedMessage(data,'qa-clara-dm',direct,clara);
  seedMessage(data,'qa-clara-grupo',group,clara);
  seedMessage(data,'qa-miguel-dm',direct,miguel);
  seedMessage(data,'qa-miguel-grupo',group,miguel);
  seedCopy(data,'qa-do-outro-lado','qa-clara-dm',{kind:'quote',parentId:'qa-miguel-dm'});
  seedCopy(data,'qa-filho-do-grupo','qa-clara-grupo',{kind:'message_child'});
  seedCopy(data,'qa-previa-do-miguel','qa-miguel-dm');
  data.blocks['qa-par'] = {actor:clara,peer:lucia};
  await service.createFixture(data,{reports:{'qa-caso':report('open')},moderators});
  const receipt = await service.confirmDeletion(session(clara), operation);
  assert.equal(receipt.dueAt, T0 + 30 * DAY);
  assertClaraUnlinked(await service.inspect());
  assert.equal(await service.read(session(clara),'account'), null);
  assert.equal(await service.send(session(clara),direct,'qa-sessao-antiga','Recusar'), false);
  assert.equal(await service.send(session(miguel),direct,'qa-dm-sem-par','Recusar'), false);
  assert.deepEqual(await service.confirmDeletion(session(clara), operation), receipt);
  assert.ok(!(await service.read(session(miguel),'chat',direct)).messages['qa-clara-dm']);
  assert.deepEqual(Object.keys((await service.read(session(miguel),'chat',direct)).derived), ['qa-previa-do-miguel']);
  const checkpoint = await service.stepDeletion(operation);
  assert.equal(checkpoint.phase, 'derived');
  assert.ok((await service.inspect()).data.derived['qa-filho-do-grupo']);

  // O segundo cliente retoma apenas a partir do estado persistido.
  const resumed = await restart();
  assert.deepEqual((await resumed.inspect()).control.jobs[operation], checkpoint);
  at(30, -1);
  assert.equal((await resumed.inspect()).data.accounts[clara].preferences.inbox, 'contacts');
  at(30);
  const done = await resumed.stepDeletion(operation);
  assert.equal(done.completedAt, T0 + 30 * DAY);
  assert.equal(done.withinTarget, true);
  at(30, 1);
  const settled = await resumed.inspect();
  assertClaraUnlinked(settled);
  assert.deepEqual(await resumed.stepDeletion(operation), done);
  assert.equal(await resumed.confirmDeletion(session(clara), operation), null);
  assert.deepEqual((await resumed.inspect()).data, settled.data);
  assert.equal(settled.data.accounts[clara], undefined);
  assert.equal(settled.data.sessions[session(clara)], undefined);
  assert.deepEqual(settled.data.blocks,{});
  assert.deepEqual(Object.keys(settled.data.messages).sort(), ['qa-miguel-dm','qa-miguel-grupo']);
  assert.deepEqual(Object.keys(settled.data.derived), ['qa-previa-do-miguel']);
  assert.deepEqual(Object.keys((await resumed.read(session(miguel),'chat',direct)).messages), ['qa-miguel-dm']);
  assert.deepEqual(Object.keys((await resumed.read(session(miguel),'chat',group)).messages), ['qa-miguel-grupo']);
  assertMinimumEvidence(await resumed.read(session(assigned),'report','qa-caso'));
  assert.equal(await resumed.read(session(assigned),'chat',direct), null);
  assert.equal(await resumed.read(session(assigned),'chat',group), null);
  assert.equal(await resumed.read(session(outside),'report','qa-caso'), null);
  at(210, -1);
  await resumed.sweep();
  assert.ok((await resumed.inspect()).control.jobs[operation]);
  at(210);
  await resumed.sweep();
  at(210, 1);
  assert.equal((await resumed.inspect()).control.jobs[operation], undefined);
  assert.ok(await resumed.read(session(assigned),'report','qa-caso'));
});

qa('14.6', 'restauração interrompida, revogação e fronteira da última cópia', async ({service, at, restart, caseId}) => {
  const data = fixture();
  data.chats['qa-dm-bloqueada'] = {kind:'direct',members:[miguel,outside]};
  seedMessage(data,'qa-vence-na-restauracao',direct,miguel);
  seedMessage(data,'qa-manter',direct,miguel,T0+60*DAY);
  seedMessage(data,'qa-apagar',direct,clara,T0+60*DAY);
  seedMessage(data,'qa-manter-no-grupo',group,miguel,T0+60*DAY);
  seedMessage(data,'qa-apagar-no-grupo',group,clara,T0+60*DAY);
  seedMessage(data,'qa-bloquear','qa-dm-bloqueada',outside,T0+60*DAY);
  seedCopy(data,'qa-derivada','qa-apagar');
  data.notices['qa-antigo'] = {actor:lucia,recipient:miguel,expiresAt:T0+92*DAY};
  data.invites['qa-resolvido'] = {...invite(T0+81*DAY),sender:miguel,recipient:outside};
  await service.createFixture(data,{reports:{'qa-caso':report('open')},moderators});
  at(80);
  await service.takeCopy('qa-backup-a','backup');
  await service.takeCopy('qa-exportacao','export');
  at(81);
  await service.takeCopy('qa-backup-b','backup');
  // Cópia legada em que o UID ainda consta nos vínculos, mas falta a conta.
  await updateLegacyFixture(caseId, 'qa_item14_copies',
    new FieldPath('qa-backup-b','data','accounts',clara), FieldValue.delete());
  const legacyCopy = (await service.inspect()).copies['qa-backup-b'].data;
  assert.equal(legacyCopy.accounts[clara], undefined);
  assert.ok(legacyCopy.chats[direct].members.includes(clara));
  assert.ok(legacyCopy.chats[group].members.includes(clara));
  at(82);
  assert.equal(await service.answerInvite(session(outside),'qa-resolvido','accepted'), true);
  assert.equal(await service.block(session(miguel),outside), true);
  assert.equal(await service.revoke18(lucia), true);
  assert.equal(await service.declare18(session(lucia)), false);
  await service.confirmDeletion(session(clara),operation);
  await service.stepDeletion(operation);
  await service.stepDeletion(operation);
  assertClaraUnlinked(await service.inspect());
  assert.equal(await service.read(session(miguel),'notice','qa-antigo'), null);
  const replay = data.notices['qa-antigo'];
  assert.equal(await service.deliverNotice('qa-antigo',replay), false);

  at(87, -1);
  assert.equal(await service.startRestore('qa-exportacao'), true);
  const resumed = await restart();
  assertClaraUnlinked(await resumed.inspect());
  assert.equal(await resumed.read(session(miguel),'chat',direct), null);
  assert.equal(await resumed.read(session(assigned),'report','qa-caso'), null);
  await assert.rejects(resumed.declare18(session(lucia)), /item14_restore_in_progress/);
  at(87);
  assert.equal(await resumed.finishRestore(), false);
  assert.equal(await resumed.read(session(miguel),'chat',direct), null);
  at(87, 1);
  assert.equal(await resumed.startRestore('qa-exportacao'), false);
  assert.equal(await resumed.startRestore('qa-backup-b'), true);
  assertClaraUnlinked(await resumed.inspect());
  assert.equal(await resumed.finishRestore(), true);
  assert.equal((await resumed.inspect()).data.invites['qa-resolvido'].status, 'accepted');
  assert.equal(await resumed.answerInvite(session(outside),'qa-resolvido','declined'), false);
  assert.equal(await resumed.startRestore('qa-backup-b'), true);
  at(90);
  assert.equal(await resumed.finishRestore(), true);
  assertClaraUnlinked(await resumed.inspect());
  assert.deepEqual(Object.keys((await resumed.read(session(miguel),'chat',direct)).messages), ['qa-manter']);
  assert.deepEqual(Object.keys((await resumed.read(session(miguel),'chat',group)).messages), ['qa-manter-no-grupo']);
  assert.deepEqual((await resumed.read(session(miguel),'chat',direct)).derived, {});
  assert.equal(await resumed.read(session(miguel),'chat','qa-dm-bloqueada'), null);
  assert.equal(await resumed.read(session(clara),'chat',direct), null);
  assert.equal(await resumed.read(session(clara),'chat',group), null);
  assert.equal(await resumed.read(session(miguel),'notice','qa-antigo'), null);
  assert.equal(await resumed.declare18(session(lucia)), false);
  assertMinimumEvidence(await resumed.read(session(assigned),'report','qa-caso'));
  assert.equal(await resumed.read(session(assigned),'chat',direct), null);
  assert.equal(await resumed.read(session(assigned),'chat',group), null);
  assert.equal(await resumed.read(session(outside),'report','qa-caso'), null);

  at(110, -1);
  await resumed.sweep();
  assert.ok((await resumed.inspect()).copies['qa-backup-a']);
  at(110);
  await resumed.sweep();
  assert.equal((await resumed.inspect()).copies['qa-backup-a'], undefined);
  at(110, 1);
  assert.equal(await resumed.startRestore('qa-backup-a'), false);
  at(111, -1);
  await resumed.sweep();
  let state = await resumed.inspect();
  assertClaraUnlinked(state);
  assert.equal(state.control.deleted[clara].keepUntil, T0+111*DAY);
  assert.ok(state.control.revoked[lucia]);
  at(111);
  await resumed.sweep();
  state = await resumed.inspect();
  assertClaraUnlinked(state);
  assert.deepEqual(state.copies,{});
  assert.deepEqual(state.control.deleted,{});
  assert.deepEqual(state.control.revoked,{});
  at(111, 1);
  assert.equal(await resumed.startRestore('qa-backup-b'), false);
  assert.equal(await resumed.declare18(session(lucia)), false);
  assert.equal(await resumed.read(session(clara),'account'), null);
  assert.equal(await resumed.deliverNotice('qa-antigo',replay), false);

  // Resíduo persistido por um executor anterior, depois de vencer o marcador.
  await updateLegacyFixture(caseId, 'qa_item14_data',
    new FieldPath('chats', direct, 'members'), [clara, miguel],
    new FieldPath('chats', group, 'members'), [clara, miguel]);
  await resumed.sweep();
  assertClaraUnlinked(await resumed.inspect());
  assert.deepEqual(Object.keys((await resumed.read(session(miguel),'chat',direct)).messages), ['qa-manter']);
  assert.deepEqual(Object.keys((await resumed.read(session(miguel),'chat',group)).messages), ['qa-manter-no-grupo']);
  assertMinimumEvidence(await resumed.read(session(assigned),'report','qa-caso'));
});
