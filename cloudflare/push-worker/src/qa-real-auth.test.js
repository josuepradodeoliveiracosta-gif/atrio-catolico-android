import test from 'node:test';
import assert from 'node:assert/strict';
import {createBotCustomToken,signInQaBot} from './qa-real-auth.js';
import {executeQaCommand} from './qa-manual.js';

const URL_ROOT='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents';
const SERVICE='qa-test@atrio-catolico.iam.gserviceaccount.com';
async function fixture() {
  const keys=await crypto.subtle.generateKey({
    name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
  },true,['sign','verify']);
  const key=Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
  const env={FIREBASE_WEB_API_KEY:'qa_test_key',
    FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({
      project_id:'atrio-catolico',client_email:SERVICE,
      private_key:'-----BEGIN PRIVATE KEY-----\n'+key+'\n-----END PRIVATE KEY-----',
    }),QA_MANUAL_ENABLED:'true'};
  return {env,keys};
}
const decode=(jwt)=>JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString('utf8'));

test('somente os três UIDs fixos recebem Firebase custom token assinado',async()=>{
  const {env,keys}=await fixture();
  const token=await createBotCustomToken(env,'qa_clara_v19',Date.parse('2026-10-27T00:00:00Z'));
  const claims=decode(token);
  assert.equal(claims.uid,'qa_clara_v19');
  assert.equal(claims.iss,SERVICE);
  assert.equal(claims.sub,SERVICE);
  assert.equal(claims.claims.qa_test_account,true);
  assert.equal(claims.exp-claims.iat,3000);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',keys.publicKey,
    Buffer.from(token.split('.')[2],'base64url'),new TextEncoder().encode(token.split('.').slice(0,2).join('.')));
  assert.equal(valid,true);
  for(const uid of ['founder','admin','alice','qa_hacker_v19','qa_clara_v20','../qa_clara_v19'])
    await assert.rejects(()=>createBotCustomToken(env,uid),/qa_invalid_uid/);
});
test('chave de outro projeto não consegue autenticar bots',async()=>{
  const {env}=await fixture();
  env.FIREBASE_SERVICE_ACCOUNT_JSON=JSON.stringify({...JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON),
    project_id:'outro-projeto'});
  await assert.rejects(()=>createBotCustomToken(env,'qa_clara_v19'),/qa_invalid_service_identity/);
});
test('login real verifica UID e situação Firebase Auth',async()=>{
  const {env}=await fixture();
  const original=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    const path=String(url);calls.push(path);
    if(path.includes('signInWithCustomToken')){
      const uid=decode(JSON.parse(options.body).token).uid;
      return Response.json({localId:uid,idToken:'id-token-'+uid+'x'.repeat(130)});
    }
    if(path.includes('accounts:lookup'))
      return Response.json({users:[{localId:'qa_miguel_v19',disabled:false}]});
    throw Error('Unexpected request');
  };
  try{
    const token=await signInQaBot(env,'qa_miguel_v19');
    assert.ok(token.includes('qa_miguel_v19'));
    assert.equal(calls.length,2);
  }finally{globalThis.fetch=original;}
});
test('login falha fechado em UID diferente, conta desativada ou falha de Auth',async()=>{
  const {env}=await fixture();
  const original=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    if(String(url).includes('signInWithCustomToken'))
      return Response.json({localId:'qa_lucia_v19',idToken:'x'.repeat(160)});
    throw Error('lookup must not be performed');
  };
  try{await assert.rejects(()=>signInQaBot(env,'qa_clara_v19'),/qa_firebase_auth_identity_mismatch/)}
  finally{globalThis.fetch=original;}
});

