import {createAuthenticatedConversationPushAdmin} from './conversation-push-operator-auth.mjs';
import {conversationPushIdentity} from './conversation-push-policy.mjs';

const ROUTES = new Map([
  ['/v1/qa/conversations/push/admin/admit', 'admit'],
  ['/v1/qa/conversations/push/admin/revoke', 'revoke'],
  ['/v1/qa/conversations/push/admin/publish', 'publish'],
  ['/v1/qa/conversations/age18/admin/issue', 'issueAge18'],
  ['/v1/qa/conversations/age18/admin/consume', 'consumeAge18'],
  ['/v1/qa/conversations/age18/admin/revoke', 'revokeAge18'],
]);
const MAX_BODY_BYTES = 4096;
const FIELDS = {
  admit: ['uid', 'operationKey', 'expectedGeneration', 'expiresAt'],
  revoke: ['uid', 'operationKey', 'expectedGeneration'],
  publish: ['senderUid', 'recipientUid', 'conversationId', 'messageId', 'expiresAt',
    'expectedSenderGeneration', 'expectedRecipientGeneration'],
  issueAge18: ['uid', 'expiresAt', 'reviewExpiresAt'],
  consumeAge18: ['uid', 'tokenId'],
  revokeAge18: ['uid', 'tokenId'],
};
const ERROR_STATUS = new Map([
  ['operator_unauthenticated', 401], ['operator_forbidden', 403],
  ['uid_not_allowed', 403], ['notice_not_authorized', 403],
  ['invalid_admin_request', 400], ['invalid_operation_id', 400],
  ['invalid_expiry', 400], ['invalid_notice', 400], ['expected_generation_required', 400],
  ['invalid_authorization_id', 400], ['age18_authorization_unavailable', 409],
  ['stale_admission_generation', 409], ['stale_publication_generation', 409],
  ['operation_key_reused', 409], ['pending_notice_exists', 409],
]);

function response(status, body, headers) {
  return Response.json(body, {status, headers: {'Cache-Control': 'no-store', ...headers}});
}

async function readJson(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let length = 0;
  let text = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) return {value: JSON.parse(text + decoder.decode())};
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return {tooLarge: true};
      }
      text += decoder.decode(value, {stream: true});
    }
  } finally {
    reader.releaseLock();
  }
}

function parsePayload(action, value) {
  const fields = FIELDS[action];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || !fields.every(field => Object.hasOwn(value, field)))
    return null;

  const payload = {...value};
  for (const field of fields) {
    const item = value[field];
    if (item === null && (field === 'expectedGeneration' ||
        (action === 'admit' && field === 'expiresAt'))) continue;
    if (typeof item !== 'string' || !item.length || item.length > 160) return null;
    if (field === 'expiresAt' || field === 'reviewExpiresAt') {
      const date = new Date(item);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== item) return null;
      payload[field] = date;
    }
  }
  return payload;
}

// Montar no host administrativo HTTPS. O adaptador do host fornece a URL do
// transporte verificado e o Admin SDK do projeto de QA, banco (default).
export function createConversationPushAdminHttpHandler({
  db, auth, serverTimestamp, allowedOperators, enabled = false, now,
} = {}) {
  const gateway = enabled === true ? createAuthenticatedConversationPushAdmin({
    db, auth, serverTimestamp, allowedOperators, now, projectId: conversationPushIdentity.projectId,
  }) : null;

  return async request => {
    const url = new URL(request.url);
    const action = ROUTES.get(url.pathname);
    if (!action || url.search) return response(404, {error: 'not_found'});
    if (!gateway) return response(503, {error: 'admin_closed'});
    if (url.protocol !== 'https:') return response(400, {error: 'https_required'});
    if (request.method !== 'POST') return response(405, {error: 'method_not_allowed'}, {Allow: 'POST'});

    const authorization = request.headers.get('Authorization');
    if (!authorization || authorization.length > 8192)
      return response(401, {error: 'operator_unauthenticated'}, {'WWW-Authenticate': 'Bearer'});
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') ?? ''))
      return response(415, {error: 'unsupported_media_type'});
    if (!request.body) return response(400, {error: 'invalid_admin_request'});

    let payload;
    try {
      const json = await readJson(request.body);
      if (json.tooLarge) return response(413, {error: 'request_too_large'});
      payload = parsePayload(action, json.value);
    } catch {
      return response(400, {error: 'invalid_admin_request'});
    }
    if (!payload) return response(400, {error: 'invalid_admin_request'});

    try {
      return response(200, await gateway.execute({authorization, action, payload}));
    } catch (err) {
      const status = ERROR_STATUS.get(err?.message);
      if (!status) return response(503, {error: 'admin_unavailable'});
      const headers = status === 401 ? {'WWW-Authenticate': 'Bearer'} : undefined;
      return response(status, {error: err.message}, headers);
    }
  };
}
