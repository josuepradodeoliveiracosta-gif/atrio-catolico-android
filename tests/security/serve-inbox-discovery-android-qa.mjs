/**
 * Fixture manual #355. Requer uma composição com a #359 e dois emuladores
 * locais limpos. Subir somente em 127.0.0.1; o Android usa adb reverse.
 */
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {Firestore, Timestamp} from '@google-cloud/firestore';
import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {createInboxMessageHttpHandler} from '../../firebase/qa-general/chat-inbox-message-http.mjs';
import {createInboxBlockHttpHandler} from '../../firebase/qa-general/chat-inbox-block-http.mjs';
import {
  createAdminInboxStore, createAuthorizedInboxService, createInboxHttpHandler
} from '../../firebase/qa-general/chat-inbox-discovery-server.mjs';
import {
  advanceInboxMaintenance, beginInboxBackfill, writeInboxBlock
} from '../../firebase/qa-general/chat-inbox-maintenance.mjs';
import {INBOX_TEXT_MAX_UTF16_UNITS} from '../../firebase/qa-general/chat-inbox-peer-index.mjs';

const project = 'demo-atrio-v11';
const host = '127.0.0.1';
if (process.env.FIRESTORE_EMULATOR_HOST !== host + ':8089' ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== host + ':9099' ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error('Fixture exclusiva dos emuladores locais, sem credenciais Admin.');
}
const db = new Firestore({projectId: project});
const auth = 'http://' + host + ':9099/identitytoolkit.googleapis.com/v1';
const adminAuth = getAuth(initializeApp({projectId: project}, 'qa-android-inbox'));
const verifyIdToken = adminAuth.verifyIdToken.bind(adminAuth);
const password = 'InboxQa355!Emulador';
const makeEmail = name => 'inbox.' + name + '@qa.invalid';

