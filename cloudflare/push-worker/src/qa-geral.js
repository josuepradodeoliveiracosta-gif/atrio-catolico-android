import {handleQaPush, readEventBody} from './index.js';
import {verifyQaInboxIdentity} from './qa-inbox-auth.js';

const QA_PROJECT = 'atrio-catolico-qa-general';
const CONVERSATIONS_PREFIX = '/v1/qa/conversations/';

function conversationsError(error, status) {
  return Response.json({error}, {
    status,
    headers: {'Cache-Control': 'private, no-store'},
  });
}

export function createQaRelay(conversationWorker, conversationsApi) {
  function conversationPush(request, env) {
    if (!conversationWorker || env.QA_CONVERSATION_PUSH_ENABLED !== 'true') {
      return Response.json({status: 'disabled'}, {status: 503});
    }
    return conversationWorker.fetch(request, {
      ATRIO_GENERAL_QA_MODE: 'true',
      ATRIO_GENERAL_QA_PROJECT: QA_PROJECT,
      ATRIO_QA_AGE_POLICY: 'eligible',
      PUSH_ENABLED: 'true',
      PUSH_DB: env.QA_PUSH_DB,
      FIREBASE_SERVICE_ACCOUNT_JSON: env.QA_FIREBASE_SERVICE_ACCOUNT_JSON,
      FIREBASE_WEB_API_KEY: env.QA_FIREBASE_WEB_API_KEY,
    });
  }

  return {
    async fetch(request, env) {
      const {pathname} = new URL(request.url);
      if (pathname.startsWith(CONVERSATIONS_PREFIX)) {
        if (!conversationsApi || env.QA_CONVERSATIONS_API_ENABLED !== 'true') {
          return conversationsError('conversations_unavailable', 503);
        }
        const qaEnv = {
          FIREBASE_WEB_API_KEY: env.QA_FIREBASE_WEB_API_KEY,
          FIREBASE_SERVICE_ACCOUNT_JSON: env.QA_FIREBASE_SERVICE_ACCOUNT_JSON,
        };
        try {
          const uid = await verifyQaInboxIdentity(request, qaEnv);
          if (!uid) return conversationsError('conversations_access_denied', 403);
          const response = await conversationsApi.fetch(request, {
            uid,
            project: QA_PROJECT,
            cursorSecret: env.QA_CONVERSATIONS_CURSOR_KEY,
            ...qaEnv,
          });
          const headers = new Headers(response.headers);
          headers.set('Cache-Control', 'private, no-store');
          return new Response(response.body, {status: response.status, headers});
        } catch {
          return conversationsError('conversations_unavailable', 503);
        }
      }

      if (request.method === 'GET' && pathname === '/notice') {
        return conversationPush(request, env);
      }
      if (request.method !== 'POST' || pathname !== '/event') {
        return handleQaPush(request, env);
      }

      let event;
      try {
        event = await readEventBody(request);
      } catch (error) {
        const tooLarge = error instanceof RangeError;
        return Response.json({status: tooLarge ? 'too_large' : 'invalid_json'},
          {status: tooLarge ? 413 : 400});
      }

      const headers = new Headers(request.headers);
      headers.delete('content-length');
      const forwarded = new Request(request.url, {
        method: request.method,
        headers,
        body: JSON.stringify(event),
      });
      return event?.type === 'chat_message'
        ? conversationPush(forwarded, env)
        : handleQaPush(forwarded, env);
    },
  };
}

export default createQaRelay();
