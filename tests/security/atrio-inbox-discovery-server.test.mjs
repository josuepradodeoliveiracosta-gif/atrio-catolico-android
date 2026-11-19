/**
 * #355 - Auth + descoberta server-side + materializacao, apenas Emulator QA.
 * Auth e relogio injetados; consultas e transacoes usam o SDK servidor
 * contra o Firestore Emulator. Nenhuma conta ou projeto real.
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Firestore} from '@google-cloud/firestore';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {
  collection,deleteDoc,doc,getDocFromServer,getDocsFromServer,setDoc,Timestamp,updateDoc,writeBatch
} from 'firebase/firestore';
import {
  INBOX_DISCOVERY_CONTROL,INBOX_DISCOVERY_SCHEMA,LEGACY_INBOX_AGE_PAIR,
  inboxDiscoveryCollection,peerInboxEntries
} from '../../firebase/qa-general/chat-inbox-peer-index.mjs';
import {
  applyTrustedInboxEvent,backfillInboxBatch,createAdminInboxStore,createAuthorizedInboxService,
  createInboxHttpHandler,syncBlockedPair
} from '../../firebase/qa-general/chat-inbox-discovery-server.mjs';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
const admin=new Firestore({projectId:'demo-atrio-v11'});
const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089}
});
const alice='inbox-alice',bob='inbox-bob',clara='inbox-clara';
const idAB=alice+'__'+bob,idAC=alice+'__'+clara;
const pathView=(a,b,id)=>'users/'+a+'/chatInboxByPeer/'+b+'/entries/'+id;
const fixtureExpiry=Date.now()+86400_000;
const future=()=>Timestamp.fromMillis(fixtureExpiry);
const chatData=(a,b,preview)=>({
  participants:[a,b],requesterUid:a,recipientUid:b,status:'accepted',
  lastPreview:preview,unreadRequester:0,unreadRecipient:1,lastSenderUid:a,
  updatedAt:Timestamp.now()
});
const baseStore=createAdminInboxStore(admin);
const indexed=(uid,chatId)=>inboxDiscoveryCollection(uid,LEGACY_INBOX_AGE_PAIR)+'/'+chatId;
const ready={ready:true,schema:INBOX_DISCOVERY_SCHEMA};
let checks=0;
async function check(label,work){await work();checks++;console.log('PASS DISCOVERY',label);}
try{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
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
    await backfillInboxBatch(admin,alice);
    await admin.doc(INBOX_DISCOVERY_CONTROL).set(ready);
    const tokens={alice:'token-alice',bob:'token-bob',clara:'token-clara'};
    const verified={
      [tokens.alice]:{uid:alice,email_verified:true},
      [tokens.bob]:{uid:bob,email_verified:true},
      [tokens.clara]:{uid:clara,email_verified:true},
      'token-unverified':{uid:alice,email_verified:false},
      'token-stranger':{uid:'inbox-stranger',email_verified:true},
      'token-pagination':{uid:'inbox-pagination-owner',email_verified:true}
    };
    const sharedCursorKey=randomBytes(32);
    const verifyIdToken=async(token,revoked)=>{
      assert.equal(revoked,true,'obrigatorio validar revogacao');
      if(!verified[token])throw Error('bad_token');
      return verified[token];
    };
    const service=createAuthorizedInboxService({
      verifyIdToken,store:baseStore,cursorKey:sharedCursorKey
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
    await check('bloqueio nao sincronizado falha fechado para ambos, sem pagina parcial',async()=>{
      await setDoc(doc(db,'users/'+alice+'/blockedMembers/'+bob),{createdAt:Timestamp.now()});
      await assert.rejects(list(),/inbox_unavailable/);
      await assert.rejects(list(tokens.bob),/inbox_unavailable/);
      assert.ok((await getDocFromServer(doc(db,pathView(alice,bob,idAB)))).exists());
      await syncBlockedPair(admin,alice,bob);
      const res=await list();
      assert.deepEqual(res.items.map(v=>v.peerUid),[clara]);
      assert.equal(JSON.stringify(res).includes(bob),false);
      assert.equal(JSON.stringify(res).includes('Mensagem reservada do Bob'),false);
      assert.deepEqual(await list(tokens.bob),{items:[],nextCursor:null});
    });
    await check('duplo bloqueio e desbloqueio parcial mantem o par fora da projecao',async()=>{
      await setDoc(doc(db,'users/'+bob+'/blockedMembers/'+alice),{createdAt:Timestamp.now()});
      await syncBlockedPair(admin,alice,bob);
      assert.deepEqual((await list()).items.map(v=>v.peerUid),[clara]);
      await deleteDoc(doc(db,'users/'+alice+'/blockedMembers/'+bob));
      await syncBlockedPair(admin,alice,bob);
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
      await assert.rejects(list(),/inbox_unavailable/);
      await backfillInboxBatch(admin,bob);
      assert.deepEqual((await list()).items.map(v=>v.peerUid),[clara]);
      await setDoc(doc(db,'users/'+bob+'/chatAgeEligibility/current'),{
        status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',
        reviewExpiresAt:future()
      });
      await backfillInboxBatch(admin,bob);
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
    await applyTrustedInboxEvent(admin,{kind:'chat_written',chatId:pageChatId(peer)});
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
  await check('P0 paginacao: cursor em sessao renovada revalida bloqueio',async()=>{
    const page=await list(pageToken,{limit:1});
    assert.ok(page.nextCursor);
    await setDoc(doc(db,'users/'+allowedPeer(1)+'/blockedMembers/'+pageOwner),
      {createdAt:Timestamp.now()});
    await assert.rejects(list(pageToken,{limit:1,cursor:page.nextCursor}),/inbox_unavailable/);
    await syncBlockedPair(admin,pageOwner,allowedPeer(1));
    assert.deepEqual(await list(pageToken,{limit:1,cursor:page.nextCursor}),
      {items:[],nextCursor:null});
    await deleteDoc(doc(db,'users/'+allowedPeer(1)+'/blockedMembers/'+pageOwner));
    await syncBlockedPair(admin,pageOwner,allowedPeer(1));
    const fresh=createAuthorizedInboxService({
      verifyIdToken:async(token,revoked)=>{
        assert.equal(revoked,true);
        if(token!==pageToken)throw Error('invalid');
        return {uid:pageOwner,email_verified:true};
      },
      store:baseStore,
      cursorKey:sharedCursorKey
    });
    const restored=await fresh.list({
      idToken:pageToken,limit:1,cursor:page.nextCursor
    });
    assert.deepEqual(restored.items.map(v=>v.peerUid),[allowedPeer(1)]);
  });
  await check('P0 paginacao: HTTP para 41 ocultos nao entrega cursor nem contagem',async()=>{
    // Excluir os dois autorizados, conservando exatamente 41 ocultos.
    for(let i=0;i<2;i++){
      const chatId=pageChatId(allowedPeer(i));
      const chat=doc(db,'chats/'+chatId);
      const previousChat=(await getDocFromServer(chat)).data();
      await deleteDoc(chat);
      await applyTrustedInboxEvent(admin,{kind:'chat_deleted',chatId,previousChat});
    }
    const handler=createInboxHttpHandler(service,{enabled:true});
    const response=await handler(new Request(
      'https://qa.invalid/v1/qa/conversations/inbox?limit=20',{
        headers:{Authorization:'Bearer '+pageToken}
      }));
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),hidden39);
    assert.match(response.headers.get('cache-control'),/no-store/);
  });
  await check('P0 paginacao: contato visivel antes dos 41 ocultos nao gera cursor',async()=>{
    const visible='aaa-visible-before-hidden';
    await setDoc(doc(db,'users/'+visible+'/chatAgeEligibility/current'),ageDoc());
    await setDoc(doc(db,'chats/'+pageChatId(visible)),
      chatData(pageOwner,visible,'Contato visivel antes dos bloqueados'));
    await applyTrustedInboxEvent(admin,{kind:'chat_written',chatId:pageChatId(visible)});
    const one=await list(pageToken,{limit:1});
    assert.deepEqual(one.items.map(x=>x.peerUid),[visible]);
    assert.equal(one.nextCursor,null);
  });
  await check('projecao privada e controle negam leitura/lista/escrita inclusive ao titular',async()=>{
    const client=env.authenticatedContext(pageOwner,{email_verified:true}).firestore();
    const chatId=pageChatId('aaa-visible-before-hidden');
    await assertFails(getDocFromServer(doc(client,indexed(pageOwner,chatId))));
    await assertFails(getDocsFromServer(collection(client,inboxDiscoveryCollection(pageOwner,LEGACY_INBOX_AGE_PAIR))));
    await assertFails(setDoc(doc(client,indexed(pageOwner,chatId)),{peerExpiresAtMs:fixtureExpiry}));
    await assertFails(getDocFromServer(doc(client,INBOX_DISCOVERY_CONTROL)));
    await assertFails(setDoc(doc(client,INBOX_DISCOVERY_CONTROL),ready));
  });

  async function measuredPage(limitCount,cursor=null) {
    const io={collections:[],queries:0,indexRows:0,documentReads:0};
    const measured=createAdminInboxStore({
      doc:path=>admin.doc(path),
      collection:path=>{
        io.collections.push(path);
        return admin.collection(path);
      },
      runTransaction:(fn,options)=>admin.runTransaction(tx=>fn({
        get:async query=>{
          io.queries++;
          const page=await tx.get(query);
          io.indexRows+=page.size;
          return page;
        },
        getAll:(...refs)=>{
          io.documentReads+=refs.length;
          return tx.getAll(...refs);
        }
      }),options)
    });
    const service=createAuthorizedInboxService({
      verifyIdToken,store:measured,cursorKey:sharedCursorKey
    });
    const result=await service.list({idToken:pageToken,limit:limitCount,cursor});
    return {result,io};
  }
  let expectedByLimit;
  await check('P0: mesmo autorizado alem de 159/160/161 ocultos, com leituras invariantes',async()=>{
    const oldVisible=pageChatId('aaa-visible-before-hidden');
    const chat=doc(db,'chats/'+oldVisible);
    const previousChat=(await getDocFromServer(chat)).data();
    await deleteDoc(chat);
    await applyTrustedInboxEvent(admin,{kind:'chat_deleted',chatId:oldVisible,previousChat});
    await seedVisible(0);

    const at41=await measuredPage(1);
    assert.deepEqual(at41.result.items.map(item=>item.peerUid),[allowedPeer(0)]);
    assert.equal(at41.result.nextCursor,null);
    assert.deepEqual(at41.io,{
      collections:[inboxDiscoveryCollection(pageOwner,LEGACY_INBOX_AGE_PAIR)],
      queries:1,indexRows:1,documentReads:7
    });
    await seedHidden(41,159);
    assert.deepEqual(await measuredPage(1),at41);
    await seedHidden(159,160);
    assert.deepEqual(await measuredPage(1),at41);
    await seedHidden(160,161);
    assert.deepEqual(await measuredPage(1),at41);
    // Eventos de bloqueio sobre as duas pontas acima da fronteira não
    // introduzem uma entrada em nenhuma das projeções.
    for(const i of [0,159,160]){
      const peer=pagePeer(i);
      await applyTrustedInboxEvent(admin,{kind:'chat_written',chatId:pageChatId(peer)});
      assert.equal((await admin.doc(indexed(pageOwner,pageChatId(peer))).get()).exists,false);
      assert.equal((await admin.doc(indexed(peer,pageChatId(peer))).get()).exists,false);
    }
  });
  async function assertTraversal(limitCount) {
    const first=await measuredPage(limitCount);
    assert.deepEqual(first.result.items.map(item=>item.peerUid),
      Array.from({length:limitCount},(_,i)=>allowedPeer(i)));
    assert.ok(first.result.nextCursor);
    assert.equal(first.io.queries,1);
    assert.equal(first.io.indexRows,limitCount+1);
    assert.equal(first.io.documentReads,3+4*(limitCount+1));
    assert.deepEqual(first.io.collections,[inboxDiscoveryCollection(pageOwner,LEGACY_INBOX_AGE_PAIR)]);
    const ids=[];
    let cursor=first.result.nextCursor;
    while(cursor){
      const page=await measuredPage(limitCount,cursor);
      ids.push(...page.result.items.map(item=>item.peerUid));
      cursor=page.result.nextCursor;
      assert.ok(ids.length<=21-limitCount,'paginacao sem repeticao');
    }
    assert.deepEqual(ids,Array.from({length:21-limitCount},(_,i)=>allowedPeer(limitCount+i)));
    return first.io;
  }
  await check('P0: limites 1 e 20, mesma continuacao com 159/160/161 ou 240 ocultos',async()=>{
    for(let i=1;i<21;i++)await seedVisible(i);
    // Voltar a 159 e reintroduzir os mesmos ocultos sem tocar nos autorizados.
    for(const i of [159,160])await deleteDoc(doc(db,'chats/'+pageChatId(pagePeer(i))));
    expectedByLimit=[await assertTraversal(1),await assertTraversal(20)];
    for(const [start,end] of [[159,160],[160,161],[161,240]]){
      await seedHidden(start,end);
      assert.deepEqual([await assertTraversal(1),await assertTraversal(20)],expectedByLimit);
    }
  });
  const pageRequest=()=>new Request('https://qa.invalid/v1/qa/conversations/inbox?limit=1',{
    headers:{Authorization:'Bearer '+pageToken}
  });
  await check('HTTP indisponivel sem corte certificado ou com lookahead desatualizado',async()=>{
    const handler=createInboxHttpHandler(service,{enabled:true});
    await admin.doc(INBOX_DISCOVERY_CONTROL).delete();
    const unready=await handler(pageRequest());
    assert.equal(unready.status,503);
    assert.deepEqual(await unready.json(),{error:'inbox_unavailable'});
    await admin.doc(INBOX_DISCOVERY_CONTROL).set(ready);
    const blocked=doc(db,'users/'+allowedPeer(1)+'/blockedMembers/'+pageOwner);
    await setDoc(blocked,{createdAt:Timestamp.now()});
    const stale=await handler(pageRequest());
    assert.equal(stale.status,503);
    assert.deepEqual(await stale.json(),{error:'inbox_unavailable'});
    assert.match(stale.headers.get('cache-control'),/no-store/);
    await syncBlockedPair(admin,pageOwner,allowedPeer(1));
    const valid=await handler(pageRequest());
    assert.equal(valid.status,200);
    const json=await valid.json();
    assert.deepEqual(json.items.map(item=>item.peerUid),[allowedPeer(0)]);
    assert.ok(json.nextCursor,'terceiro autorizado continua alcançavel');
    const second=await list(pageToken,{limit:1,cursor:json.nextCursor});
    assert.deepEqual(second.items.map(item=>item.peerUid),[allowedPeer(2)]);
    await deleteDoc(blocked);
    await syncBlockedPair(admin,pageOwner,allowedPeer(1));
  });
  await check('fonte ausente impede cursor calculado de uma entrada orfa',async()=>{
    const chatId=pageChatId(allowedPeer(1));
    const chat=admin.doc('chats/'+chatId);
    const previousChat=(await chat.get()).data();
    await chat.delete();
    assert.equal((await admin.doc(indexed(pageOwner,chatId)).get()).exists,true);
    await assert.rejects(list(pageToken,{limit:1}),/inbox_unavailable/);
    await applyTrustedInboxEvent(admin,{kind:'chat_deleted',chatId,previousChat});
    await applyTrustedInboxEvent(admin,{kind:'chat_deleted',chatId,previousChat});
    assert.equal((await admin.doc(indexed(pageOwner,chatId)).get()).exists,false);
    const page=await list(pageToken,{limit:1});
    const next=await list(pageToken,{limit:1,cursor:page.nextCursor});
    assert.deepEqual(next.items.map(item=>item.peerUid),[allowedPeer(2)]);
    await seedVisible(1);
  });
  await check('prazo exclui elegibilidade expirada sem evento e cursor expira em dez minutos',async()=>{
    let now=Date.now();
    const shortly=now+30_000;
    await updateDoc(doc(db,'users/'+allowedPeer(0)+'/chatAgeEligibility/current'),{
      reviewExpiresAt:Timestamp.fromMillis(shortly)
    });
    await applyTrustedInboxEvent(admin,{kind:'chat_written',chatId:pageChatId(allowedPeer(0))});
    const timed=createAuthorizedInboxService({
      verifyIdToken,store:baseStore,cursorKey:sharedCursorKey,clock:()=>now
    });
    const args={idToken:pageToken,limit:1};
    const start=await timed.list(args);
    assert.equal(start.items[0].peerUid,allowedPeer(0));
    now=shortly;
    const withoutOld=await timed.list({...args,cursor:start.nextCursor});
    assert.equal(withoutOld.items[0].peerUid,allowedPeer(1));
    assert.ok((await admin.doc(indexed(pageOwner,pageChatId(allowedPeer(0)))).get()).exists);
    now+=10*60*1000;
    await assert.rejects(timed.list({...args,cursor:start.nextCursor}),/inbox_access_denied/);
  });
  await check('politicas etarias aceitas paginam juntas e a politica excluida nao ocupa lookahead',async()=>{
    const newPeer='inbox-future-policy';
    const chatId=pageChatId(newPeer);
    await setDoc(doc(db,'users/'+newPeer+'/chatAgeEligibility/current'),{
      status:'declared_18_plus',policyVersion:'2026-11-selfdecl-qa-v1',
      minimumAge:18,reviewExpiresAt:future()
    });
    await setDoc(doc(db,'chats/'+chatId),chatData(pageOwner,newPeer,'QA'));
    await applyTrustedInboxEvent(admin,{kind:'chat_written',chatId});
    const make=(...acceptedPairs)=>createAuthorizedInboxService({
      verifyIdToken,store:baseStore,cursorKey:sharedCursorKey,acceptedPairs
    });
    const args={idToken:pageToken,limit:2};
    assert.deepEqual((await list(pageToken,{limit:2})).items.map(item=>item.peerUid),
      [allowedPeer(0),allowedPeer(1)]);
    const both=make(LEGACY_INBOX_AGE_PAIR,'declared_18_plus|2026-11-selfdecl-qa-v1');
    const first=await both.list(args);
    assert.deepEqual(first.items.map(item=>item.peerUid),[allowedPeer(0),newPeer]);
    const next=await both.list({...args,cursor:first.nextCursor});
    assert.deepEqual(next.items.map(item=>item.peerUid),[allowedPeer(1),allowedPeer(2)]);
  });
  });
  console.log('AUTHORIZED INBOX DISCOVERY TESTS:',checks,'OK');
}finally{await Promise.all([env.cleanup(),admin.terminate()]);}
