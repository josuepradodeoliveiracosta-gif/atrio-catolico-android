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
  limit,orderBy,query,runTransaction,setDoc,startAfter,Timestamp,updateDoc,where,writeBatch
} from 'firebase/firestore';
import {peerInboxEntries} from '../../firebase/qa-general/chat-inbox-peer-index.mjs';
import {
  applyTrustedInboxEvent,backfillInboxBatch,createAdminInboxStore,createAuthorizedInboxService,
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
    startAfter:(id)=>coll(query(q,startAfter(id))),
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
      'token-stranger':{uid:'inbox-stranger',email_verified:true},
      'token-pagination':{uid:'inbox-pagination-owner',email_verified:true}
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
      assert.deepEqual(await syncBlockedPair(admin,alice,bob),{synced:1,staleRemoved:0});
      assert.equal((await getDocFromServer(doc(db,pathView(alice,bob,idAB)))).exists(),false);
      assert.equal((await getDocFromServer(doc(db,pathView(bob,alice,idAB)))).exists(),false);
    });
    await check('desbloqueio e reconciliação restauram indices consistentes',async()=>{
      await deleteDoc(doc(db,'users/'+bob+'/blockedMembers/'+alice));
      assert.deepEqual(await syncBlockedPair(admin,alice,bob),{synced:1,staleRemoved:0});
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
  await check('evento confiavel sincroniza edicao, bloqueio e exclusao da conversa',async()=>{
    const chatRef=doc(db,'chats/'+idAB);
    const original=(await getDocFromServer(chatRef)).data();
    await updateDoc(chatRef,{lastPreview:'Nova previa autorizada'});
    await applyTrustedInboxEvent(admin,{kind:'chat_written',chatId:idAB});
    assert.equal((await getDocFromServer(doc(db,pathView(alice,bob,idAB)))).get('lastPreview'),
      'Nova previa autorizada');
    await setDoc(doc(db,'users/'+alice+'/blockedMembers/'+bob),{createdAt:Timestamp.now()});
    await applyTrustedInboxEvent(admin,{kind:'block_changed',ownerUid:alice,peerUid:bob});
    assert.equal((await getDocFromServer(doc(db,pathView(alice,bob,idAB)))).exists(),false);
    await deleteDoc(doc(db,'users/'+alice+'/blockedMembers/'+bob));
    await applyTrustedInboxEvent(admin,{kind:'block_changed',ownerUid:alice,peerUid:bob});
    assert.equal((await getDocFromServer(doc(db,pathView(alice,bob,idAB)))).exists(),true);
    const deleteEvent={
      kind:'chat_deleted',chatId:idAB,
      previousChat:{...original,lastPreview:'Nova previa autorizada'}
    };
    // Um evento antigo de exclusão não pode apagar índices de uma
    // conversa que ainda está ativa; pode chegar fora de ordem.
    assert.deepEqual(await applyTrustedInboxEvent(admin,deleteEvent),
      {deleted:0,staleEvent:true});
    assert.equal((await getDocFromServer(doc(db,pathView(alice,bob,idAB)))).exists(),true);
    await deleteDoc(chatRef);
    assert.deepEqual(await applyTrustedInboxEvent(admin,deleteEvent),
      {deleted:2,staleEvent:false});
    assert.deepEqual(await applyTrustedInboxEvent(admin,deleteEvent),
      {deleted:0,staleEvent:false});
    for(const path of [pathView(alice,bob,idAB),pathView(bob,alice,idAB)])
      assert.equal((await getDocFromServer(doc(db,path))).exists(),false);
    // Caso um backend anterior deixe vistas órfãs, o próximo evento
    // de bloqueio deve saneá-las sem reabrir dados da conversa apagada.
    for(const view of peerInboxEntries(idAB,original))
      await setDoc(doc(db,view.path),view.data);
    assert.deepEqual(await syncBlockedPair(admin,alice,bob),
      {synced:0,staleRemoved:2});
    assert.deepEqual(await syncBlockedPair(admin,alice,bob),
      {synced:0,staleRemoved:0});
    for(const path of [pathView(alice,bob,idAB),pathView(bob,alice,idAB)])
      assert.equal((await getDocFromServer(doc(db,path))).exists(),false);
    await assert.rejects(applyTrustedInboxEvent(admin,{kind:'anything'}),/inbox_access_denied/);
  });
  // P0 #355: teste de fronteira real no Firestore Emulator. A quantidade
  // de candidatos OCULTOS nunca deve ser inferida pela presenca de cursor.
  const pageOwner='inbox-pagination-owner';
  const pageToken='token-pagination';
  const pagePeer=i=>'inbox-hidden-'+String(i).padStart(3,'0');
  const allowedPeer=i=>'zz-visible-'+String(i).padStart(3,'0');
  const pageChatId=peer=>pageOwner+'__'+peer;
  const ageDoc=()=>({
    status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',
    reviewExpiresAt:future()
  });
  await setDoc(doc(db,'users/'+pageOwner+'/chatAgeEligibility/current'),ageDoc());
  const seedHidden=async(start,end)=>{
    const batch=writeBatch(db);
    for(let i=start;i<end;i++){
      const peer=pagePeer(i);
      batch.set(doc(db,'users/'+peer+'/chatAgeEligibility/current'),ageDoc());
      batch.set(doc(db,'chats/'+pageChatId(peer)),
        chatData(pageOwner,peer,'SOMENTE TESTE: mensagem privada'));
      // 39/40/41 mesclam as duas direcoes e um bloqueio simultaneo.
      batch.set(doc(db,'users/'+(i%2===0?pageOwner:peer)+'/blockedMembers/'+
        (i%2===0?peer:pageOwner)),{createdAt:Timestamp.now()});
      if(i===0)batch.set(doc(db,'users/'+peer+'/blockedMembers/'+pageOwner),
        {createdAt:Timestamp.now()});
    }
    await batch.commit();
  };
  let hidden39;
  await check('P0 paginacao: 39 candidatos ocultos devolvem vazio sem cursor',async()=>{
    await seedHidden(0,39);
    hidden39=await list(pageToken);
    assert.deepEqual(hidden39,{items:[],nextCursor:null});
  });
  await check('P0 paginacao: 40 candidatos ocultos NAO revelam cursor',async()=>{
    await seedHidden(39,40);
    const hidden40=await list(pageToken);
    assert.deepEqual(hidden40,hidden39,'40 ocultos nao podem mudar formato/paginacao');
  });
  await check('P0 paginacao: 41 candidatos ocultos NAO revelam cursor',async()=>{
    await seedHidden(40,41);
    const hidden41=await list(pageToken);
    assert.deepEqual(hidden41,hidden39,'41 ocultos nao podem revelar cursor');
  });
  const seedVisible=async i=>{
    const peer=allowedPeer(i);
    await setDoc(doc(db,'users/'+peer+'/chatAgeEligibility/current'),ageDoc());
    await setDoc(doc(db,'chats/'+pageChatId(peer)),
      chatData(pageOwner,peer,'Preview autorizado '+i));
  };
  await check('P0 paginacao: visivel apos 41 ocultos e descoberto no servidor',async()=>{
    await seedVisible(0);
    const result=await list(pageToken,{limit:1});
    assert.deepEqual(result.items.map(x=>x.peerUid),[allowedPeer(0)]);
    assert.equal(result.nextCursor,null,'ocultos nao devem gerar cursor extra');
  });
  await check('P0 paginacao: cursor somente quando outro autorizado existe',async()=>{
    await seedVisible(1);
    const first=await list(pageToken,{limit:1});
    assert.deepEqual(first.items.map(x=>x.peerUid),[allowedPeer(0)]);
    assert.ok(first.nextCursor,'segundo contato autorizado permite nova pagina');
    assert.equal(first.nextCursor.includes(pagePeer(0)),false);
    assert.equal(first.nextCursor.includes(allowedPeer(0)),false);
    const second=await list(pageToken,{limit:1,cursor:first.nextCursor});
    assert.deepEqual(second.items.map(x=>x.peerUid),[allowedPeer(1)]);
    assert.equal(second.nextCursor,null);
    await assert.rejects(list(tokens.bob,{cursor:first.nextCursor}),
      /inbox_access_denied/);
    await assert.rejects(list(pageToken,{cursor:first.nextCursor+'x'}),
      /inbox_access_denied/);
  });
  await check('P0 paginacao: HTTP para 41 ocultos nao entrega cursor nem contagem',async()=>{
    // Ocultar os dois autorizados e comparar com retorno de 39 ocultos.
    for(let i=0;i<2;i++)await setDoc(
      doc(db,'users/'+pageOwner+'/blockedMembers/'+allowedPeer(i)),
      {createdAt:Timestamp.now()}
    );
    const handler=createInboxHttpHandler(service,{enabled:true});
    const response=await handler(new Request(
      'https://qa.invalid/v1/qa/conversations/inbox?limit=20',{
        headers:{Authorization:'Bearer '+pageToken}
      }));
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),hidden39);
    assert.match(response.headers.get('cache-control'),/no-store/);
  });
  });
  console.log('AUTHORIZED INBOX DISCOVERY TESTS:',checks,'OK');
}finally{await env.cleanup();}
