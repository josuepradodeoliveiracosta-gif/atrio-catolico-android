import {handleQaPush, readEventBody} from './index.js';

function conversationPush(request, env) {
  if (!env.QA_CONVERSATION_PUSH) {
    return Response.json({status: 'disabled'}, {status: 503});
  }
  return env.QA_CONVERSATION_PUSH.fetch(request);
}

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);
    if (request.method === 'GET' && pathname === '/notice') {
      return conversationPush(request, env);
    }
    if (request.method !== 'POST' || pathname !== '/event' || !env.QA_CONVERSATION_PUSH) {
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
