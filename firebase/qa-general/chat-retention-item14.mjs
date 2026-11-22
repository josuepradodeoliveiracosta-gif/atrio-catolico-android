// Executor de homologação do item 14, exclusivo do Firestore Emulator.
import {isDeepStrictEqual} from 'node:util';

export const DAY = 86_400_000;
const MESSAGE = 90 * DAY;
const CLOSED_GROUP = 30 * DAY;
const INVITE = 7 * DAY;
const EVIDENCE = 90 * DAY;
const ACCOUNT_TARGET = 30 * DAY;
const ACCOUNT_AUDIT = 180 * DAY;
const COPY_AGE = {backup: 30 * DAY, export: 7 * DAY};
const PROJECT = 'demo-atrio-v11';
const HOST = '127.0.0.1:8089';
const COLLECTIONS = ['qa_item14_data', 'qa_item14_control', 'qa_item14_copies'];
const validId = value => typeof value === 'string' && /^qa-[a-z0-9-]{1,80}$/.test(value);
const select = (records, keep) => Object.fromEntries(
  Object.entries(records).filter(([id, value]) => keep(value, id)),
);
const before = (now, limit) => Number.isSafeInteger(limit) && now < limit;
const accountActive = ({data, control}, uid) => data.accounts[uid]?.active === true && !control.deleted[uid];
const eligible = (state, uid) => accountActive(state, uid)
  && state.data.accounts[uid].approved18 === true && !state.control.revoked[uid];
const groupClosedAt = (state, id) => state.control.closedGroups[id] ?? null;

function sessionAccount(state, token) {
  if (state.control.restore) return null;
  const uid = state.data.sessions[token];
  return uid && accountActive(state, uid) ? uid : null;
}

function memberCanRead(state, uid, chatId) {
  const chat = state.data.chats[chatId];
  if (!chat?.members.includes(uid) || !eligible(state, uid)) return false;
  if (chat.kind !== 'direct') return true;
  return !Object.values(state.data.blocks).some(({actor, peer}) =>
    (actor === uid || peer === uid) && chat.members.includes(actor) && chat.members.includes(peer));
}

function messageIsLive(state, message, now) {
  if (!message || !Number.isSafeInteger(message.sentAt) || message.sentAt > now) return false;
  if (!state.data.chats[message.chatId] || state.control.deleted[message.author]) return false;
  const closedAt = groupClosedAt(state, message.chatId);
  const groupLimit = closedAt === null ? Infinity : closedAt + CLOSED_GROUP;
  return before(now, Math.min(message.sentAt + MESSAGE, groupLimit));
}

function inviteView(state, id, invite, now) {
  const decision = state.control.inviteDecisions[id];
  if (decision && invite.status === 'pending') return {...invite, ...decision.result};
  if (invite.status !== 'pending' || before(now, invite.createdAt + INVITE)) return invite;
  return {...invite, status: 'expired', resolvedAt: invite.createdAt + INVITE};
}

function noticeIsLive(state, notice, now) {
  return before(now, notice.expiresAt) && eligible(state, notice.recipient)
    && (notice.actor == null || eligible(state, notice.actor))
    && (!notice.messageId || messageIsLive(state, state.data.messages[notice.messageId], now));
}

function reportIsRetained(report, now) {
  const hold = report.hold;
  return report.status === 'open' || report.status === 'appeal'
    || (hold?.reason && hold.responsible && Number.isSafeInteger(hold.reviewAt) && hold.releasedAt == null)
    || (report.status === 'closed' && before(now, report.finalAt + EVIDENCE));
}

function pruneDerived(state) {
  const {data} = state;
  data.derived = select(data.derived, item =>
    data.messages[item.sourceId]?.chatId === item.chatId
    && (!item.parentId || data.messages[item.parentId]?.chatId === item.chatId));
  const occupied = new Set(Object.values(data.messages).map(message => message.chatId));
  data.indexes = select(data.indexes, (_, id) => occupied.has(id));
}

function pruneChatMemberships({data, control}) {
  for (const chat of Object.values(data.chats)) {
    chat.members = chat.members.filter(uid => Object.hasOwn(data.accounts, uid) && !control.deleted[uid]);
  }
}

