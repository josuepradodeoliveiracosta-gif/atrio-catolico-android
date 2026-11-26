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
import {createInboxMessageHttpHandler} from '../../firebase/qa-general/chat-inbox-message-http.mjs';
import {createInboxBlockHttpHandler} from '../../firebase/qa-general/chat-inbox-block-http.mjs';
import {
  createAdminInboxStore,createAuthorizedInboxService,createInboxHttpHandler
} from '../../firebase/qa-general/chat-inbox-discovery-server.mjs';
import {
  advanceInboxMaintenance,beginInboxBackfill
} from '../../firebase/qa-general/chat-inbox-maintenance.mjs';
import {peerInboxEntries,preparePeerInbox} from '../../firebase/qa-general/chat-inbox-peer-index.mjs';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
const projectId='demo-atrio-v11';
const env=await initializeTestEnvironment({
  projectId,firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('qa-parity.generated.rules','utf8')}
});
const app=initializeApp({projectId},'qa-message-http');
const auth=getAuth(app);
const db=new Firestore({projectId});
const a='qa-msg-alice',b='qa-msg-bob',c='qa-msg-clara',m='qa-msg-miguel',l='qa-msg-lucia';
const stranger='qa-msg-outsider',unverified='qa-msg-unverified';
const password='Qa-message-fixture-355!';
const tokens={};
const id=(x,y)=>[x,y].sort().join('__');
const age=uid=>db.doc('users/'+uid+'/chatAgeEligibility/current');
const privacy=uid=>db.doc('users/'+uid+'/chatSettings/privacy');
const quota=uid=>db.doc('users/'+uid+'/chatLimits/requests');
const room=chatId=>db.doc('chats/'+chatId);
const ab=id(a,b);
const root='/v1/qa/conversations';
const requestPath=peer=>root+'/requests/'+peer;
const messages=chatId=>root+'/chats/'+chatId+'/messages';
const blocks=peer=>root+'/blocks/'+peer;
const decisions=chatId=>root+'/chats/'+chatId+'/decision';
const receipts=()=>db.collection('serverInboxMessageRequests').get();
const cfg=db.doc('app_config/conversations');
const validCfg={enabled:true,minorPolicyApproved:true,safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'};
const verifyIdToken=(token,revocation)=>{
  assert.equal(revocation,true);
  return auth.verifyIdToken(token,revocation);
};
const options={db,verifyIdToken,enabled:true};
const messageHandler=createInboxMessageHttpHandler(options);
const blockHandler=createInboxBlockHttpHandler(options);
const inboxHandler=createInboxHttpHandler(createAuthorizedInboxService({
  verifyIdToken,store:createAdminInboxStore(db),cursorKey:Buffer.alloc(32,17)
}),{enabled:true});

const server=createServer(async (incoming,outgoing)=>{
  try{
    const input={method:incoming.method,headers:incoming.headers};
    if(Number(incoming.headers['content-length'])>0||incoming.headers['transfer-encoding']){
      input.body=Readable.toWeb(incoming);
      input.duplex='half';
    }
    const request=new Request('http://127.0.0.1'+incoming.url,input);
    const handler=incoming.url.startsWith(root+'/inbox')?inboxHandler:
      incoming.url.startsWith(root+'/blocks/')?blockHandler:messageHandler;
    const result=await handler(request);
    outgoing.writeHead(result.status,Object.fromEntries(result.headers));
    outgoing.end(await result.text());
  }catch{outgoing.writeHead(500).end();}
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
function requestOptions(uid,method,key,payload,extra={}) {
  return {method,headers:{
    ...(uid?{Authorization:'Bearer '+(tokens[uid]??uid)}:{}),
    ...(key?{'Idempotency-Key':key}:{}),
    ...(payload!==undefined?{'Content-Type':'application/json'}:{}),...extra
  },body:payload===undefined?undefined:JSON.stringify(payload)};
}
async function call(uid,path,method,key,payload,headers){
  const result=await fetch(base+path,requestOptions(uid,method,key,payload,headers));
  assert.match(result.headers.get('cache-control'),/no-store/);
  return {status:result.status,body:await result.json(),etag:result.headers.get('etag')};
}
const write=(uid,path,payload,key=randomUUID())=>call(uid,path,'POST',key,payload);
const read=(uid,cursor=null,limit=20)=>call(
  uid,root+'/inbox?limit='+limit+(cursor?'&cursor='+encodeURIComponent(cursor):''),'GET'
);
const rejected=(status,error)=>({status,body:{error},etag:null});
const denied=rejected(403,'conversation_unavailable');
async function block(owner,peer,method){
  const current=await call(owner,blocks(peer),'GET');
  assert.equal(current.status,200);
  return call(owner,blocks(peer),method,randomUUID(),undefined,{'If-Match':current.etag});
}
async function signIn(uid){
  const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-atrio-v11',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email:uid+'@qa.invalid',password,returnSecureToken:true})
  });
  assert.equal(response.status,200);
  const {idToken}=await response.json();
  assert.ok(idToken);
  return idToken;
}
async function finish(operation){
  for(let i=0;i<12;i++)if((await advanceInboxMaintenance(db,operation,{limit:5})).done)return;
  assert.fail('carga QA incompleta');
}
async function traversal(uid){
  const items=[];
  let cursor=null;
  do {
    const response=await read(uid,cursor,1);
    assert.equal(response.status,200);
    items.push(...response.body.items);
    cursor=response.body.nextCursor;
    assert.ok(items.length<=10);
  } while(cursor);
  return items;
}
const peers=async uid=>(await traversal(uid)).map(item=>item.peerUid);
async function acceptFixture(chatId){
  await db.runTransaction(async tx=>{
    const ref=room(chatId);
    const current=(await tx.get(ref)).data();
    const materialize=await preparePeerInbox(db,tx,peerInboxEntries(chatId,{...current,status:'accepted'}));
    tx.update(ref,{status:'accepted'});
    materialize();
  });
}
async function persistedState(actor,peer,chatId){
  const roomRef=room(chatId);
  const refs=[roomRef,quota(actor)];
  for(const [owner,other] of [[actor,peer],[peer,actor]]){
    const inbox=db.doc('serverInboxOwners/'+owner);
    refs.push(inbox,inbox.collection('legacy').doc(chatId),
      db.doc('users/'+owner+'/chatInboxByPeer/'+other+'/entries/'+chatId));
  }
  const [documents,messageList,receiptList]=await Promise.all([
    db.getAll(...refs),roomRef.collection('messages').get(),receipts()
  ]);
  return [...documents,...messageList.docs,...receiptList.docs]
    .map(snap=>({path:snap.ref.path,data:snap.data(),updated:snap.updateTime}));
}
let count=0;
async function check(label,run){
  await run();
  console.log('PASS INBOX MESSAGE HTTP',label);
  count++;
}

try{
  await env.clearFirestore();
  for(const uid of [a,b,c,m,l,stranger,unverified]){
    await auth.createUser({uid,email:uid+'@qa.invalid',password,emailVerified:uid!==unverified});
    tokens[uid]=await signIn(uid);
  }
  const seed=db.batch();
  seed.set(cfg,validCfg);
  for(const [uid,min] of [[a,30],[b,40],[c,20],[m,60],[l,50],[unverified,70]]){
    seed.set(age(uid),{
      status:'eligible',policyVersion:'2026-11-18plus-qa-v1',minimumAge:18,
      reviewExpiresAt:Timestamp.fromMillis(Date.now()+min*60_000)
    });
    seed.set(privacy(uid),{requests:'all'});
  }
  for(const [x,y] of [[a,c],[a,m],[b,c],[b,m]]){
    // Uma das conversas usa a orientação antiga para testar a deduplicação.
    const target=x===b&&y===c?c+'__'+b:id(x,y);
    seed.set(room(target),{
      participants:[x,y],requesterUid:x,recipientUid:y,status:'accepted',
      initialId:'old-first',lastMessageId:'old-first',lastPreview:'Fixture',
      lastSenderUid:x,createdAt:Timestamp.now(),updatedAt:Timestamp.now(),
      unreadRequester:0,unreadRecipient:1
    });
  }
  await seed.commit();
  await beginInboxBackfill(db,'message-http-bootstrap');
  await finish('message-http-bootstrap');

  await check('fechado por padrão, Auth, escopo, validação de payload e recusa genérica',async()=>{
    const closed=createInboxMessageHttpHandler({db,verifyIdToken,enabled:'false'});
    const result=await closed(new Request(base+requestPath(b),requestOptions(a,'POST',randomUUID(),{text:'Oi'})));
    assert.equal(result.status,503);
    assert.deepEqual(await result.json(),{error:'inbox_closed'});
    for(const actor of [null,'invalid-token',stranger,unverified])
      assert.deepEqual(await write(actor,requestPath(b),{text:'Oi'}),denied);
    for(const payload of [{text:'www.exemplo.com'},{text:'Oi',uid:c},{text:'Oi',replyToId:'x'},
      {text:'x'.repeat(1501)},{text:' '}])
      assert.deepEqual(await write(a,requestPath(b),payload),rejected(400,'invalid_request'));
    assert.deepEqual(await write(a,requestPath(a),{text:'Oi'}),rejected(400,'invalid_request'));
    assert.deepEqual(await write(a,requestPath(b)+'?uid='+c,{text:'Oi'}),rejected(400,'invalid_request'));
    assert.deepEqual(await write(a,messages('missing-chat'),{text:'Oi'}),denied);
    assert.deepEqual(await write(c,messages(id(a,m)),{text:'Oi'}),denied);
    assert.deepEqual(await write(a,requestPath(stranger),{text:'Oi'}),denied);
    await privacy(b).update({requests:'none'});
    assert.deepEqual(await write(a,requestPath(b),{text:'Oi'}),denied);
    await privacy(b).update({requests:'all'});
    await cfg.update({minorPolicyApproved:false});
    assert.deepEqual(await write(a,requestPath(b),{text:'Oi'}),denied);
    await cfg.set(validCfg);
    assert.equal((await receipts()).size,0);
  });

  await check('primeiro contato recusa os dois sentidos do bloqueio sem escrita',async()=>{
    assert.equal((await block(a,b,'PUT')).status,200);
    assert.deepEqual(await write(a,requestPath(b),{text:'Salve'}),denied);
    assert.deepEqual(await write(b,requestPath(a),{text:'Salve'}),denied);
    assert.equal((await block(a,b,'DELETE')).status,200);
    assert.equal((await block(b,a,'PUT')).status,200);
    assert.deepEqual(await write(a,requestPath(b),{text:'Salve'}),denied);
    assert.equal((await block(b,a,'DELETE')).status,200);
    assert.equal((await room(ab).get()).exists,false);
    assert.equal((await quota(a).get()).exists,false);
    assert.deepEqual(await peers(a),[c,m]);
  });

  let firstMessage;
  await check('contato confirma uma vez, quota atômica e cursores anteriores reiniciam nas duas pontas',async()=>{
    const oldA=(await read(a,null,1)).body.nextCursor;
    const oldB=(await read(b,null,1)).body.nextCursor;
    assert.ok(oldA&&oldB);
    const key=randomUUID();
    const payload={text:'Paz e bem!'};
    const results=await Promise.all([write(a,requestPath(b),payload,key),write(a,requestPath(b),payload,key)]);
    assert.deepEqual(results.map(v=>v.status),[200,200]);
    assert.deepEqual(results.map(v=>v.body.replayed).sort(),[false,true]);
    firstMessage=results[0].body.messageId;
    assert.equal(results[1].body.messageId,firstMessage);
    assert.equal(results[0].body.chatId,ab);
    assert.equal((await room(ab).get()).get('status'),'pending');
    assert.equal((await room(ab).collection('messages').get()).size,1);
    assert.equal((await quota(a).get()).get('count'),1);
    assert.equal((await receipts()).size,1);
    assert.deepEqual(await write(a,requestPath(b),{text:'Outra intenção'},key),
      rejected(409,'message_operation_conflict'));
    assert.deepEqual(await write(b,requestPath(a),{text:'Salve'}),rejected(409,'conversation_exists'));
    assert.deepEqual(await write(b,requestPath(c),{text:'Salve'}),rejected(409,'conversation_exists'));
    assert.deepEqual(await read(a,oldA,1),rejected(409,'inbox_restart_required'));
    assert.deepEqual(await read(b,oldB,1),rejected(409,'inbox_restart_required'));
    assert.deepEqual(await peers(a),[c,b,m]);
    assert.deepEqual(await peers(b),[c,a,m]);
    assert.deepEqual(await write(a,messages(ab),{text:'Ainda pendente'}),
      rejected(409,'conversation_not_accepted'));
    const client=env.authenticatedContext(a,{email_verified:true}).firestore();
    const proof=(await receipts()).docs[0].ref.path;
    await assertFails(getDocFromServer(doc(client,proof)));
    await assertFails(setDoc(doc(client,proof),{fingerprint:'fake'}));
  });

  await check('aceite explícito só pelo destinatário, atômico e idempotente',async()=>{
    const key=randomUUID(),payload={status:'accepted'};
    const before=await persistedState(a,b,ab);
    for(const actor of [a,c,stranger,unverified])
      assert.deepEqual(await write(actor,decisions(ab),payload),denied);
    assert.deepEqual(await write(b,decisions(ab),{status:'accepted',uid:a}),
      rejected(400,'invalid_request'));
    assert.deepEqual(await persistedState(a,b,ab),before);
    assert.equal((await block(a,b,'PUT')).status,200);
    assert.deepEqual(await write(b,decisions(ab),payload,key),denied);
    assert.equal((await block(a,b,'DELETE')).status,200);
    const results=await Promise.all([write(b,decisions(ab),payload,key),write(b,decisions(ab),payload,key)]);
    assert.deepEqual(results.map(v=>v.status),[200,200]);
    assert.deepEqual(results.map(v=>v.body.replayed).sort(),[false,true]);
    assert.equal((await room(ab).get()).get('status'),'accepted');
    assert.equal((await room(ab).collection('messages').get()).size,1);
    for(const [owner,peer] of [[a,b],[b,a]]){
      const view=await db.doc('users/'+owner+'/chatInboxByPeer/'+peer+'/entries/'+ab).get();
      assert.equal(view.get('status'),'accepted');
      assert.equal((await traversal(owner)).find(item=>item.chatId===ab)?.status,'accepted');
    }
    assert.deepEqual(await write(b,decisions(ab),{status:'declined'},key),
      rejected(409,'message_operation_conflict'));
    assert.deepEqual(await write(b,decisions(ab),{status:'declined'}),
      rejected(409,'conversation_state_changed'));
  });

  let lastKey;
  await check('envio confirma conteúdo, resposta e contadores mantendo a ordem e o cursor válidos',async()=>{
    const oldA=(await read(a,null,1)).body.nextCursor;
    const oldB=(await read(b,null,1)).body.nextCursor;
    assert.ok(oldA&&oldB);
    assert.deepEqual(await write(a,messages(ab),{text:'Teste',replyToId:'missing'}),rejected(400,'invalid_reply'));
    lastKey=randomUUID();
    const payload={text:'Resposta',replyToId:firstMessage};
    const sent=await write(a,messages(ab),payload,lastKey);
    assert.equal(sent.status,200);
    assert.equal(sent.body.committed,true);
    assert.equal((await room(ab).get()).get('unreadRecipient'),2);
    const message=(await room(ab).collection('messages').doc(sent.body.messageId).get()).data();
    assert.equal(message.replyToId,firstMessage);
    assert.equal(message.uid,a);
    assert.deepEqual((await write(a,messages(ab),payload,lastKey)).body,{...sent.body,replayed:true});
    assert.equal((await room(ab).collection('messages').get()).size,2);
    assert.deepEqual(await write(a,messages(ab),{text:'Rajada'}),rejected(429,'message_rate_limited'));
    for(const [uid,peer,cursor] of [[a,b,oldA],[b,a,oldB]]){
      const next=await read(uid,cursor,1);
      assert.equal(next.status,200);
      assert.equal(next.body.items[0].peerUid,peer);
      assert.equal(next.body.items[0].lastPreview,'Resposta');
      assert.equal((await read(uid,next.body.nextCursor,1)).body.items[0].peerUid,m);
    }
  });

  await check('envio e replay recusados ambos os sentidos durante bloqueio e índice preservado',async()=>{
    assert.equal((await block(b,a,'PUT')).status,200);
    assert.deepEqual(await write(b,messages(ab),{text:'Não enviar'}),denied);
    assert.deepEqual(await write(a,messages(ab),{text:'Resposta',replyToId:firstMessage},lastKey),denied);
    assert.equal((await block(a,b,'PUT')).status,200);
    assert.equal((await block(b,a,'DELETE')).status,200);
    assert.deepEqual(await write(b,messages(ab),{text:'Ainda bloqueado'}),denied);
    assert.deepEqual(await write(a,messages(ab),{text:'Ainda bloqueado'}),denied);
    assert.deepEqual(await peers(a),[c,m]);
    assert.deepEqual(await peers(b),[c,m]);
    assert.equal((await room(ab).collection('messages').get()).size,2);
    assert.equal((await block(a,b,'DELETE')).status,200);
    assert.equal((await write(b,messages(ab),{text:'Após desbloqueio'})).status,200);
    assert.equal((await room(ab).get()).get('unreadRequester'),1);
  });

  await check('quota de 24h, manutenção e rollback não deixam chat, mensagem, índice ou recibo parcial',async()=>{
    const full={count:5,windowStart:Timestamp.now(),lastChatId:ab,updatedAt:Timestamp.now()};
    await quota(a).set(full);
    assert.deepEqual(await write(a,requestPath(l),{text:'Pedido'}),rejected(429,'contact_quota_exceeded'));
    await quota(a).update({windowStart:Timestamp.fromMillis(Date.now()-87_000_000)});
    await beginInboxBackfill(db,'message-http-rebuild');
    const key=randomUUID();
    const before=(await receipts()).size;
    assert.deepEqual(await write(a,requestPath(l),{text:'Pedido'},key),
      rejected(503,'conversation_unavailable'));
    await finish('message-http-rebuild');
    const aborting={
      doc:path=>db.doc(path),runTransaction:fn=>db.runTransaction(async tx=>{
        await fn(tx);
        throw Error('QA: falha anterior ao commit');
      })
    };
    const abort=createInboxMessageHttpHandler({db:aborting,verifyIdToken,enabled:true});
    const resp=await abort(new Request(base+requestPath(l),requestOptions(a,'POST',key,{text:'Pedido'})));
    assert.equal(resp.status,503);
    assert.equal((await receipts()).size,before);
    assert.equal((await room(id(a,l)).get()).exists,false);
    assert.equal((await quota(a).get()).get('count'),5);
    assert.deepEqual(await peers(a),[c,b,m]);
    assert.equal((await write(a,requestPath(l),{text:'Pedido'},key)).status,200);
    assert.equal((await quota(a).get()).get('count'),1);
    assert.deepEqual(await peers(a),[c,b,l,m]);
  });

  await check('primeiros contatos concorrentes em sentidos opostos mantêm um chat e uma quota',async()=>{
    const before=(await receipts()).size;
    const outcomes=await Promise.all([
      write(c,requestPath(l),{text:'Contato de Clara'}),
      write(l,requestPath(c),{text:'Contato de Lúcia'})
    ]);
    assert.deepEqual(outcomes.map(value=>value.status).sort(),[200,409]);
    const source=await room(id(c,l)).get();
    const winner=source.get('requesterUid');
    const loser=winner===c?l:c;
    assert.equal((await quota(winner).get()).get('count'),1);
    assert.equal((await quota(loser).get()).exists,false);
    assert.equal((await source.ref.collection('messages').get()).size,1);
    assert.equal((await receipts()).size,before+1);
    assert.equal((await peers(c)).filter(peer=>peer===l).length,1);
    assert.equal((await peers(l)).filter(peer=>peer===c).length,1);
  });

  await check('corrida entre envio e bloqueio mantém leitura fechada após confirmar o bloqueio',async()=>{
    const oldA=(await read(a,null,1)).body.nextCursor;
    const oldB=(await read(b,null,1)).body.nextCursor;
    const payload={text:'Envio concorrente'};
    const key=randomUUID();
    const before=(await room(ab).collection('messages').get()).size;
    const [sent,blocked]=await Promise.all([write(a,messages(ab),payload,key),block(b,a,'PUT')]);
    assert.equal(blocked.status,200);
    assert.ok([200,403].includes(sent.status));
    assert.equal((await room(ab).collection('messages').get()).size,before+Number(sent.status===200));
    assert.deepEqual(await write(a,messages(ab),payload,key),denied);
    assert.deepEqual(await read(a,oldA,1),rejected(409,'inbox_restart_required'));
    assert.deepEqual(await read(b,oldB,1),rejected(409,'inbox_restart_required'));
    assert.equal((await peers(a)).includes(b),false);
    assert.equal((await peers(b)).includes(a),false);
    assert.equal((await block(b,a,'DELETE')).status,200);
  });

  for(const {label,actor,peer,text,above} of [
    {label:'BMP',actor:b,peer:l,text:'á'.repeat(1500),above:['á'.repeat(1501)]},
    {label:'suplementar',actor:c,peer:m,text:'🙂'.repeat(750),
      above:['🙂'.repeat(750)+'a','🙂'.repeat(751)]}
  ]){
    await check('limite UTF-16 '+label+' no primeiro contato e no envio',async()=>{
      const chatId=id(actor,peer);
      assert.equal(text.length,1500);
      for(const path of [requestPath(peer),messages(chatId)]){
        const before=await persistedState(actor,peer,chatId);
        for(const invalid of above){
          assert.ok(invalid.length>1500);
          const key=randomUUID();
          for(let attempt=0;attempt<2;attempt++)
            assert.deepEqual(await write(actor,path,{text:invalid},key),rejected(400,'invalid_request'));
        }
        assert.deepEqual(await persistedState(actor,peer,chatId),before);
        const reply=await write(actor,path,{text:' '+text+' '});
        assert.equal(reply.status,200);
        assert.equal(reply.body.committed,true);
        const message=await room(chatId).collection('messages').doc(reply.body.messageId).get();
        assert.equal(message.get('text'),text);
        for(const [owner,other] of [[actor,peer],[peer,actor]]){
          const preview=(await traversal(owner)).find(item=>item.peerUid===other);
          assert.equal(preview?.lastPreview,text);
        }
        if(path===requestPath(peer))await acceptFixture(chatId);
      }
    });
  }

  await check('recusa explícita não permite envio nem reabertura',async()=>{
    const target=id(c,l),source=await room(target).get();
    const recipient=source.get('recipientUid'),sender=source.get('requesterUid');
    const key=randomUUID(),payload={status:'declined'};
    const result=await write(recipient,decisions(target),payload,key);
    assert.equal(result.status,200);
    assert.equal((await room(target).get()).get('status'),'declined');
    assert.equal((await room(target).collection('messages').get()).size,1);
    assert.deepEqual((await write(recipient,decisions(target),payload,key)).body,
      {...result.body,replayed:true});
    assert.deepEqual(await write(sender,messages(target),{text:'Não enviar'}),
      rejected(409,'conversation_not_accepted'));
    assert.deepEqual(await write(recipient,decisions(target),{status:'accepted'}),
      rejected(409,'conversation_state_changed'));
  });

  await check('revogação real impede nova escrita e replay de envio',async()=>{
    const before=(await room(ab).collection('messages').get()).size;
    const prior=await auth.verifyIdToken(tokens[a],true);
    const wait=(prior.auth_time+1)*1000-Date.now()+50;
    if(wait>0)await delay(wait);
    await auth.revokeRefreshTokens(a);
    await assert.rejects(auth.verifyIdToken(tokens[a],true),{code:'auth/id-token-revoked'});
    assert.deepEqual(await write(a,messages(ab),{text:'Sem sessão'}),denied);
    assert.deepEqual(await write(a,messages(ab),{text:'Resposta',replyToId:firstMessage},lastKey),denied);
    assert.equal((await room(ab).collection('messages').get()).size,before);
  });
  console.log('AUTHORIZED INBOX MESSAGE HTTP TESTS:',count,'OK');
} finally {
  await Promise.all([
    new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),
    db.terminate(),deleteApp(app),env.cleanup()
  ]);
}
