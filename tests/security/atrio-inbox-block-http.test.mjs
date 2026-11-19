import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {Firestore,Timestamp} from '@google-cloud/firestore';
import {assertFails,initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDocFromServer,setDoc} from 'firebase/firestore';
import {deleteApp,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {createInboxBlockHttpHandler} from '../../firebase/qa-general/chat-inbox-block-http.mjs';
import {
  beginInboxBackfill,advanceInboxMaintenance,inboxMutationVersionRef
} from '../../firebase/qa-general/chat-inbox-maintenance.mjs';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
const projectId='demo-atrio-v11';
const db=new Firestore({projectId});
const firestoreEnv=await initializeTestEnvironment({
  projectId,firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('qa-parity.generated.rules','utf8')}
});
const app=initializeApp({projectId},'qa-inbox-block-http');
const auth=getAuth(app);
const alice='qa-block-alice',bob='qa-block-bob',clara='qa-block-clara';
const noGrant='qa-block-no-grant',unverified='qa-block-unverified';
const password='Qa-fixture-only-355!';
const agePath=uid=>'users/'+uid+'/chatAgeEligibility/current';
const blockPath=(a,b)=>'users/'+a+'/blockedMembers/'+b;
const chatId=(a,b)=>a+'__'+b;
const projected=(uid,id)=>'serverInboxOwners/'+uid+'/legacy/'+id;
const receipts=()=>db.collection('serverInboxBlockRequests').get();
const prefix='/v1/qa/conversations/blocks/';
const initial='"initial"';
const keys=()=>randomUUID();
const verifyCalls=[];
async function verifyIdToken(token,checkRevoked) {
  verifyCalls.push(checkRevoked);
  return auth.verifyIdToken(token,checkRevoked);
}
const handler=createInboxBlockHttpHandler({db,verifyIdToken,enabled:true});

const server=createServer(async (incoming,outgoing)=>{
  try {
    const options={method:incoming.method,headers:incoming.headers};
    if(Number(incoming.headers['content-length'])>0||incoming.headers['transfer-encoding']){
      options.body=Readable.toWeb(incoming);
      options.duplex='half';
    }
    const request=new Request('http://127.0.0.1'+incoming.url,options);
    const result=await handler(request);
    outgoing.writeHead(result.status,Object.fromEntries(result.headers));
    outgoing.end(await result.text());
  }catch{
    outgoing.writeHead(500);
    outgoing.end();
  }
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
async function signIn(uid) {
  const result=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-atrio-v11',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email:uid+'@qa.invalid',password,returnSecureToken:true})
  });
  assert.equal(result.status,200);
  const body=await result.json();
  assert.ok(body.idToken);
  return body.idToken;
}
const tokens={};
function requestOptions(uid,method,key,tag,extra={}) {
  const headers={...extra.headers};
  if(uid)headers.Authorization='Bearer '+(tokens[uid]??uid);
  if(key)headers['Idempotency-Key']=key;
  if(tag)headers['If-Match']=tag;
  return {method,headers,body:extra.body};
}
async function send(uid,peer,method='GET',key,tag,extra={}) {
  const response=await fetch(base+prefix+peer,requestOptions(uid,method,key,tag,extra));
  assert.match(response.headers.get('cache-control')??'',/no-store/);
  return {status:response.status,etag:response.headers.get('etag'),body:await response.json()};
}
const denied=(status,error)=>({status,etag:null,body:{error}});
const committed=(requestedBlocked,blocked=requestedBlocked,replayed=false)=>
  ({committed:true,replayed,requestedBlocked,blocked});
const snapshots=(...paths)=>db.getAll(...paths.map(path=>db.doc(path)));
let count=0;
async function check(label,run) {
  await run();
  count++;
  console.log('PASS INBOX BLOCK HTTP',label);
}
async function finish(operation) {
  for(let batch=0;batch<12;batch++)
    if((await advanceInboxMaintenance(db,operation,{limit:5})).done)return;
  assert.fail('QA: carga não terminou');
}

