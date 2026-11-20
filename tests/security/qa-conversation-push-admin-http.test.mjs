import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {deleteApp, initializeApp} from 'firebase-admin/app';
import {FieldValue, getFirestore} from 'firebase-admin/firestore';
import {createConversationPushAdminHttpHandler}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-admin-http.mjs';
import {conversationPushIdentity}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';

assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d+$/);
assert.equal(process.env.GCLOUD_PROJECT, 'demo-atrio-v11');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
const app = initializeApp({projectId: 'demo-atrio-v11'}, 'qa-admin-http-199');
const db = getFirestore(app);
const origin = 'https://admin.qa.invalid';
const path = '/v1/qa/conversations/push/admin/';
const [senderUid, recipientUid] = Object.keys(conversationPushIdentity.accounts);
const admission = uid => db.doc(`users/${uid}/chatPushAdmission/current`);
const pending = db.doc(`users/${recipientUid}/chatPushPending/current`);
const operator = 'fixture-admission-operator';
const publisher = 'fixture-notice-publisher';
const operatorClaims = {
  aud: conversationPushIdentity.projectId, email_verified: true,
  firebase: {sign_in_provider: 'password'},
};
const tokens = new Map([
  ['operator', {...operatorClaims, uid: operator, atrioQaPushCapabilities: ['manage_admissions']}],
  ['publisher', {...operatorClaims, uid: publisher, atrioQaPushCapabilities: ['publish_notices']}],
  ['ordinary', {...operatorClaims, uid: senderUid, atrioQaPushCapabilities: ['manage_admissions']}],
  ['unclaimed', {...operatorClaims, uid: operator}],
  ['wrong_project', {...operatorClaims, aud: 'another-project', uid: operator,
    atrioQaPushCapabilities: ['manage_admissions']}],
]);
let tokenChecks = 0;
const auth = {
  async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true);
    tokenChecks++;
    if (!tokens.has(token)) throw Error('auth/id-token-revoked');
    return tokens.get(token);
  },
};
const enabled = createConversationPushAdminHttpHandler({
  db, auth, serverTimestamp: () => FieldValue.serverTimestamp(), enabled: true,
  allowedOperators: {[operator]: ['manage_admissions'], [publisher]: ['publish_notices']},
});
const closed = createConversationPushAdminHttpHandler();
const send = (handler, action, payload, token, options = {}) => {
  const headers = {'Content-Type': 'application/json', ...options.headers};
  if (token) headers.Authorization = `Bearer ${token}`;
  return handler(new Request(options.url ?? origin + path + action, {
    method: options.method ?? 'POST', headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }));
};
const expires = duration => new Date(Date.now() + duration).toISOString();
const grant = (uid, expectedGeneration, operationKey) => ({
  uid, expectedGeneration, operationKey, expiresAt: expires(180_000),
});

