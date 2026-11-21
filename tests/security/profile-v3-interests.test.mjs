import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails} from '@firebase/rules-unit-testing';
import {deleteApp, initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {
  deleteDoc, doc, getDoc, runTransaction, serverTimestamp, setDoc, Timestamp,
} from 'firebase/firestore';
import worker from '../../cloudflare/push-worker/src/index.js';

const projectId = 'demo-atrio-v11';
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8089');
const nativeFetch = globalThis.fetch;
const authRoot = 'http://127.0.0.1:9099';
const firestoreRoot = 'http://127.0.0.1:8089/v1/projects/' + projectId + '/databases/(default)/documents';
const env = await initializeTestEnvironment({
  projectId, firestore:{host:'127.0.0.1', port:8089, rules:readFileSync('firestore.rules','utf8')},
});
const admin = initializeApp({projectId});
const uid = 'qa-owner';
const authorUid = 'qa-author';
const owner = env.authenticatedContext(uid, {email_verified:true}).firestore();
const visitor = env.authenticatedContext('qa-visitor', {email_verified:true}).firestore();
const profilePath = 'public_profiles/' + uid;
const privatePath = 'users/' + uid + '/private/profile_v3';
const prefsPath = 'users/' + uid + '/private/preferences';
const linkPath = profilePath + '/interest_discussions/current';
const postId = 'qa-selected-discussion';
const title = 'Discussão escolhida para QA';
const joinedAt = Timestamp.fromMillis(1000);
const publicBase = {displayName:'Titular QA', bio:'Apresentação anterior', joinedAt};
const profileBase = {
  saint:'', devotionPhrase:'', ageBand:'', maritalStatus:'', visibleFields:[],
  consentVersion:'perfil-v3-2026-11',
};
const prefs = {
  interests:['Oração','Formação','Comunidade'], participation:'Leigo(a)', city:'Cidade fictícia',
  parish:'', consentVersion:'cadastro-v2-2026-11', consentAt:joinedAt, updatedAt:joinedAt,
};
const rawQuestion = '  ' + 'á🔔'.repeat(70) + '  ';
const question = rawQuestion.trim();
const unavailable = {status:'unavailable'};
const profileRef = doc(owner, profilePath);
const privateRef = doc(owner, privatePath);
const linkRef = doc(owner, linkPath);

async function writeInterests(visible, details, {skipPublic = false, skipLinks = false} = {}) {
  return runTransaction(owner, async tx => {
    const previousLinks = await tx.get(linkRef);
    const interestQuestions = {};
    const postIds = {};
    for (const [key, entry] of Object.entries(details)) {
      if ('question' in entry) interestQuestions[key] = entry.question;
      if ('postId' in entry) postIds[key] = entry.postId;
    }
    tx.set(privateRef, {...profileBase, publicInterests:visible, interestDetails:details,
      consentAt:serverTimestamp(), updatedAt:serverTimestamp()});
    if (!skipPublic) {
      const projection = {...publicBase, updatedAt:serverTimestamp()};
      if (visible.length) projection.interests = visible;
      if (Object.keys(interestQuestions).length) projection.interestQuestions = interestQuestions;
      tx.set(profileRef, projection);
    }
    if (!skipLinks) {
      if (Object.keys(postIds).length) tx.set(linkRef, {postIds});
      else if (previousLinks.exists()) tx.delete(linkRef);
    }
  });
}

async function visitorToken(userUid, emailVerified) {
  const email = userUid + '@example.test';
  const password = 'senha-ficticia-da-suite-local';
  await getAuth(admin).createUser({uid:userUid, email, password, emailVerified});
  const response = await nativeFetch(authRoot +
    '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-qa-key', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email,password,returnSecureToken:true}),
  });
  assert.equal(response.status, 200);
  return (await response.json()).idToken;
}

