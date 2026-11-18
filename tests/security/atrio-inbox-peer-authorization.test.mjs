/**
 * #355 - Firebase Emulator isolado. Nenhum dado, identidade ou regra remota.
 * Prova que uma listagem global de chats nao pode vazar metadados, mesmo
 * quando os indices de inbox estao desatualizados e ha bloqueios concorrentes.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {
  collection,collectionGroup,deleteDoc,doc,getDocFromServer,getDocsFromServer,
  limit,query,runTransaction,serverTimestamp,setDoc,Timestamp,updateDoc,where,writeBatch
} from 'firebase/firestore';
import {renderParity} from '../../firebase/qa-general/compose-parity-rules.mjs';
import {peerInboxEntries,reconcilePeerInbox} from '../../firebase/qa-general/chat-inbox-peer-index.mjs';

const base=readFileSync('../../firestore.rules','utf8');
const chat=readFileSync('../../firebase/atrio-conversas-v1.rules.fragment','utf8');
const groups=readFileSync('../../firebase/atrio-grupos-v1.rules.fragment','utf8');
const rules=renderParity(base,chat,groups);
const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules}
});
const u='inbox-alice',v='inbox-bob',w='inbox-clara';
const a=env.authenticatedContext(u,{email_verified:true}).firestore();
const b=env.authenticatedContext(v,{email_verified:true}).firestore();
const c=env.authenticatedContext(w,{email_verified:true}).firestore();
const unverified=env.authenticatedContext(u,{email_verified:false}).firestore();
const stranger=env.authenticatedContext('inbox-stranger',{email_verified:true}).firestore();
const guest=env.unauthenticatedContext().firestore();
const id=u+'__'+v,otherId=u+'__'+w;
const entry=(owner,peer,chatId=id)=>'users/'+owner+'/chatInboxByPeer/'+peer+'/entries/'+chatId;
const peerQuery=(db,owner,peer)=>
  query(collection(db,'users/'+owner+'/chatInboxByPeer/'+peer+'/entries'),limit(20));
const legacyQuery=(db,owner)=>
  query(collection(db,'chats'),where('participants','array-contains',owner),limit(100));
const expiry=()=>Timestamp.fromMillis(Date.now()+86_400_000);
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS INBOX',name);}
const chatData=(first,second,text)=>({
  participants:[first,second],requesterUid:first,recipientUid:second,
  status:'accepted',lastPreview:text,updatedAt:Timestamp.now()
});
try{
  await env.clearFirestore();
  const main=chatData(u,v,'Prévia privada Alice/Bob');
  const other=chatData(u,w,'Prévia isolada Alice/Clara');
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    const batch=writeBatch(db);
    batch.set(doc(db,'app_config/conversations'),{
      enabled:true,minorPolicyApproved:true,version:'2026-11-v1',
      safetyReviewVersion:'2026-11-safety-v1'
    });
    for(const uid of [u,v,w]){
      batch.set(doc(db,'users/'+uid+'/chatAgeEligibility/current'),{
        status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',
        reviewExpiresAt:expiry()
      });
    }
    for(const [chatId,data] of [[id,main],[otherId,other]]){
      batch.set(doc(db,'chats/'+chatId),data);
      for(const view of peerInboxEntries(chatId,data)) batch.set(doc(db,view.path),view.data);
    }
    await batch.commit();
  });
  await check('materializador rejeita dono ausente, chatId trocado e pares forjados',()=>{
    assert.throws(()=>peerInboxEntries(id,{...main,recipientUid:u}),/inbox_invalid_contract/);
    assert.throws(()=>peerInboxEntries(otherId,main),/inbox_invalid_contract/);
    assert.throws(()=>peerInboxEntries(id,{...main,participants:[u,w]}),/inbox_invalid_contract/);
  });
  await check('listagem global de chats é recusada até para participante válido',async()=>{
    for(const [db,uid] of [[a,u],[b,v],[c,w]])
      await assertFails(getDocsFromServer(legacyQuery(db,uid)));
  });
  await check('consulta peer-scoped retorna apenas índice materializado do par permitido',async()=>{
    for(const [db,owner,peer,chatId] of [[a,u,v,id],[b,v,u,id],[a,u,w,otherId],[c,w,u,otherId]]){
      const rows=await assertSucceeds(getDocsFromServer(peerQuery(db,owner,peer)));
      assert.equal(rows.size,1);
      assert.equal(rows.docs[0].id,chatId);
      const view=await assertSucceeds(getDocFromServer(doc(db,entry(owner,peer,chatId))));
      assert.equal(view.data().ownerUid,owner);
      assert.equal(view.data().peerUid,peer);
    }
  });
  await check('sem limite e consulta global collectionGroup são recusados',async()=>{
    await assertFails(getDocsFromServer(collection(a,'users/'+u+'/chatInboxByPeer/'+v+'/entries')));
    await assertFails(getDocsFromServer(query(collectionGroup(a,'entries'),limit(20))));
  });
  await check('alheio, anonimo e email nao verificado nao leem indice',async()=>{
    for(const db of [b,stranger,guest,unverified]){
      await assertFails(getDocFromServer(doc(db,entry(u,v))));
      await assertFails(getDocsFromServer(peerQuery(db,u,v)));
    }
  });
  await check('cliente nao cria, altera, suprime nem forja indices privados',async()=>{
    const path=entry(u,v);
    await assertFails(setDoc(doc(a,path),{ownerUid:u,peerUid:v,chatId:id,fromClient:true}));
    await assertFails(updateDoc(doc(a,path),{lastPreview:'Forjado'}));
    await assertFails(deleteDoc(doc(a,path)));
    await assertFails(setDoc(doc(b,entry(v,u,'forged')),{
      ownerUid:v,peerUid:u,chatId:'forged'
    }));
  });
  await check('bloqueio Alice→Bob nega GET e LIST aos DOIS mesmo com index antigo',async()=>{
    await assertSucceeds(setDoc(doc(a,'users/'+u+'/blockedMembers/'+v),{
      createdAt:serverTimestamp()
    }));
    for(const [db,owner,peer] of [[a,u,v],[b,v,u]]){
      await assertFails(getDocFromServer(doc(db,entry(owner,peer))));
      await assertFails(getDocsFromServer(peerQuery(db,owner,peer)));
    }
    // A outra conversa continua disponivel, sem abrir leitura de Bob.
    assert.equal((await assertSucceeds(getDocsFromServer(peerQuery(a,u,w)))).size,1);
    await env.withSecurityRulesDisabled(async ctx=>{
      assert.equal((await getDocFromServer(doc(ctx.firestore(),entry(u,v)))).exists(),true);
    });
  });
  await check('bloqueio simultâneo Bob→Alice mantém ambas as recusas',async()=>{
    await assertSucceeds(setDoc(doc(b,'users/'+v+'/blockedMembers/'+u),{
      createdAt:serverTimestamp()
    }));
    await assertFails(getDocsFromServer(peerQuery(a,u,v)));
    await assertFails(getDocsFromServer(peerQuery(b,v,u)));
  });
  await check('retirar só um bloqueio não reabre GET/LIST',async()=>{
    await assertSucceeds(deleteDoc(doc(a,'users/'+u+'/blockedMembers/'+v)));
    await assertFails(getDocFromServer(doc(b,entry(v,u))));
    await assertFails(getDocsFromServer(peerQuery(a,u,v)));
  });
  await check('depois de remover ambos, GET/LIST voltam sem escrita no índice',async()=>{
    await assertSucceeds(deleteDoc(doc(b,'users/'+v+'/blockedMembers/'+u)));
    assert.equal((await assertSucceeds(getDocsFromServer(peerQuery(a,u,v)))).size,1);
    assert.equal((await assertSucceeds(getDocsFromServer(peerQuery(b,v,u)))).size,1);
  });
  await check('transacao de materializacao confiavel preserva ambos os indices',async()=>{
    await env.withSecurityRulesDisabled(async ctx=>{
      const db=ctx.firestore();
      const admin={
        doc:path=>doc(db,path),
        runTransaction:callback=>runTransaction(db,tx=>callback({
          get:async ref=>{
            const snapshot=await tx.get(ref);
            return {exists:snapshot.exists(),data:()=>snapshot.data()};
          },
          set:(ref,data)=>tx.set(ref,data),
          delete:ref=>tx.delete(ref)
        }))
      };
      const result=await reconcilePeerInbox(admin,id);
      assert.deepEqual(result,{blocked:false,views:2});
      assert.ok((await getDocFromServer(doc(db,entry(u,v)))).exists());
      assert.ok((await getDocFromServer(doc(db,entry(v,u)))).exists());
    });
  });
  await check('reconectar / sessão nova continua respeitando bloqueio no servidor',async()=>{
    await assertSucceeds(setDoc(doc(b,'users/'+v+'/blockedMembers/'+u),{
      createdAt:serverTimestamp()
    }));
    const fresh=env.authenticatedContext(u,{email_verified:true}).firestore();
    await assertFails(getDocFromServer(doc(fresh,entry(u,v))));
    await assertFails(getDocsFromServer(peerQuery(fresh,u,v)));
    await assertFails(getDocsFromServer(legacyQuery(fresh,u)));
  });
  await check('desativação administrativa revoga todos os índices',async()=>{
    await env.withSecurityRulesDisabled(async ctx=>{
      await updateDoc(doc(ctx.firestore(),'app_config/conversations'),{enabled:false});
    });
    await assertFails(getDocsFromServer(peerQuery(a,u,w)));
    await assertFails(getDocFromServer(doc(c,entry(w,u,otherId))));
  });
  console.log('INBOX PEER SECURITY TESTS:',passed,'OK');
}finally{await env.cleanup();}