try {
  await test('superfície fechada ou indevida não autentica, altera admissão ou publica aviso', async () => {
    const operationKey = 'http_closed_001';
    const oldPending = (await pending.get()).data();
    const oldAdmission = (await admission(senderUid).get()).data();
    const payload = grant(senderUid, oldAdmission?.generation ?? null, operationKey);
    const before = tokenChecks;
    const response = await send(closed, 'admit', payload, 'operator');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {error: 'admin_closed'});
    assert.equal((await send(closed, 'publish', {}, 'publisher')).status, 503);
    assert.equal((await send(enabled, '', undefined, 'operator',
      {url: origin + '/notice', method: 'GET'})).status, 404);
    assert.equal((await send(enabled, 'admit', payload, 'operator',
      {url: 'http://admin.qa.invalid' + path + 'admit', headers: {'X-Forwarded-Proto': 'https'}})).status, 400);
    assert.equal((await send(enabled, 'revoke', undefined, 'operator', {method: 'GET'})).status, 405);
    assert.equal((await send(enabled, 'revoke?uid=someone', {}, 'operator')).status, 404);
    assert.equal((await send(enabled, 'admit', {...payload, principal: operator}, 'operator')).status, 400);
    assert.equal((await send(enabled, 'admit', {...payload, expiresAt: '2026-02-30T00:00:00.000Z'}, 'operator')).status, 400);
    assert.equal((await send(enabled, 'admit', 'x'.repeat(4096), 'operator')).status, 413);
    assert.equal((await send(enabled, 'admit', payload, 'operator',
      {headers: {'Content-Type': 'text/plain'}})).status, 415);
    assert.equal((await send(enabled, 'admit', payload, undefined,
      {headers: {'X-Operator-UID': operator}})).status, 401);
    assert.equal(tokenChecks, before);
    assert.deepEqual((await pending.get()).data(), oldPending);
    assert.deepEqual((await admission(senderUid).get()).data(), oldAdmission);
    assert.equal((await db.doc(`users/${senderUid}/chatPushAdminOperations/${operationKey}`).get()).exists, false);
  });

  await test('fronteira HTTPS separa capacidades e o serviço persiste os operadores autenticados', async () => {
    const current = uid => admission(uid).get().then(snap => snap.data()?.generation ?? null);
    const payload = grant(senderUid, await current(senderUid), 'http_admit_sender');
    for (const token of ['revoked', 'wrong_project']) {
      const result = await send(enabled, 'admit', payload, token);
      assert.equal(result.status, 401);
      assert.equal(result.headers.get('WWW-Authenticate'), 'Bearer');
    }
    for (const token of ['ordinary', 'unclaimed', 'publisher'])
      assert.equal((await send(enabled, 'admit', payload, token)).status, 403);
    assert.equal((await current(senderUid)), payload.expectedGeneration);

    const granted = await send(enabled, 'admit', payload, 'operator');
    assert.equal(granted.status, 200);
    const left = await granted.json();
    assert.equal(left.replay, false);
    assert.equal((await db.doc(`users/${senderUid}/chatPushAdminOperations/${payload.operationKey}`).get())
      .data().operatorUid, operator);
    const repeated = await send(enabled, 'admit', payload, 'operator');
    assert.deepEqual(await repeated.json(), {...left, replay: true});
    const other = await send(enabled, 'admit', grant(recipientUid, await current(recipientUid), 'http_admit_recipient'), 'operator');
    assert.equal(other.status, 200);
    const right = await other.json();

    const conversationId = 'qa-admin-http-canonical';
    const messageId = 'http_message_01';
    const room = db.doc(`chats/${conversationId}`);
    await delay(10);
    await room.set({participants: [senderUid, recipientUid], status: 'accepted',
      lastMessageId: messageId, lastSenderUid: senderUid});
    await room.collection('messages').doc(messageId).set({uid: senderUid, createdAt: FieldValue.serverTimestamp()});
    const publish = {senderUid, recipientUid, conversationId, messageId, expiresAt: expires(60_000),
      expectedSenderGeneration: left.generation, expectedRecipientGeneration: right.generation};
    assert.equal((await send(enabled, 'publish', publish, 'operator')).status, 403);
    assert.equal((await send(enabled, 'publish', {...publish, messageId: 'absent'}, 'publisher')).status, 403);
    assert.equal((await send(enabled, 'publish', publish, 'publisher')).status, 200);
    assert.equal((await pending.get()).data().messageId, messageId);
    const receipts = await db.collection(`users/${recipientUid}/chatPushPublicationReceipts`).get();
    assert.ok(receipts.docs.some(row => row.data().operatorUid === publisher &&
      row.data().recipientGeneration === right.generation));

    const revoke = {uid: recipientUid, expectedGeneration: right.generation, operationKey: 'http_revoke_recipient'};
    assert.equal((await send(enabled, 'revoke', revoke, 'publisher')).status, 403);
    assert.equal((await send(enabled, 'revoke', revoke, 'operator')).status, 200);
    assert.equal((await admission(recipientUid).get()).data().status, 'revoked');
    assert.equal((await send(enabled, 'publish', publish, 'publisher')).status, 403);
    assert.equal((await room.collection('messages').doc(messageId).get()).exists, true);
  });
} finally {
  await deleteApp(app);
}
