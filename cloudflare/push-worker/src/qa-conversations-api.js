import {Buffer} from 'node:buffer';
import {getQaFirestoreAccessToken} from './index.js';
import {createQaInboxFirestore} from './qa-inbox-store.js';
import {
  createAdminInboxStore,
  createAuthorizedInboxService,
  createInboxHttpHandler,
} from '../../../firebase/qa-general/chat-inbox-discovery-server.mjs';

import {createInboxBlockHttpHandler} from '../../../firebase/qa-general/chat-inbox-block-http.mjs';
import {createInboxMessageHttpHandler} from '../../../firebase/qa-general/chat-inbox-message-http.mjs';

export default {
  async fetch(request, {uid, project, cursorSecret, ...firebaseEnv}) {
    const {pathname} = new URL(request.url);
    const inbox = pathname === '/v1/qa/conversations/inbox';
    const block = pathname.startsWith('/v1/qa/conversations/blocks/');
    const message = pathname.startsWith('/v1/qa/conversations/requests/') ||
      /^[/]v1[/]qa[/]conversations[/]chats[/][^/]+[/](?:messages|decision)$/.test(pathname);
    if (!inbox && !block && !message) {
      return Response.json({error: 'not_found'}, {status: 404});
    }
    if (inbox && request.method !== 'GET') {
      return Response.json({error: 'method_not_allowed'}, {
        status: 405, headers: {Allow: 'GET'},
      });
    }
    if (project !== 'atrio-catolico-qa-general' ||
        typeof cursorSecret !== 'string' || !/^[0-9a-f]{64}$/i.test(cursorSecret)) {
      return Response.json({error: 'inbox_unavailable'}, {status: 503});
    }

    // The relay has already authenticated this exact request against QA Auth.
    const token = request.headers.get('authorization')?.slice(7);
    const db = createQaInboxFirestore(await getQaFirestoreAccessToken(firebaseEnv));
    const verifyIdToken = async candidate => candidate === token && token
      ? {uid, email_verified: true} : null;

    if (block || message) {
      const createHandler = block ? createInboxBlockHttpHandler : createInboxMessageHttpHandler;
      return createHandler({db, verifyIdToken, enabled: true})(request);
    }

    const service = createAuthorizedInboxService({
      verifyIdToken,
      store: createAdminInboxStore(db),
      cursorKey: Buffer.from(cursorSecret, 'hex'),
    });
    return createInboxHttpHandler(service, {enabled: true})(request);
  },
};