function pruneLive(state, now) {
  const {data, control} = state;
  pruneChatMemberships(state);
  data.messages = select(data.messages, message => messageIsLive(state, message, now));
  pruneDerived(state);
  data.accounts = select(data.accounts, (_, uid) => !control.deleted[uid]);
  for (const uid of Object.keys(control.revoked)) {
    if (data.accounts[uid]) {
      data.accounts[uid].approved18 = false;
      data.accounts[uid].ageRevoked = true;
    }
  }
  data.sessions = select(data.sessions, uid => accountActive(state, uid));
  data.blocks = select(data.blocks, ({actor, peer}) => accountActive(state, actor) && accountActive(state, peer));
  data.invites = Object.fromEntries(Object.entries(data.invites).map(([id, invite]) =>
    [id, inviteView(state, id, invite, now)]));
  data.invites = select(data.invites, invite =>
    accountActive(state, invite.sender) && accountActive(state, invite.recipient)
    && invite.createdAt <= now
    && (invite.status === 'pending' || before(now, invite.resolvedAt + INVITE)));
  data.notices = select(data.notices, notice => noticeIsLive(state, notice, now));
}

function lastCopyDeadline(state, includes, now) {
  return Object.values(state.copies).reduce((latest, copy) =>
    before(now, copy.expiresAt) && includes(copy.data) ? Math.max(latest, copy.expiresAt) : latest, now);
}

function sweepState(state, now) {
  const {control} = state;
  pruneLive(state, now);
  control.reports = select(control.reports, report => reportIsRetained(report, now));
  for (const report of Object.values(control.reports)) {
    if (report.hold && !report.hold.releasedAt && now >= report.hold.reviewAt) report.hold.reviewDue = true;
  }
  state.copies = select(state.copies, copy => before(now, copy.expiresAt));
  control.deleted = select(control.deleted, removal =>
    before(now, removal.keepUntil) || control.jobs[removal.operationId]?.phase !== 'done');
  control.revoked = select(control.revoked, revocation => before(now, revocation.keepUntil));
  control.inviteDecisions = select(control.inviteDecisions, decision => before(now, decision.keepUntil));
  control.jobs = select(control.jobs, job => job.phase !== 'done' || before(now, job.completedAt + ACCOUNT_AUDIT));
}

function readSubject(state, token, subject, id, now) {
  const uid = sessionAccount(state, token);
  if (!uid) return null;
  const {data, control} = state;
  if (subject === 'account') return {preferences: data.accounts[uid].preferences};
  if (subject === 'report') {
    const report = control.reports[id];
    return report && control.moderators[uid] === true && report.reviewers.includes(uid)
      && reportIsRetained(report, now) ? {protocol: report.protocol, excerpt: report.excerpt} : null;
  }
  if (!eligible(state, uid)) return null;
  if (subject === 'invite') {
    const invite = data.invites[id];
    const chat = invite && data.chats[invite.chatId];
    if (!invite || invite.recipient !== uid || !chat
        || invite.createdAt > now || groupClosedAt(state, invite.chatId) !== null
        || !eligible(state, invite.sender)) return null;
    const current = inviteView(state, id, invite, now);
    return current.status === 'pending' ? current : null;
  }
  if (subject === 'notice') {
    const notice = data.notices[id];
    return notice?.recipient === uid && noticeIsLive(state, notice, now) ? notice : null;
  }
  if (subject !== 'chat' || !memberCanRead(state, uid, id)) return null;
  const messages = select(data.messages, message => message.chatId === id && messageIsLive(state, message, now));
  const derived = select(data.derived, copy => copy.chatId === id
    && messages[copy.sourceId] && (!copy.parentId || messages[copy.parentId]));
  return {messages, derived, indexed: !!data.indexes[id] && Object.keys(messages).length > 0};
}