async function authRequest(path, data, headers = {}) {
  const response = await fetch(auth + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('Auth Emulator recusou a operação: ' + response.status);
  return response.json();
}

async function seedUser(name) {
  const {localId} = await authRequest('/accounts:signUp?key=local-emulator-test', {
    email: makeEmail(name), password, returnSecureToken: false
  });
  const account = await authRequest('/projects/' + project + '/accounts:update', {
    localId, emailVerified: true
  }, {Authorization: 'Bearer owner'});
  if (account.localId !== localId || account.emailVerified !== true)
    throw new Error('Falha ao verificar conta fictícia.');
  return localId;
}

const [clara, miguel, lucia] = await Promise.all(['clara', 'miguel', 'lucia'].map(seedUser));
const contactPeer = 'qa-inbox-message-contact';
const acceptedPeer = 'qa-inbox-peer-02';
const profilePeer = 'qa-inbox-peer-03';
const now = Date.now();
const expiresAt = Timestamp.fromMillis(now + 86_400_000);
const seedAge = (batch, uid, reviewExpiresAt) => batch.set(
  db.doc('users/' + uid + '/chatAgeEligibility/current'), {
    status: 'eligible', policyVersion: '2026-11-18plus-qa-v1', minimumAge: 18, reviewExpiresAt
  });
const batch = db.batch();
batch.set(db.doc('app_config/conversations'), {
  enabled: true, minorPolicyApproved: true, safetyReviewVersion: '2026-11-safety-v1',
  version: '2026-11-v1'
});
for (const uid of [clara, miguel, lucia]) seedAge(batch, uid, expiresAt);
seedAge(batch, contactPeer, expiresAt);
batch.set(db.doc('public_profiles/' + contactPeer), {uid: contactPeer, displayName: 'Contato QA'});
batch.set(db.doc('users/' + contactPeer + '/chatSettings/privacy'), {requests: 'all'});
for (let index = 1; index <= 43; index++) {
  const suffix = String(index).padStart(2, '0');
  const peer = 'qa-inbox-peer-' + suffix;
  const chatId = [clara, peer].sort().join('__');
  seedAge(batch, peer, Timestamp.fromMillis(expiresAt.toMillis() + index * 1000));
  batch.set(db.doc('public_profiles/' + peer), {uid: peer, displayName: 'Par QA ' + suffix});
  batch.set(db.doc('chats/' + chatId), {
    participants: [clara, peer], requesterUid: clara, recipientUid: peer,
    status: 'accepted', lastPreview: 'Prévia QA ' + suffix, lastSenderUid: clara,
    unreadRequester: 0, unreadRecipient: 0, updatedAt: Timestamp.fromMillis(now + index),
    initialId: 'qa-initial', lastMessageId: 'qa-initial'
  });
  if (peer === acceptedPeer) {
    batch.set(db.doc('chats/' + chatId + '/messages/qa-initial'), {
      uid: peer, text: 'Mensagem inicial de QA', kind: 'text', createdAt: Timestamp.fromMillis(now)
    });
  }
}
batch.set(db.doc('posts/qa-inbox-profile-post'), {
  uid: profilePeer, title: 'Discussão já carregada em QA', body: 'Trecho fictício para o focal de bloqueio.',
  category: 'Vida espiritual', createdAt: Timestamp.fromMillis(now)
});
await batch.commit();
const bootstrap = 'qa-android-inbox-bootstrap';
await beginInboxBackfill(db, bootstrap);
while (!(await advanceInboxMaintenance(db, bootstrap)).done) {
  // Avança a carga e certifica o corte pelas operações reais do backend.
}

let revisionChange;
const firestore = createAdminInboxStore(db);
const service = createAuthorizedInboxService({
  verifyIdToken,
  store: {
    async authorizedPage(uid, after, ...args) {
      if (uid === lucia) throw new Error('Indisponibilidade simulada para a conta fictícia.');
      if (uid === clara && after && process.env.ATRIO_QA_INBOX_MESSAGE_ONLY !== '1') {
        // Bloqueio originado pelo par: o listener local de Clara não reinicia
        // a UI antes que o servidor responda 409 ao cursor desatualizado.
        revisionChange ??= writeInboxBlock(db, {
          operationId: 'qa-android-inbox-change-revision',
          ownerUid: 'qa-inbox-peer-20', peerUid: clara, blocked: true, createdAt: Timestamp.now()
        });
        await revisionChange;
      }
      return firestore.authorizedPage(uid, after, ...args);
    }
  },
  cursorKey: randomBytes(32)
});
const handleInbox = createInboxHttpHandler(service, {enabled: true});
const handleBlock = createInboxBlockHttpHandler({db, verifyIdToken, enabled: true});
const blockPeer = 'qa-inbox-peer-01';
const maintenance = 'qa-android-block-maintenance';
const blockRoute = '/v1/qa/conversations/blocks/' + blockPeer;
const blockChat = [clara, blockPeer].sort().join('__');
const blockDoc = db.doc('users/' + clara + '/blockedMembers/' + blockPeer);
const ownProjection = db.doc('serverInboxOwners/' + clara + '/legacy/' + blockChat);
const peerProjection = db.doc('serverInboxOwners/' + blockPeer + '/legacy/' + blockChat);
let refusedRequest;
let maintenanceExercised = false;

// O focal do perfil arma um único GET. O handler lê o estado real antes do
// PUT da segunda sessão, mas a resposta só sai após a prova de ocultação.
let holdProfileRead = false;
let releaseProfileRead;
const profileRoute = '/v1/qa/conversations/blocks/' + profilePeer;
const profileBlockDoc = db.doc('users/' + clara + '/blockedMembers/' + profilePeer);
async function profileBlockControl(method) {
  if (method === 'POST') {
    assert.ok(!holdProfileRead && !releaseProfileRead);
    holdProfileRead = true;
    return new Response(null, {status: 204});
  }
  if (method === 'GET') return new Response(null, {status: releaseProfileRead ? 200 : 204});
  if (method === 'DELETE') {
    assert.ok(releaseProfileRead && (await profileBlockDoc.get()).exists);
    releaseProfileRead();
    releaseProfileRead = undefined;
    return new Response(null, {status: 204});
  }
  return new Response(null, {status: 405});
}

async function dispatchBlock(request) {
  const url = new URL(request.url);
  if (url.pathname === profileRoute && request.method === 'GET' && holdProfileRead) {
    holdProfileRead = false;
    const result = await handleBlock(request);
    assert.equal(result.status, 200);
    assert.equal((await result.clone().json()).blocked, false);
    console.log('QA PROFILE: GET anterior ao bloqueio retornou blocked=false e ficou retido.');
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        releaseProfileRead = undefined;
        reject(new Error('O focal não liberou o GET retido.'));
      }, 25_000);
      releaseProfileRead = () => { clearTimeout(deadline); resolve(); };
    });
    console.log('QA PROFILE: GET tardio blocked=false liberado após bloqueio confirmado e ocultação na UI.');
    return result;
  }
  if (url.pathname !== blockRoute || !['PUT', 'DELETE'].includes(request.method))
    return handleBlock(request);

  // A primeira intenção fictícia encontra a fronteira de manutenção real.
  // A fixture só controla o momento do corte; a recusa e os commits são do handler.
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const actor = await verifyIdToken(token ?? '', true).catch(() => null);
  if (actor?.uid !== clara) return handleBlock(request);
  const key = request.headers.get('idempotency-key');
  const precondition = request.headers.get('if-match');
  if (!key || !precondition) return handleBlock(request);
  const receiptId = 'http-block-' + createHash('sha256')
    .update(JSON.stringify([clara, key])).digest('hex');
  const receipt = db.doc('serverInboxBlockRequests/' + receiptId);
  if (request.method === 'PUT' && !maintenanceExercised) {
    await beginInboxBackfill(db, maintenance);
    const refused = await handleBlock(request);
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.clone().json(), {error: 'block_unavailable'});
    const snapshots = await db.getAll(blockDoc, receipt, ownProjection, peerProjection);
    assert.deepEqual(snapshots.map(snapshot => snapshot.exists), [false, false, true, true]);
    refusedRequest = {key, precondition};
    maintenanceExercised = true;
    console.log('QA BLOCK 503: sem bloqueio ou recibo; duas projeções preservadas.');
    return refused;
  }
  if (request.method === 'PUT' && refusedRequest) {
    assert.deepEqual({key, precondition}, refusedRequest);
    while (!(await advanceInboxMaintenance(db, maintenance)).done) {
      // Reabre somente depois do certificado gerado pelo backend.
    }
  }
  const result = await handleBlock(request);
  if (result.status === 200) {
    const {committed, replayed, requestedBlocked, blocked} = await result.clone().json();
    assert.equal(committed, true);
    assert.equal(requestedBlocked, request.method === 'PUT');
    const snapshots = await db.getAll(blockDoc, receipt, ownProjection, peerProjection);
    assert.deepEqual(snapshots.map(snapshot => snapshot.exists), [blocked, true, !blocked, !blocked]);
    if (replayed) {
      console.log('QA BLOCK 200: replay retornou o estado atual e preservou o recibo.');
    } else if (blocked && refusedRequest) {
      refusedRequest = null;
      console.log('QA BLOCK 200: mesma chave e ETag; bloqueio e recibo gravados, duas projeções retiradas.');
    } else {
      console.log('QA BLOCK 200: mutação e recibo gravados; projeções coerentes.');
    }
  }
  return result;
}

