/**
 * Fixture manual #355. Requer uma composição com a #359 e dois emuladores
 * locais limpos. Subir somente em 127.0.0.1; o Android usa adb reverse.
 */
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {Firestore, Timestamp} from '@google-cloud/firestore';
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
  // Validação por lookup do emulador, exclusiva para tokens QA fictícios.
  async verifyIdToken(idToken, revoked) {
    if (revoked !== true) throw new Error('Revogação precisa ser solicitada.');
    const {users} = await authRequest('/accounts:lookup?key=local-emulator-test', {idToken});
    const account = users?.[0];
    if (!account || account.disabled || ![clara, miguel, lucia].includes(account.localId))
      throw new Error('Token fora da fixture.');
    return {uid: account.localId, email_verified: account.emailVerified === true};
  },
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
createServer(async (request, response) => {
  try {
    const result = await handleInbox(new Request('http://' + host + ':8091' + request.url, {
      method: request.method, headers: request.headers
    }));
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(await result.text());
  } catch {
    response.writeHead(503, {'Cache-Control': 'private, no-store'});
    response.end('{"error":"inbox_unavailable"}');
  }
}).listen(8091, host, () => console.log('Inbox QA local pronta: Clara 43 com mudança de revisão, Miguel 0, Lúcia 503.'));