export function createItem14Qa({Firestore, caseId, clock}) {
  if (process.env.FIRESTORE_EMULATOR_HOST !== HOST || !validId(caseId) || typeof clock !== 'function') {
    throw Error('item14_requires_local_emulator_and_fixture');
  }
  const db = new Firestore({projectId: PROJECT, host: HOST, ssl: false});
  const refs = COLLECTIONS.map(collection => db.collection(collection).doc(caseId));
  const liveCollections = ['messages', 'derived'].map(name => refs[0].collection(name));
  const time = () => {
    const now = clock();
    if (!Number.isSafeInteger(now)) throw Error('item14_invalid_clock');
    return now;
  };
  const load = async tx => {
    const [[data, control, copies], [messages, derived]] = await Promise.all([
      tx.getAll(...refs), Promise.all(liveCollections.map(collection => tx.get(collection))),
    ]);
    if (!data.exists || !control.exists || !copies.exists) throw Error('item14_fixture_missing');
    const rows = query => Object.fromEntries(query.docs.map(doc => [doc.id, doc.data()]));
    return {
      data: {...data.data(), messages: rows(messages), derived: rows(derived)},
      control: control.data(), copies: copies.data(),
    };
  };
  const persist = (tx, previous, updated) => {
    const {messages, derived, ...metadata} = updated.data;
    const {messages: oldMessages, derived: oldDerived, ...oldMetadata} = previous.data;
    for (const [i, old, next] of [
      [0, oldMetadata, metadata], [1, previous.control, updated.control], [2, previous.copies, updated.copies],
    ]) {
      if (!isDeepStrictEqual(old, next)) tx.set(refs[i], next);
    }
    for (const [i, old, next] of [[0, oldMessages, messages], [1, oldDerived, derived]]) {
      const collection = liveCollections[i];
      for (const id of Object.keys(old)) {
        if (!Object.hasOwn(next, id)) tx.delete(collection.doc(id));
      }
      for (const [id, data] of Object.entries(next)) {
        if (!isDeepStrictEqual(old[id], data)) tx.set(collection.doc(id), data);
      }
    }
  };
  const change = (apply, duringRestore = false) => {
    const now = time();
    return db.runTransaction(async tx => {
      const state = await load(tx);
      if (now < state.control.lastWriteAt) throw Error('item14_clock_rewound');
      if (state.control.restore && !duringRestore) throw Error('item14_restore_in_progress');
      const previous = structuredClone(state);
      const result = apply(state, now);
      if (!isDeepStrictEqual(previous, state)) {
        state.control.lastWriteAt = now;
        persist(tx, previous, state);
      }
      return result;
    });
  };
  const inspect = () => db.runTransaction(load, {readOnly: true});

  return {
    dispose: () => db.terminate(),
    async createFixture({messages, derived, ...data}, {reports = {}, moderators = {}} = {}) {
      const batch = db.batch();
      batch.create(refs[0], data);
      batch.create(refs[1], {
        deleted: {}, revoked: {}, jobs: {}, closedGroups: {}, inviteDecisions: {},
        restore: null, reports, moderators, lastWriteAt: time(),
      });
      batch.create(refs[2], {});
      for (const [i, records] of [[0, messages], [1, derived]]) {
        for (const [id, record] of Object.entries(records)) batch.create(liveCollections[i].doc(id), record);
      }
      await batch.commit();
    },
    inspect,
    async read(token, subject, id) {
      const state = await inspect();
      const now = time();
      if (now < state.control.lastWriteAt) throw Error('item14_clock_rewound');
      return readSubject(state, token, subject, id, now);
    },
    sweep: () => change(sweepState),
    closeGroup: id => change((state, now) => {
      if (state.data.chats[id]?.kind !== 'group') return false;
      state.control.closedGroups[id] ??= now;
      return true;
    }),
    send: (token, chatId, id, text) => change((state, now) => {
      const uid = sessionAccount(state, token);
      if (!uid || !validId(id) || !memberCanRead(state, uid, chatId)
          || groupClosedAt(state, chatId) !== null || state.data.messages[id]) return false;
      const chat = state.data.chats[chatId];
      if (chat.kind === 'direct' && chat.members.length < 2) return false;
      state.data.messages[id] = {chatId, author: uid, sentAt: now, text};
      state.data.indexes[chatId] = true;
      return true;
    }),
    edit: (token, id, text) => change((state, now) => {
      const uid = sessionAccount(state, token);
      const message = state.data.messages[id];
      if (!uid || message?.author !== uid || !memberCanRead(state, uid, message.chatId)
          || groupClosedAt(state, message.chatId) !== null || !messageIsLive(state, message, now)) return false;
      state.data.messages[id] = {...message, editedAt: now, text};
      for (const copy of Object.values(state.data.derived)) {
        if (copy.sourceId === id) copy.text = text;
      }
      return true;
    }),
    answerInvite: (token, id, status) => change((state, now) => {
      if (!['accepted', 'declined'].includes(status) || !readSubject(state, token, 'invite', id, now)) return false;
      const result = {status, resolvedAt: now};
      state.data.invites[id] = {...state.data.invites[id], ...result};
      state.control.inviteDecisions[id] = {result, keepUntil: Math.max(now + INVITE,
        lastCopyDeadline(state, data => data.invites[id]?.status === 'pending', now))};
      return true;
    }),
    deliverNotice: (id, notice) => change((state, now) => {
      if (!validId(id) || state.data.notices[id] || !noticeIsLive(state, notice, now)) return false;
      state.data.notices[id] = notice;
      return true;
    }),
    revoke18: uid => change((state, now) => {
      if (!accountActive(state, uid)) return false;
      state.data.accounts[uid].approved18 = false;
      state.data.accounts[uid].ageRevoked = true;
      state.control.revoked[uid] = {keepUntil: lastCopyDeadline(state,
        data => data.accounts[uid]?.approved18 === true, now)};
      return true;
    }),
    block: (token, peer) => change(state => {
      const actor = sessionAccount(state, token);
      if (!actor || actor === peer || !accountActive(state, peer)) return false;
      state.data.blocks[actor + '_' + peer] = {actor, peer};
      return true;
    }),
    declare18: token => change(state => {
      const uid = sessionAccount(state, token);
      if (!uid || state.control.revoked[uid] || state.data.accounts[uid].ageRevoked) return false;
      state.data.accounts[uid].approved18 = true;
      return true;
    }),
    releaseHold: id => change((state, now) => {
      const hold = state.control.reports[id]?.hold;
      if (!hold || hold.releasedAt != null) return false;
      hold.releasedAt = now;
      return true;
    }),
    confirmDeletion: (token, operationId) => change((state, now) => {
      if (!validId(operationId)) return null;
      const uid = state.data.sessions[token];
      const prior = state.control.jobs[operationId];
      if (prior) return prior.uid === uid ? prior : null;
      if (!uid || !accountActive(state, uid)) return null;
      state.control.deleted[uid] = {operationId, keepUntil: lastCopyDeadline(state,
        data => !!data.accounts[uid] || Object.values(data.chats).some(chat => chat.members.includes(uid)), now)};
      pruneChatMemberships(state);
      state.control.jobs[operationId] = {uid, phase: 'messages', confirmedAt: now, dueAt: now + ACCOUNT_TARGET};
      return state.control.jobs[operationId];
    }),
    stepDeletion: operationId => change((state, now) => {
      const job = state.control.jobs[operationId];
      if (!job || job.phase === 'done') return job ?? null;
      if (job.phase === 'messages') {
        state.data.messages = select(state.data.messages, message => message.author !== job.uid);
        job.phase = 'derived';
      } else {
        pruneLive(state, now);
        job.completedAt = now;
        job.withinTarget = now <= job.dueAt;
        job.phase = 'done';
      }
      return job;
    }),
    takeCopy: (id, kind) => change((state, now) => {
      if (!validId(id) || !Object.hasOwn(COPY_AGE, kind) || state.copies[id]) return false;
      const copy = {...state, data: structuredClone(state.data)};
      pruneLive(copy, now);
      state.copies[id] = {kind, createdAt: now, expiresAt: now + COPY_AGE[kind], data: copy.data};
      return true;
    }),
    startRestore: id => change((state, now) => {
      const copy = state.copies[id];
      if (!copy || !before(now, copy.expiresAt)) return false;
      state.control.restore = {copyId: id, startedAt: now};
      state.data = {...structuredClone(copy.data), blocks: state.data.blocks};
      pruneChatMemberships(state);
      return true;
    }, true),
    finishRestore: () => change((state, now) => {
      const copy = state.copies[state.control.restore?.copyId];
      if (!copy || !before(now, copy.expiresAt)) return false;
      sweepState(state, now);
      state.control.restore = null;
      return true;
    }, true),
  };
}