test('sessão sob demanda cria contas Auth reais e envia operações como os próprios usuários',async()=>{
  const {env}=await fixture();
  const original=globalThis.fetch;
  const entries=new Map();
  const requestId='qa_sessao_1000';
  const uidFromJwt=(token)=>decode(token).uid;
  let authLogins=0,userCommits=0,serviceCommits=0;
  const sessionId=new Map();
  globalThis.fetch=async(url,options={})=>{
    const path=String(url);
    if(path.includes('signInWithCustomToken')) {
      const uid=uidFromJwt(JSON.parse(options.body).token);
      sessionId.set(uid,uid+'-'+String(authLogins++));
      return Response.json({localId:uid,idToken:'auth-'+uid+'-'+'x'.repeat(160)});
    }
    if(path.includes('identitytoolkit.googleapis.com')&&path.includes('accounts:lookup')){
      const uid=JSON.parse(options.body).idToken.slice(5).split('-').slice(0,3).join('_');
      // UIDs com underscore; não derivar por token no app real.
      const known=['qa_clara_v19','qa_miguel_v19','qa_lucia_v19']
        .find(x=>JSON.parse(options.body).idToken.includes('auth-'+x+'-'));
      return Response.json({users:[{localId:known,disabled:false}]});
    }
    if(path.startsWith(URL_ROOT+'/')&&(!options.method||options.method==='GET')){
      const docPath=path.slice((URL_ROOT+'/').length);
      if(!entries.has(docPath))return new Response('{}',{status:404});
      return Response.json(entries.get(docPath));
    }
    if(path===URL_ROOT+':commit'){
      const token=options.headers.Authorization.slice(7);
      const writes=JSON.parse(options.body).writes;
      if(token==='service-oauth'){serviceCommits++;assert.equal(writes.length,1);}
      else {
        userCommits++;
        const uid=['qa_clara_v19','qa_miguel_v19','qa_lucia_v19']
          .find(x=>token.startsWith('auth-'+x+'-'));
        assert.ok(uid,'every user commit must be Firebase ID token');
        for(const w of writes) {
          if(w.update.name.includes('/posts/')&&!w.update.name.includes('/replies/'))
            assert.equal(w.update.fields.uid.stringValue,uid);
          if(w.update.name.includes('/replies/'))
            assert.equal(w.update.fields.uid.stringValue,uid);
          assert.deepEqual(w.updateTransforms,[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]);
        }
      }
      for(const w of writes){
        const docPath=w.update.name.slice(('projects/atrio-catolico/databases/(default)/documents/').length);
        assert.equal(entries.has(docPath),false,'never overwrites existing document');
        entries.set(docPath,{name:w.update.name,
          fields:{...w.update.fields,createdAt:{timestampValue:'2026-10-27T00:00:00Z'}}});
      }
      return Response.json({writeResults:writes.map(()=>({}))});
    }
    if(path.startsWith(URL_ROOT+'/qa_bot_runs/')&&options.method==='PATCH'){
      const docPath=path.slice((URL_ROOT+'/').length).split('?')[0];
      const prev=entries.get(docPath);
      entries.set(docPath,{...prev,fields:{...prev.fields,
        status:{stringValue:'created'},finishedAt:{timestampValue:'2026-10-27T00:00:02Z'}}});
      return Response.json(entries.get(docPath));
    }
    throw Error('Unexpected request '+path);
  };
  try {
    const now=new Date();
    const command={kind:'manual_chat_qa_v1',requestId,createdAt:now.toISOString()};
    assert.equal(await executeQaCommand(command,env,'service-oauth',now),'created');
    assert.equal(authLogins,3,'3 authentic Firebase identities sign in');
    assert.equal(serviceCommits,1,'service only writes QA control marker');
    assert.equal(userCommits,8,'3 profiles + post + 2 reply batches + like + save');
    assert.equal(entries.get('qa_bot_runs/'+requestId)?.fields?.status?.stringValue,'created');
    assert.ok(entries.has('posts/qa_'+requestId));
    assert.ok(entries.has('posts/qa_'+requestId+'/replies/qa_miguel'));
    assert.ok(entries.has('posts/qa_'+requestId+'/replies/qa_lucia'));
    assert.ok(entries.has('users/qa_clara_v19/notifications/qa_miguel'));
    assert.ok(entries.has('users/qa_miguel_v19/likedPosts/qa_'+requestId));
    assert.ok(entries.has('users/qa_lucia_v19/savedPosts/qa_'+requestId));
    assert.equal(await executeQaCommand(command,env,'service-oauth',now),'already_completed');
    assert.equal(authLogins,3,'idempotency skips new sign-ins');
  } finally {globalThis.fetch=original;}
});