const handleMessage = createInboxMessageHttpHandler({db, verifyIdToken, enabled: true});
const contactChat = [clara, contactPeer].sort().join('__');
const acceptedChat = [clara, acceptedPeer].sort().join('__');
const contactPath = '/v1/qa/conversations/requests/' + contactPeer;
const acceptedPath = '/v1/qa/conversations/chats/' + acceptedChat + '/messages';
let pendingContact;
let slowSend;

async function dispatchMessage(request) {
  const pathname = new URL(request.url).pathname;
  if (![contactPath, acceptedPath].includes(pathname) || request.method !== 'POST')
    return handleMessage(request);

  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const actor = await verifyIdToken(token ?? '', true).catch(() => null);
  const key = request.headers.get('idempotency-key');
  if (actor?.uid !== clara || !key) return handleMessage(request);
  const operation = {key, body: await request.clone().text(), pathname};
  const receiptId = createHash('sha256').update(JSON.stringify([clara, key])).digest('hex');
  const receipt = db.doc('serverInboxMessageRequests/' + receiptId);
  const room = db.doc('chats/' + (pathname === contactPath ? contactChat : acceptedChat));
  const quota = db.doc('users/' + clara + '/chatLimits/requests');

  if (JSON.parse(operation.body).text.length > INBOX_TEXT_MAX_UTF16_UNITS) {
    const before = (await db.getAll(room, receipt, quota)).map(snapshot => snapshot.data());
    const response = await handleMessage(request);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.clone().json(), {error: 'invalid_request'});
    const after = (await db.getAll(room, receipt, quota)).map(snapshot => snapshot.data());
    assert.deepEqual(after, before);
    console.log('QA MESSAGE 400: limite UTF-16 recusado sem alteração persistida.');
    return response;
  }

  if (pathname === contactPath && !pendingContact) {
    await beginInboxBackfill(db, 'qa-message-maintenance');
    const response = await handleMessage(request);
    assert.equal(response.status, 503);
    assert.deepEqual((await db.getAll(room, receipt, quota)).map(s => s.exists), [false, false, false]);
    pendingContact = {operation, tested: false};
    console.log('QA MESSAGE 503: sem conversa, quota ou recibo durante manutenção.');
    return response;
  }
  if (pathname === contactPath && !pendingContact.tested) {
    assert.deepEqual(operation, pendingContact.operation);
    while (!(await advanceInboxMaintenance(db, 'qa-message-maintenance')).done) {
      // Reabre somente após a certificação do backend.
    }
    pendingContact.tested = true;
  }

  const response = await handleMessage(request);
  if (response.status !== 200) return response;
  const result = await response.clone().json();
  assert.equal(result.committed, true);
  assert.equal(result.chatId, room.id);
  const [chatSnapshot, messageSnapshot, receiptSnapshot] =
    await db.getAll(room, room.collection('messages').doc(result.messageId), receipt);
  assert.ok(chatSnapshot.exists && messageSnapshot.exists && receiptSnapshot.exists);
  assert.equal(messageSnapshot.get('text'), JSON.parse(operation.body).text);
  if (pathname === contactPath) {
    assert.equal((await quota.get()).get('count'), 1);
    console.log('QA MESSAGE 200: primeiro contato confirmou a intenção e gravou quota uma vez.');
  } else if (!slowSend) {
    assert.equal(result.replayed, false);
    slowSend = {operation, messageId: result.messageId};
    console.log('QA MESSAGE: commit de envio confirmado no Firestore; resposta retida para timeout local.');
    await delay(6_000);
  } else if (key === slowSend.operation.key) {
    assert.deepEqual(operation, slowSend.operation);
    assert.equal(result.messageId, slowSend.messageId);
    assert.equal(result.replayed, true);
    const sent = await room.collection('messages').where('uid', '==', clara).get();
    assert.equal(sent.size, 1);
    console.log('QA MESSAGE 200: retry pós-timeout preservou intenção e messageId; uma gravação.');
  }
  return response;
}

createServer(async (request, response) => {
  try {
    const options = {method: request.method, headers: request.headers};
    if (Number(request.headers['content-length']) > 0 || request.headers['transfer-encoding']) {
      options.body = Readable.toWeb(request);
      options.duplex = 'half';
    }
    const incoming = new Request('http://' + host + ':8091' + request.url, options);
    const path = new URL(incoming.url).pathname;
    const result = path === '/qa/profile-block' ? await profileBlockControl(incoming.method)
      : path.startsWith('/v1/qa/conversations/blocks/') ? await dispatchBlock(incoming)
      : incoming.method === 'POST' ? await dispatchMessage(incoming) : await handleInbox(incoming);
    if (incoming.method === 'GET' && new URL(incoming.url).searchParams.has('cursor') &&
        result.status === 409) console.log('Inbox QA local: HTTP 409 na continuação.');
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(await result.text());
  } catch (error) {
    console.error('Falha na fixture local da inbox:', error.message);
    response.writeHead(500, {'Cache-Control': 'private, no-store'});
    response.end();
  }
}).listen(8091, host, () => console.log('Inbox QA local pronta: descoberta, bloqueio e mensagens autenticadas.'));
