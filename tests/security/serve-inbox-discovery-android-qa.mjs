/**
 * Fixture manual #355. Requer uma composição com a #359 e dois emuladores
 * locais limpos. Subir somente em 127.0.0.1; o Android usa adb reverse.
 */
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {Firestore, Timestamp} from '@google-cloud/firestore';
import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {createInboxBlockHttpHandler} from '../../firebase/qa-general/chat-inbox-block-http.mjs';
import {
  createAdminInboxStore, createAuthorizedInboxService, createInboxHttpHandler
} from '../../firebase/qa-general/chat-inbox-discovery-server.mjs';
import {
  advanceInboxMaintenance, beginInboxBackfill, writeInboxBlock
} from '../../firebase/qa-general/chat-inbox-maintenance.mjs';

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
for (let index = 1; index <= 43; index++) {
  const suffix = String(index).padStart(2, '0');
  const peer = 'qa-inbox-peer-' + suffix;
  const chatId = [clara, peer].sort().join('__');
  seedAge(batch, peer, Timestamp.fromMillis(expiresAt.toMillis() + index * 1000));
  batch.set(db.doc('public_profiles/' + peer), {uid: peer, displayName: 'Par QA ' + suffix});
  batch.set(db.doc('chats/' + chatId), {
    participants: [clara, peer], requesterUid: clara, recipientUid: peer,
    status: 'accepted', lastPreview: 'Prévia QA ' + suffix, lastSenderUid: clara,
    unreadRequester: 0, unreadRecipient: 0, updatedAt: Timestamp.fromMillis(now + index)
  });
}
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
      if (uid === clara && after) {
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

async function dispatchBlock(request) {
  const url = new URL(request.url);
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

createServer(async (request, response) => {
  try {
    const options = {method: request.method, headers: request.headers};
    if (Number(request.headers['content-length']) > 0 || request.headers['transfer-encoding']) {
      options.body = Readable.toWeb(request);
      options.duplex = 'half';
    }
    const incoming = new Request('http://' + host + ':8091' + request.url, options);
    const result = new URL(incoming.url).pathname.startsWith('/v1/qa/conversations/blocks/')
      ? await dispatchBlock(incoming) : await handleInbox(incoming);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(await result.text());
  } catch (error) {
    console.error('Falha na fixture local da inbox:', error.message);
    response.writeHead(500, {'Cache-Control': 'private, no-store'});
    response.end();
  }
}).listen(8091, host, () => console.log('Inbox QA local pronta: descoberta e bloqueio autenticado.'));
