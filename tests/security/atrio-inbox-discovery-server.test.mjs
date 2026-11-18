/**
 * #355 - Auth + descoberta server-side + materializacao, apenas Emulator QA.
 * Nao usa token/conta/remoto reais; adaptador de Admin mantem contrato
 * de query/transaction do servidor usando Firestore SDK do emulador.
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {
  collection,deleteDoc,doc,documentId,getDocFromServer,getDocsFromServer,
  limit,orderBy,query,runTransaction,setDoc,startAfter,Timestamp,where,writeBatch
} from 'firebase/firestore';
import {peerInboxEntries} from '../../firebase/qa-general/chat-inbox-peer-index.mjs';
import {
  backfillInboxBatch,createAdminInboxStore,createAuthorizedInboxService,
  createInboxHttpHandler,syncBlockedPair
} from '../../firebase/qa-general/chat-inbox-discovery-server.mjs';

const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089}
});
const alice='inbox-alice',bob='inbox-bob',clara='inbox-clara';
const idAB=alice+'__'+bob,idAC=alice+'__'+clara;
const pathView=(a,b,id)=>'users/'+a+'/chatInboxByPeer/'+b+'/entries/'+id;
const future=()=>Timestamp.fromMillis(Date.now()+86400_000);
const chatData=(a,b,preview)=>({
  participants:[a,b],requesterUid:a,recipientUid:b,status:'accepted',
  lastPreview:preview,unreadRequester:0,unreadRecipient:1,lastSenderUid:a,
  updatedAt:Timestamp.now()
});
function adminAdapter(db){
  const ref=path=>({
    raw:doc(db,path),
    async get(){return convert(await getDocFromServer(this.raw));}
  });
  const convert=s=>({exists:s.exists(),data:()=>s.data(),id:s.id});
  const coll=q=>({
    where:(field,op,value)=>coll(query(q,where(field,op,value))),
    orderBy:(name)=>coll(query(q,orderBy(name==='__name__'?documentId():name))),
    limit:(n)=>coll(query(q,limit(n))),
    startAfter:(r)=>coll(query(q,startAfter(r.raw))),
    get:async()=>({docs:(await getDocsFromServer(q)).docs.map(convert)})
  });
  return {
    doc:ref,
    collection:path=>coll(collection(db,path)),
    runTransaction:fn=>runTransaction(db,tx=>fn({
      get:async r=>convert(await tx.get(r.raw)),
      set:(r,data)=>tx.set(r.raw,data),
      delete:r=>tx.delete(r.raw)
    }))
  };
}
let checks=0;
async function check(label,work){await work();checks++;console.log('PASS DISCOVERY',label);}
try{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore(),admin=adminAdapter(db);
    const batch=writeBatch(db);
    batch.set(doc(db,'app_config/conversations'),{
      enabled:true,minorPolicyApproved:true,safetyReviewVersion:'2026-11-safety-v1',
      version:'2026-11-v1'
    });
    for(const uid of [alice,bob,clara]){
      batch.set(doc(db,'users/'+uid+'/chatAgeEligibility/current'),{
        status:'eligible',policyVersion:'2026-11-18plus-qa-v1',minimumAge:18,
        reviewExpiresAt:future()
      });
    }
    for(const [chatId,data] of [
      [idAB,chatData(alice,bob,'Mensagem reservada do Bob')],
      [idAC,chatData(alice,clara,'Mensagem reservada da Clara')]
    ]){
      batch.set(doc(db,'chats/'+chatId),data);
      for(const entry of peerInboxEntries(chatId,data))
        batch.set(doc(db,entry.path),entry.data);
    }
    await batch.commit();
    const tokens={alice:'token-alice',bob:'token-bob',clara:'token-clara'};
    const verified={
      [tokens.alice]:{uid:alice,email_verified:true},
      [tokens.bob]:{uid:bob,email_verified:true},
      [tokens.clara]:{uid:clara,email_verified:true},
      'token-unverified':{uid:alice,email_verified:false},
      'token-stranger':{uid:'inbox-stranger',email_verified:true}
    };
    const service=createAuthorizedInboxService({
      verifyIdToken:async(token,revoked)=>{
        assert.equal(revoked,true,'obrigatorio validar revogacao');
        if(!verified[token])throw Error('bad_token');
        return verified[token];
      },
      store:createAdminInboxStore(admin),
      cursorKey:randomBytes(32)
    });
    const list=(token=tokens.alice,args={})=>
      service.list({idToken:token,...args});
    await check('servidor descobre os dois contatos sem consultar list(chats) no cliente',async()=>{
      const result=await list();
      assert.deepEqual(result.items.map(v=>v.peerUid),[bob,clara]);
      assert.equal(result.items[0].lastPreview,'Mensagem reservada do Bob');
      assert.equal(result.nextCursor,null);
      assert.equal((await list(tokens.bob)).items[0].peerUid,alice);
    });
    let page;
    await check('paginacao usa cursor cifrado e nao revela UIDs de contatos bloqueados',async()=>{
      page=await list(tokens.alice,{limit:1});
      assert.equal(page.items.length,1);
      assert.ok(page.nextCursor);
      assert.equal(page.nextCursor.includes(bob),false);
      assert.equal(page.nextCursor.includes(idAB),false);
      const second=await list(tokens.alice,{limit:1,cursor:page.nextCursor});
      assert.deepEqual(second.items.map(v=>v.peerUid),[clara]);
      assert.equal(second.nextCursor,null);
    });
    await check('token forjado, nao verificado, outro dono e cursor adulterado negados',async()=>{
      await assert.rejects(list('invalid-token'),/inbox_access_denied/);
      await assert.rejects(list('token-unverified'),/inbox_access_denied/);
      await assert.rejects(list('token-stranger'),/inbox_access_denied/);
      await assert.rejects(list(tokens.bob,{cursor:page.nextCursor}),/inbox_access_denied/);
      await assert.rejects(list(tokens.alice,{cursor:page.nextCursor+'x'}),/inbox_access_denied/);
      await assert.rejects(list(tokens.alice,{limit:21}),/inbox_access_denied/);
    });
    await check('bloqueio Alice para Bob oculta totalmente UID, preview e tamanho',async()=>{
      await setDoc(doc(db,'users/'+alice+'/blockedMembers/'+bob),{createdAt:Timestamp.now()});
      const res=await list();
      assert.deepEqual(res.items.map(v=>v.peerUid),[clara]);
      assert.equal(JSON.stringify(res).includes(bob),false);
      assert.equal(JSON.stringify(res).includes('Mensagem reservada do Bob'),false);
      assert.equal((await list(tokens.bob)).items.length,0);
      // Indice anterior ainda existe; check backend nao depende de reconciliacao.
      assert.ok((await getDocFromServer(doc(db,pathView(alice,bob,idAB)))).exists());
    });
    await check('duplo bloqueio e desbloqueio parcial permanecem fail-closed',async()=>{
      await setDoc(doc(db,'users/'+bob+'/blockedMembers/'+alice),{createdAt:Timestamp.now()});
      assert.deepEqual((await list()).items.map(v=>v.peerUid),[clara]);
      await deleteDoc(doc(db,'users/'+alice+'/blockedMembers/'+bob));
      assert.deepEqual((await list()).items.map(v=>v.peerUid),[clara]);
    });
    await check('materializador em evento de bloqueio remove vistas de AMBOS',async()=>{
      assert.deepEqual(await syncBlockedPair(admin,alice,bob),{synced:1});
      assert.equal((await getDocFromServer(doc(db,pathView(alice,bob,idAB)))).exists(),false);
      assert.equal((await getDocFromServer(doc(db,pathView(bob,alice,idAB)))).exists(),false);
    });
    await check('desbloqueio e reconciliação restauram indices consistentes',async()=>{
      await deleteDoc(doc(db,'users/'+bob+'/blockedMembers/'+alice));
      assert.deepEqual(await syncBlockedPair(admin,alice,bob),{synced:1});
      assert.equal((await getDocFromServer(doc(db,pathView(alice,bob,idAB)))).exists(),true);
      assert.deepEqual((await list()).items.map(v=>v.peerUid),[bob,clara]);
    });
    await check('backfill paginado recria visoes sem cliente escrever indices',async()=>{
      await deleteDoc(doc(db,pathView(alice,clara,idAC)));
      const result=await backfillInboxBatch(admin,alice,{limit:1});
      assert.equal(result.processed,1);
      assert.ok(result.nextAfter);
      const next=await backfillInboxBatch(admin,alice,{after:result.nextAfter,limit:1});
      assert.equal(next.processed,1);
      assert.equal((await getDocFromServer(doc(db,pathView(alice,clara,idAC)))).exists(),true);
    });
    await check('revogacao etaria do contato impede revelar dados apesar de indice ativo',async()=>{
      await setDoc(doc(db,'users/'+bob+'/chatAgeEligibility/current'),{
        status:'revoked',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',
        reviewExpiresAt:future()
      });
      assert.deepEqual((await list()).items.map(v=>v.peerUid),[clara]);
      await setDoc(doc(db,'users/'+bob+'/chatAgeEligibility/current'),{
        status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',
        reviewExpiresAt:future()
      });
    });
    await check('nova declaracao da #232 nao abre Rules legadas sem migracao aprovada',async()=>{
      await setDoc(doc(db,'users/'+alice+'/chatAgeEligibility/current'),{
        status:'declared_18_plus',minimumAge:18,policyVersion:'2026-11-selfdecl-qa-v1',
        reviewExpiresAt:future()
      });
      await assert.rejects(list(),/inbox_access_denied/);
      await setDoc(doc(db,'users/'+alice+'/chatAgeEligibility/current'),{
        status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',
        reviewExpiresAt:future()
      });
    });
    await check('desligamento administrativo impede toda descoberta',async()=>{
      await setDoc(doc(db,'app_config/conversations'),{
        enabled:false,minorPolicyApproved:true,
        safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'
      });
      await assert.rejects(list(),/inbox_access_denied/);
      await setDoc(doc(db,'app_config/conversations'),{
        enabled:true,minorPolicyApproved:true,
        safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'
      });
    });
    await check('HTTP fechado por padrao e resposta autenticada nunca cacheavel',async()=>{
      const closed=createInboxHttpHandler(service);
      const request=(path,token=tokens.alice,method='GET')=>
        new Request('https://qa.invalid'+path,{method,
          headers:{Authorization:'Bearer '+token}});
      assert.equal((await closed(request('/v1/qa/conversations/inbox'))).status,503);
      const handler=createInboxHttpHandler(service,{enabled:true});
      const res=await handler(request('/v1/qa/conversations/inbox?limit=2'));
      assert.equal(res.status,200);
      assert.match(res.headers.get('cache-control'),/no-store/);
      assert.equal((await res.json()).items.length,2);
      assert.equal((await handler(request('/v1/qa/conversations/inbox?uid='+alice))).status,400);
      assert.equal((await handler(request('/v1/qa/conversations/inbox',tokens.alice,'POST'))).status,405);
      assert.equal((await handler(request('/v1/qa/conversations/inbox','invalid-token'))).status,403);
    });
  });
  console.log('AUTHORIZED INBOX DISCOVERY TESTS:',checks,'OK');
}finally{await env.cleanup();}
