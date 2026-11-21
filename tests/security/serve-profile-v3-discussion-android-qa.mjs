import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore, Timestamp} from 'firebase-admin/firestore';
import worker from '../../cloudflare/push-worker/src/index.js';

const projectId = 'demo-atrio-v11';
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8089');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);

const [keyFile, certFile] = process.argv.slice(2);
const tls = {key:readFileSync(keyFile), cert:readFileSync(certFile)};
const app = initializeApp({projectId});
const auth = getAuth(app);
const db = getFirestore(app);
const profileUid = 'qa-v3-http-profile';
const chosen = 'qa-v3-http-z-escolhida';
const decoy = 'qa-v3-http-a-outra';
const author = 'qa-v3-http-author';
const permitted = 'qa-v3-http-permitted';
const refused = 'qa-v3-http-refused';
const password = 'SenhaSomenteNoEmulador42!';
const post = {
  uid:author, authorName:'Autor fictício', category:'Pedidos de oração',
  createdAt:Timestamp.fromMillis(1000),
};

await Promise.all([
  auth.createUser({uid:permitted,email:permitted+'@qa.invalid',password,emailVerified:true}),
  auth.createUser({uid:refused,email:refused+'@qa.invalid',password,emailVerified:false}),
  db.doc('app_config/email_verification').set({enabled:true,version:'2026-11-v1'}),
  db.doc('public_profiles/'+profileUid).set({
    displayName:'Perfil fictício do vínculo', bio:'Apresentação fictícia',
    interests:['Oração'], interestQuestions:{oracao:'Como começar a rezar?'},
    joinedAt:post.createdAt, updatedAt:post.createdAt,
  }),
  db.doc('public_profiles/'+profileUid+'/interest_discussions/current').set({postIds:{oracao:chosen}}),
  db.doc('posts/'+chosen).set({
    ...post, title:'Discussão exata escolhida', body:'Texto do destino exato no Firestore Emulator.',
  }),
  db.doc('posts/'+decoy).set({
    ...post, title:'Outra discussão da mesma categoria', body:'Este destino não foi vinculado.',
  }),
]);

const {privateKey} = generateKeyPairSync('rsa', {modulusLength:2048});
const workerEnv = {
  PROFILE_V3_DISCUSSIONS_ENABLED:'true',
  FIREBASE_WEB_API_KEY:'qa-local-key',
  FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({
    project_id:'atrio-catolico', client_email:'emulator@example.test',
    private_key:privateKey.export({format:'pem',type:'pkcs8'}),
  }),
};
const traces = new AsyncLocalStorage();
const realFetch = globalThis.fetch;
const linkPath = 'public_profiles/'+profileUid+'/interest_discussions/current';
const firestoreBase = '/v1/projects/atrio-catolico/databases/(default)/documents/';
const emulatorBase = 'http://127.0.0.1:8089/v1/projects/'+projectId+'/databases/(default)/documents/';

globalThis.fetch = async (input, init) => {
  const target = new URL(input);
  const trace = traces.getStore();
  assert.ok(trace, 'Leitura fora da requisição local');
  if (target.origin === 'https://identitytoolkit.googleapis.com' &&
      target.pathname === '/v1/accounts:lookup') {
    const result = await realFetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com' +
      target.pathname + target.search, init);
    if (result.ok) trace.uid = (await result.clone().json()).users?.[0]?.localId;
    return result;
  }
  if (target.href === 'https://oauth2.googleapis.com/token') {
    return Response.json({access_token:'owner',expires_in:3600});
  }
  assert.equal(target.origin,'https://firestore.googleapis.com');
  assert.ok(target.pathname.startsWith(firestoreBase));
  const path = target.pathname.slice(firestoreBase.length);
  const isService = new Headers(init?.headers).get('Authorization') === 'Bearer owner';
  if (isService) assert.equal(path, linkPath, 'OAuth fictício restrito ao vínculo');
  else assert.ok([permitted,refused].includes(trace.uid));
  const result = await realFetch(emulatorBase + path + target.search, init);
  if (path.startsWith('posts/')) {
    assert.ok(!isService);
    assert.equal(path,'posts/'+chosen);
    trace.postStatus = result.status;
  }
  return result;
};

createServer(tls, async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200).end('ready');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/profile-v3/interest-discussion') {
    res.writeHead(404).end();
    return;
  }
  const trace = {};
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    const request = new Request('https://127.0.0.1:8094'+req.url, {
      method:req.method, headers:req.headers, body:Buffer.concat(chunks),
    });
    const response = await traces.run(trace, () => worker.fetch(request,workerEnv));
    const payload = await response.text();
    const state = JSON.parse(payload);
    if (trace.uid === permitted && trace.postStatus === 200 &&
        state.status === 'available' && state.postId === chosen) {
      console.log('visitor=authorized firestore=200 result=available exact_id='+chosen);
    } else if (trace.uid === refused && trace.postStatus === 403 &&
        state.status === 'unavailable' && Object.keys(state).length === 1) {
      console.log('visitor=denied firestore=403 result=unavailable without_metadata');
    } else {
      console.error('Unexpected authorization or response in the local Worker');
    }
    res.writeHead(response.status,Object.fromEntries(response.headers)).end(payload);
  } catch {
    console.error('Local Worker request failed');
    res.writeHead(500).end();
  }
}).listen(8094,'127.0.0.1', () => console.log('Profile V3 Worker listening on HTTPS loopback'));
