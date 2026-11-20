// Executa o Worker candidato com Auth e Firestore Emulator. Nunca encaminha à rede externa.
import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {renderConversationPushPilotWorker}
  from '../../cloudflare/push-worker/scripts/conversation-push-pilot.mjs';
import {conversationPushIdentity as pilot}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
import {projectId as demoProject} from '../../firebase/qa-geral-celular/pilot/fixtures.mjs';

const host = '127.0.0.1';
const auth = 'http://' + host + ':9099/identitytoolkit.googleapis.com/v1';
const firestore = 'http://' + host + ':8089';
const root = '/v1/projects/' + pilot.projectId + '/databases/(default)/documents';
const demoRoot = root.replace(pilot.projectId, demoProject);
const source = renderConversationPushPilotWorker(readFileSync(
  new URL('../../cloudflare/push-worker/src/index.js', import.meta.url), 'utf8'));
const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;

const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const env = {
  ATRIO_GENERAL_QA_MODE: 'true', ATRIO_GENERAL_QA_PROJECT: pilot.projectId,
  ATRIO_QA_AGE_POLICY: pilot.ageMode, PUSH_ENABLED: 'true', FIREBASE_WEB_API_KEY: 'fixture',
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    project_id: pilot.projectId, client_email: 'fixture@' + pilot.projectId + '.iam.gserviceaccount.com',
    private_key: privateKey.export({type: 'pkcs8', format: 'pem'}),
  }),
  PUSH_DB: {
    prepare(sql) {
      assert.match(sql, /^SELECT project_id FROM atrio_qa_identity /);
      return {bind: name => ({first: () =>
        name === 'atrio-qa-conversations-pilot' ? {project_id: pilot.projectId} : null})};
    },
  },
};

const emulatorTokens = new Map();
const localFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  assert.equal(init.redirect, 'error');
  const localOptions = {...init, signal: AbortSignal.timeout(1800)};
  if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token')
    return Response.json({access_token: 'fixture', expires_in: 3600});
  if (url.origin === 'https://identitytoolkit.googleapis.com') {
    if (url.pathname === '/v1/accounts:lookup') {
      const idToken = emulatorTokens.get(JSON.parse(init.body).idToken);
      if (!idToken) return new Response(null, {status: 401});
      return localFetch(auth + '/accounts:lookup?key=fixture',
        {...localOptions, body: JSON.stringify({idToken})});
    }
    if (url.pathname === '/v1/projects/' + pilot.projectId + '/accounts:lookup') {
      return localFetch(auth + '/projects/' + demoProject + '/accounts:lookup', {
        ...localOptions, headers: {Authorization: 'Bearer owner', 'Content-Type': 'application/json'},
      });
    }
  }
  assert.equal(url.origin, 'https://firestore.googleapis.com');
  assert.ok(url.pathname.startsWith(root));
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer owner');
  const local = await localFetch(firestore + url.pathname.replace(root, demoRoot), {
    ...localOptions, headers,
    body: init.body?.replaceAll('projects/' + pilot.projectId, 'projects/' + demoProject),
  });
  return new Response((await local.text()).replaceAll('projects/' + demoProject, 'projects/' + pilot.projectId),
    {status: local.status, headers: {'Content-Type': 'application/json'}});
};

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const bridgePrefix = b64({alg: 'RS256'}) + '.' + b64({
  aud: pilot.projectId, iss: 'https://securetoken.google.com/' + pilot.projectId,
});
createServer(async (incoming, outgoing) => {
  if (incoming.method === 'GET' && incoming.url === '/ready') {
    outgoing.writeHead(204).end();
    return;
  }
  if (incoming.method !== 'GET' || incoming.url !== '/notice') {
    outgoing.writeHead(404).end();
    return;
  }
  const bearer = /^Bearer ([A-Za-z0-9._-]{100,5000})$/.exec(incoming.headers.authorization ?? '');
  if (!bearer) {
    outgoing.writeHead(401).end();
    return;
  }
  // Traduz só o transporte do JWT para o gate de projeto; o Auth Emulator valida o token original.
  const bridgeToken = bridgePrefix + '.' + randomUUID();
  emulatorTokens.set(bridgeToken, bearer[1]);
  try {
    const result = await worker.fetch(new Request('https://qa.invalid/notice', {
      headers: {Authorization: 'Bearer ' + bridgeToken},
    }), env);
    outgoing.writeHead(result.status, Object.fromEntries(result.headers)).end(await result.text());
  } catch {
    outgoing.writeHead(503).end();
  } finally {
    emulatorTokens.delete(bridgeToken);
  }
}).listen(8092, host, () => console.log('Worker de avisos QA em loopback'));