const {privateKey} = generateKeyPairSync('rsa', {modulusLength:2048});
const workerEnv = {
  PROFILE_V3_DISCUSSIONS_ENABLED:'true',
  FIREBASE_WEB_API_KEY:'fake-qa-key',
  FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({
    project_id:'atrio-catolico', client_email:'emulator@example.test',
    private_key:privateKey.export({format:'pem',type:'pkcs8'}),
  }),
};
let failPostRead = false;
let beforePostRead;
let visitorPostReads = 0;
async function resolve(token, interestKey = 'oracao') {
  const response = await worker.fetch(new Request('https://example.test/profile-v3/interest-discussion', {
    method:'POST', headers:{Authorization:'Bearer ' + token},
    body:JSON.stringify({profileUid:uid,interestKey}),
  }), workerEnv);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  return response.json();
}

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await Promise.all([
      setDoc(doc(db, 'profiles/' + uid), {displayName:publicBase.displayName,bio:publicBase.bio,createdAt:joinedAt}),
      setDoc(doc(db, prefsPath), prefs),
      setDoc(doc(db, profilePath), {...publicBase,updatedAt:joinedAt}),
      setDoc(doc(db, 'app_config/email_verification'), {enabled:true,version:'2026-11-v1'}),
      ...[postId,'qa-discussion-2','qa-discussion-3'].map(id => setDoc(doc(db,'posts/' + id), {
        uid:authorUid, title, authorName:'Autor QA', body:'Texto fictício', category:'Pedidos de oração',
        createdAt:joinedAt,
      })),
    ]);
  });
  const permitted = await visitorToken('qa-visitor', true);
  const refused = await visitorToken('qa-no-email', false);
  globalThis.fetch = async (input, init) => {
    const target = new URL(input);
    if (target.origin === 'https://identitytoolkit.googleapis.com') {
      return nativeFetch(authRoot + '/identitytoolkit.googleapis.com' + target.pathname + target.search, init);
    }
    if (target.origin === 'https://oauth2.googleapis.com' && target.pathname === '/token') {
      return Response.json({access_token:'owner',expires_in:3600});
    }
    assert.equal(target.origin, 'https://firestore.googleapis.com');
    const path = target.pathname.split('/documents/')[1];
    assert.ok(path);
    if (init.headers.Authorization === 'Bearer owner') assert.equal(path, linkPath);
    if (path.startsWith('posts/')) {
      visitorPostReads++;
      assert.ok(['Bearer ' + permitted,'Bearer ' + refused].includes(init.headers.Authorization));
      if (failPostRead) return new Response(null, {status:503});
      if (beforePostRead) await beforePostRead();
    }
    return nativeFetch(firestoreRoot + '/' + path, init);
  };

  const visible = ['Oração','Formação','Comunidade'];
  const threeLinks = {oracao:{question,postId},formacao:{postId:'qa-discussion-2'},
    comunidade:{question:'Pergunta que fica',postId:'qa-discussion-3'}};
  assert.equal(Array.from(question).length, 140);
  await writeInterests(visible, threeLinks);
  assert.equal((await getDoc(doc(visitor,profilePath))).data().interestQuestions.oracao, question);
  for (const bad of [question + 'a', ' ', ' ' + question, question + ' ', '\v' + question]) {
    await assertFails(writeInterests(visible,{...threeLinks,oracao:{...threeLinks.oracao,question:bad}}));
  }
  await assertFails(writeInterests(visible,{...threeLinks,oracao:{question,postId:'qa-missing'}}));
  await assertFails(writeInterests(visible,{...threeLinks,noticias_catolicas:{question}}));
  await assertFails(setDoc(doc(visitor,linkPath), {postIds:{oracao:postId}}));
  await assertFails(setDoc(profileRef,{...publicBase,interests:visible,updatedAt:serverTimestamp()}));
  assert.equal((await getDoc(doc(visitor,profilePath))).data().interestQuestions.oracao, question);
  console.log('PASS 140 caracteres Unicode normalizados; 141, vazio e espaços externos recusados na escrita bruta');

  await assertFails(getDoc(doc(visitor,linkPath)));
  assert.deepEqual(await resolve(permitted), {status:'available',postId,title});
  const readsBeforeDenial = visitorPostReads;
  assert.deepEqual(await resolve(refused), unavailable);
  assert.equal(visitorPostReads, readsBeforeDenial + 1);
  assert.deepEqual(await resolve(''), unavailable);
  failPostRead = true;
  assert.deepEqual(await resolve(permitted), unavailable);
  failPostRead = false;
  await setDoc(doc(visitor,'users/qa-visitor/blockedMembers/' + authorUid), {createdAt:serverTimestamp()});
  assert.deepEqual(await resolve(permitted), unavailable);
  await deleteDoc(doc(visitor,'users/qa-visitor/blockedMembers/' + authorUid));
  console.log('PASS rota Worker com Auth/Firestore Emulator; ID e título somente para leitura confirmada');

  const prefsBefore = (await getDoc(doc(owner,prefsPath))).data();
  const remaining = {formacao:threeLinks.formacao, comunidade:threeLinks.comunidade};
  await assertFails(writeInterests(['Formação','Comunidade'],remaining,{skipPublic:true}));
  await assertFails(writeInterests(['Formação','Comunidade'],remaining,{skipLinks:true}));
  assert.equal((await getDoc(privateRef)).data().interestDetails.oracao.question, question);
  assert.deepEqual(await resolve(permitted), {status:'available',postId,title});
  beforePostRead = async () => {
    beforePostRead = undefined;
    await writeInterests(['Formação','Comunidade'],remaining);
  };
  assert.deepEqual(await resolve(permitted), unavailable);
  assert.deepEqual((await getDoc(privateRef)).data().interestDetails, remaining);
  assert.deepEqual((await getDoc(profileRef)).data().interests, ['Formação','Comunidade']);
  assert.equal((await getDoc(profileRef)).data().interestQuestions.oracao, undefined);
  assert.deepEqual((await getDoc(linkRef)).data().postIds,
    {formacao:'qa-discussion-2',comunidade:'qa-discussion-3'});
  assert.deepEqual((await getDoc(doc(owner,prefsPath))).data(), prefsBefore);
  assert.equal((await getDoc(profileRef)).data().bio, publicBase.bio);
  await writeInterests(visible,remaining);
  assert.deepEqual(await resolve(permitted), {status:'no_link'});
  assert.deepEqual((await getDoc(doc(owner,prefsPath))).data(), prefsBefore);
  await writeInterests([],{});
  assert.equal((await getDoc(linkRef)).exists(), false);
  assert.equal((await getDoc(profileRef)).data().interestQuestions, undefined);
  assert.deepEqual((await getDoc(doc(owner,prefsPath))).data(), prefsBefore);
  console.log('PASS ocultação atômica, recusa de escritas parciais, V2 preservado e reexibição sem detalhes');

  await writeInterests(visible,threeLinks);
  await env.withSecurityRulesDisabled(ctx => deleteDoc(doc(ctx.firestore(),'posts/' + postId)));
  assert.deepEqual(await resolve(permitted), unavailable);
  await assertFails(deleteDoc(privateRef));
  await assertFails(deleteDoc(profileRef));
  await runTransaction(owner, async tx => {
    tx.delete(privateRef);
    tx.delete(linkRef);
    tx.set(profileRef,{...publicBase,updatedAt:serverTimestamp()});
  });
  assert.equal((await getDoc(privateRef)).exists(), false);
  assert.equal((await getDoc(linkRef)).exists(), false);
  assert.equal((await getDoc(profileRef)).data().interestQuestions, undefined);
  assert.deepEqual((await getDoc(doc(owner,prefsPath))).data(), prefsBefore);
  console.log('PASS discussão excluída sem metadados e revogação V3 integral com Cadastro V2 intacto');

  await deleteDoc(profileRef);
  await assertFails(writeInterests(['Oração'],{oracao:{postId}},{skipPublic:true,skipLinks:true}));
  await writeInterests(['Oração'],{oracao:{question,postId:'qa-discussion-2'}},
    {skipPublic:true,skipLinks:true});
  assert.equal((await getDoc(profileRef)).exists(), false);
  assert.equal((await getDoc(linkRef)).exists(), false);
  assert.deepEqual(await resolve(permitted), unavailable);
  console.log('PASS edição privada sem apresentação e recusa de vínculo novo inexistente');
} finally {
  globalThis.fetch = nativeFetch;
  await env.cleanup();
  await deleteApp(admin);
}