try {
  await firestoreEnv.clearFirestore();
  for(const uid of [alice,bob,clara,noGrant,unverified]){
    await auth.createUser({uid,email:uid+'@qa.invalid',password,emailVerified:uid!==unverified});
    tokens[uid]=await signIn(uid);
  }
  const cfg=db.doc('app_config/conversations');
  const validCfg={
    enabled:true,minorPolicyApproved:true,safetyReviewVersion:'2026-11-safety-v1',
    version:'2026-11-v1'
  };
  const grant={
    status:'eligible',policyVersion:'2026-11-18plus-qa-v1',minimumAge:18,
    reviewExpiresAt:Timestamp.fromMillis(Date.now()+60*60*1000)
  };
  const ab=chatId(alice,bob),ac=chatId(alice,clara);
  const seed=db.batch();
  seed.set(cfg,validCfg);
  for(const uid of [alice,bob,clara,unverified])seed.set(db.doc(agePath(uid)),grant);
  for(const [id,peer] of [[ab,bob],[ac,clara]])
    seed.set(db.doc('chats/'+id),{
      requesterUid:alice,recipientUid:peer,participants:[alice,peer],status:'accepted',
      lastPreview:'Texto fictício',updatedAt:Timestamp.now()
    });
  await seed.commit();
  await beginInboxBackfill(db,'block-http-bootstrap');
  await finish('block-http-bootstrap');

  await check('fechado por padrão, contrato estrito e consulta privada por titular',async()=>{
    const close=createInboxBlockHttpHandler({db,verifyIdToken});
    const req=new Request(base+prefix+bob,requestOptions(alice,'PUT',keys(),initial));
    const closed=await close(req);
    assert.equal(closed.status,503);
    assert.deepEqual(await closed.json(),{error:'inbox_closed'});
    const disabledByString=createInboxBlockHttpHandler({db,verifyIdToken,enabled:'false'});
    assert.equal((await disabledByString(req)).status,503);
    assert.equal(verifyCalls.length,0);
    assert.deepEqual(await send(alice,bob),{status:200,etag:initial,body:{blocked:false}});
    assert.deepEqual(await send(alice,bob,'POST'),denied(405,'method_not_allowed'));
    assert.deepEqual(await send(alice,bob,'PUT',keys()),denied(400,'invalid_request'));
    assert.deepEqual(await send(alice,bob,'PUT',keys(),'*'),denied(400,'invalid_request'));
    assert.deepEqual(await send(alice,bob+'?uid='+clara),denied(400,'invalid_request'));
    assert.deepEqual(await send(alice,bob,'PUT',keys(),initial,{body:'{"ownerUid":"'+clara+'"}'}),
      denied(400,'invalid_request'));
    assert.deepEqual(await send(alice,alice,'PUT',keys(),initial),denied(400,'invalid_request'));
    assert.equal((await receipts()).size,0);
  });

  await check('Auth real do Emulator recusa sessão inválida, e-mail e política sem concessão',async()=>{
    for(const actor of [null,'invalid-token',noGrant,unverified]){
      assert.deepEqual(await send(actor,bob,'PUT',keys(),initial),denied(403,'forbidden'));
    }
    await db.doc(agePath(alice)).update({reviewExpiresAt:Timestamp.fromMillis(1)});
    assert.deepEqual(await send(alice,bob,'DELETE',keys(),initial),denied(403,'forbidden'));
    await db.doc(agePath(alice)).set(grant);
    await cfg.update({minorPolicyApproved:false});
    assert.deepEqual(await send(alice,bob,'PUT',keys(),initial),denied(403,'forbidden'));
    await cfg.set(validCfg);
    assert.ok(verifyCalls.length>0&&verifyCalls.every(value=>value===true));
    assert.equal((await receipts()).size,0);
  });

  let originalKey,aliceVersion,bobVersion,ownerCreatedAt,unblockedVersion;
  await check('PUT confirma depois de gravar origem, recibo e revogação das duas projeções',async()=>{
    originalKey=keys();
    const result=await send(alice,bob,'PUT',originalKey,initial);
    assert.equal(result.status,200);
    assert.deepEqual(result.body,committed(true));
    aliceVersion=result.etag;
    assert.notEqual(aliceVersion,initial);
    const [owner,opposite,a,b]=await snapshots(
      blockPath(alice,bob),blockPath(bob,alice),projected(alice,ab),projected(bob,ab));
    assert.deepEqual([owner.exists,opposite.exists,a.exists,b.exists],[true,false,false,false]);
    ownerCreatedAt=owner.get('createdAt');
    assert.ok(ownerCreatedAt.toMillis()>0);
    assert.equal((await receipts()).size,1);
    assert.deepEqual(await send(bob,alice),{status:200,etag:initial,body:{blocked:false}});
  });

  await check('recebimento e versão ficam privados até para o próprio titular',async()=>{
    const client=firestoreEnv.authenticatedContext(alice,{email_verified:true}).firestore();
    const [receipt]=(await receipts()).docs;
    const paths=[receipt.ref.path,inboxMutationVersionRef(db,blockPath(alice,bob)).path];
    for(const path of paths) {
      await assertFails(getDocFromServer(doc(client,path)));
      await assertFails(setDoc(doc(client,path),{operationId:'forged'}));
    }
  });

  await check('retry exato preserva versão e timestamp, colisões são isoladas por titular',async()=>{
    assert.deepEqual(await send(alice,bob,'PUT',originalKey,initial),
      {status:200,etag:aliceVersion,body:committed(true,true,true)});
    assert.deepEqual((await db.doc(blockPath(alice,bob)).get()).get('createdAt'),ownerCreatedAt);
    assert.deepEqual(await send(alice,clara,'PUT',originalKey,initial),denied(409,'block_operation_conflict'));
    assert.deepEqual(await send(alice,bob,'DELETE',originalKey,initial),denied(409,'block_operation_conflict'));
    const reverse=await send(bob,alice,'PUT',originalKey,initial);
    assert.equal(reverse.status,200);
    assert.deepEqual(reverse.body,committed(true));
    bobVersion=reverse.etag;
    assert.notEqual(bobVersion,aliceVersion);
    assert.equal((await receipts()).size,2);
  });

  await check('DELETE verifica versão e só restaura a projeção após remover os dois bloqueios',async()=>{
    assert.deepEqual(await send(alice,bob,'DELETE',keys(),initial),denied(409,'block_state_changed'));
    const unlink=keys();
    const result=await send(alice,bob,'DELETE',unlink,aliceVersion);
    assert.equal(result.status,200);
    assert.deepEqual(result.body,committed(false));
    unblockedVersion=result.etag;
    assert.deepEqual(await send(alice,bob,'DELETE',unlink,aliceVersion),
      {status:200,etag:unblockedVersion,body:committed(false,false,true)});
    assert.equal((await db.doc(blockPath(alice,bob)).get()).exists,false);
    assert.equal((await db.doc(blockPath(bob,alice)).get()).exists,true);
    assert.equal((await db.doc(projected(alice,ab)).get()).exists,false);
    assert.equal((await send(bob,alice,'DELETE',keys(),bobVersion)).status,200);
    assert.ok((await snapshots(projected(alice,ab),projected(bob,ab))).every(s=>s.exists));
    assert.deepEqual(await send(alice,bob,'PUT',originalKey,initial),
      {status:200,etag:unblockedVersion,body:committed(true,false,true)});
    assert.equal((await db.doc(blockPath(alice,bob)).get()).exists,false);
  });

  await check('corridas de mesma chave confirmam uma vez e versões concorrentes não se sobrescrevem',async()=>{
    const key=keys();
    const startingCount=(await receipts()).size;
    const replies=await Promise.all([
      send(alice,clara,'PUT',key,initial),send(alice,clara,'PUT',key,initial)
    ]);
    assert.deepEqual(replies.map(reply=>reply.status),[200,200]);
    assert.deepEqual(replies.map(reply=>reply.body.replayed).sort(),[false,true]);
    assert.equal(replies[0].etag,replies[1].etag);
    assert.equal((await receipts()).size,startingCount+1);
    const etag=replies[0].etag;
    const before=await db.doc(blockPath(alice,clara)).get();
    const repeatIntent=await send(alice,clara,'PUT',keys(),etag);
    assert.equal(repeatIntent.status,200);
    const unchanged=await db.doc(blockPath(alice,clara)).get();
    assert.deepEqual(unchanged.updateTime,before.updateTime);
    const competing=await Promise.all([
      send(alice,clara,'DELETE',keys(),repeatIntent.etag),
      send(alice,clara,'DELETE',keys(),repeatIntent.etag)
    ]);
    assert.deepEqual(competing.map(reply=>reply.status).sort(),[200,409]);
    assert.deepEqual(competing.find(reply=>reply.status===409),denied(409,'block_state_changed'));
    assert.ok((await snapshots(projected(alice,ac),projected(clara,ac))).every(s=>s.exists));
  });

  await check('manutenção devolve 503 sem gravar e a mesma chave funciona depois de reabrir',async()=>{
    await beginInboxBackfill(db,'block-http-rebuild');
    const key=keys();
    const before=(await receipts()).size;
    assert.deepEqual(await send(alice,bob),denied(503,'block_unavailable'));
    assert.deepEqual(await send(alice,bob,'PUT',key,unblockedVersion),denied(503,'block_unavailable'));
    assert.deepEqual(await send(alice,bob,'DELETE',keys(),unblockedVersion),denied(503,'block_unavailable'));
    assert.equal((await receipts()).size,before);
    assert.equal((await db.doc(blockPath(alice,bob)).get()).exists,false);
    await finish('block-http-rebuild');
    assert.equal((await send(alice,bob,'PUT',key,unblockedVersion)).status,200);
  });

  await check('rollback anterior ao commit não confirma nem deixa recibo ou índice parcial',async()=>{
    const etag=(await send(alice,bob)).etag;
    const key=keys();
    const failingDb={
      doc:path=>db.doc(path),
      runTransaction:(fn,options)=>db.runTransaction(async tx=>{
        await fn(tx);
        throw Error('QA: abort before commit');
      },options)
    };
    const failing=createInboxBlockHttpHandler({db:failingDb,verifyIdToken,enabled:true});
    const before=(await receipts()).size;
    const result=await failing(new Request(base+prefix+bob,requestOptions(alice,'DELETE',key,etag)));
    assert.equal(result.status,503);
    assert.deepEqual(await result.json(),{error:'block_unavailable'});
    assert.equal((await receipts()).size,before);
    assert.ok((await db.doc(blockPath(alice,bob)).get()).exists);
    assert.ok((await snapshots(projected(alice,ab),projected(bob,ab))).every(s=>!s.exists));
    assert.equal((await send(alice,bob,'DELETE',key,etag)).status,200);
  });

  await check('revogação real do token impede nova escrita e o replay de um recibo existente',async()=>{
    const nowAuth=await auth.verifyIdToken(tokens[alice],true);
    const clockWait=(nowAuth.auth_time+1)*1000-Date.now()+50;
    if(clockWait>0)await delay(clockWait);
    await auth.revokeRefreshTokens(alice);
    await assert.rejects(auth.verifyIdToken(tokens[alice],true),{code:'auth/id-token-revoked'});
    assert.deepEqual(await send(alice,bob,'PUT',keys(),initial),denied(403,'forbidden'));
    assert.deepEqual(await send(alice,bob,'PUT',originalKey,initial),denied(403,'forbidden'));
    tokens[alice]=await signIn(alice);
    const recovered=await send(alice,bob,'PUT',originalKey,initial);
    assert.equal(recovered.status,200);
    assert.deepEqual(recovered.body,committed(true,false,true));
  });
  console.log('AUTHORIZED INBOX BLOCK HTTP TESTS:',count,'OK');
} finally {
  await Promise.all([
    new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),
    db.terminate(),deleteApp(app),firestoreEnv.cleanup()
  ]);
}
