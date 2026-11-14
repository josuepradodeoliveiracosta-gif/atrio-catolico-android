/**
 * Contratos da política candidata QA Perfil 2.0: SOMENTE Firebase Emulator.
 * Não conecta Firebase remoto e não autoriza publicação.
 * Testar após iniciar a suíte em tests/security via npm test.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {
  collection,doc,documentId,getDoc,getDocs,limit,orderBy,query,
  serverTimestamp,setDoc,startAfter,Timestamp,updateDoc,where,writeBatch
} from 'firebase/firestore';

const PROJECT='demo-atrio-v11';
const UID='qa-perfil-owner';
const OTHER='qa-perfil-other';
const rules=readFileSync('../../firebase/qa-perfil/firestore.rules','utf8');
const env=await initializeTestEnvironment({
  projectId:PROJECT,
  firestore:{host:'127.0.0.1',port:8089,rules},
});
const owner=env.authenticatedContext(UID,{email:'owner@example.test',email_verified:true}).firestore();
const unverified=env.authenticatedContext(UID,{email:'owner@example.test',email_verified:false}).firestore();
const other=env.authenticatedContext(OTHER,{email:'other@example.test',email_verified:true}).firestore();
const guest=env.unauthenticatedContext().firestore();
const ownerPath='profiles/'+UID;
const publicPath='public_profiles/'+UID;
let checks=0;
async function verify(name,fn) {
  await fn();
  checks++;
  console.log('PASS QA PERFIL RULES',name);
}
function ordered(db,uid,n=20){
  return query(collection(db,'posts'),where('uid','==',uid),
    orderBy('createdAt','desc'),limit(n));
}
function legacy(db,uid){
  return query(collection(db,'posts'),where('uid','==',uid),
    orderBy(documentId()),limit(20));
}
try {
  await env.clearFirestore();
  await verify('cadastro privado próprio sem e-mail verificado, com schema mínimo',async()=>{
    await assertSucceeds(setDoc(doc(unverified,ownerPath),{
      displayName:'Pessoa de Teste',createdAt:serverTimestamp(),
    }));
    await assertFails(setDoc(doc(other,'profiles/'+OTHER),{
      displayName:'Nome',createdAt:serverTimestamp(),admin:true,
    }));
    await assertFails(setDoc(doc(other,'profiles/'+UID),{
      displayName:'Intruso',createdAt:serverTimestamp(),
    }));
  });
  await verify('perfil privado: leitura do titular, nunca terceiros, anônimo ou enumeração',async()=>{
    await assertSucceeds(getDoc(doc(owner,ownerPath)));
    await assertSucceeds(getDoc(doc(unverified,ownerPath)));
    await assertFails(getDoc(doc(other,ownerPath)));
    await assertFails(getDoc(doc(guest,ownerPath)));
    await assertFails(getDocs(collection(owner,'profiles')));
  });
  await verify('opt-in público exige e-mail verificado e não expõe privado',async()=>{
    const privateDoc=await getDoc(doc(owner,ownerPath));
    const payload={
      displayName:'Pessoa de Teste',bio:'',
      joinedAt:privateDoc.data().createdAt,updatedAt:serverTimestamp(),
    };
    await assertFails(setDoc(doc(unverified,publicPath),payload));
    await assertFails(setDoc(doc(other,publicPath),payload));
    await assertSucceeds(setDoc(doc(owner,publicPath),payload));
    await assertSucceeds(getDoc(doc(other,publicPath)));
    await assertFails(getDoc(doc(unverified,publicPath)));
    await assertFails(getDocs(collection(owner,'public_profiles')));
  });
  await verify('edição privada exige mesma transação da apresentação pública',async()=>{
    await assertFails(updateDoc(doc(owner,ownerPath),{
      displayName:'Novo Nome',bio:'Nova bio',
    }));
    const createdAt=(await getDoc(doc(owner,ownerPath))).data().createdAt;
    const batch=writeBatch(owner);
    batch.update(doc(owner,ownerPath),{displayName:'Novo Nome',bio:'Nova bio'});
    batch.set(doc(owner,publicPath),{
      displayName:'Novo Nome',bio:'Nova bio',
      joinedAt:createdAt,updatedAt:serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
    const updated=await getDoc(doc(owner,publicPath));
    assert.equal(updated.data().displayName,'Novo Nome');
  });
  await verify('atributos alheios e atualização não verificada negados',async()=>{
    await assertFails(updateDoc(doc(other,ownerPath),{bio:'Invasão'}));
    await assertFails(updateDoc(doc(unverified,ownerPath),{bio:'Sem e-mail verificado'}));
    await assertFails(updateDoc(doc(owner,ownerPath),{role:'admin'}));
    await assertFails(setDoc(doc(owner,publicPath),{
      displayName:'Falso',bio:'Descompasso',joinedAt:Timestamp.now(),
      updatedAt:serverTimestamp(),
    }));
  });
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    const batch=writeBatch(db);
    for(let i=0;i<25;i++)batch.set(doc(db,'posts','dated-'+String(i).padStart(2,'0')),{
      uid:UID,title:'Discussão fictícia '+i,createdAt:Timestamp.fromMillis(1750000000000+i*1000),
    });
    for(let i=0;i<2;i++)batch.set(doc(db,'posts','legacy-'+i),{
      uid:UID,title:'Discussão antiga fictícia '+i,
    });
    batch.set(doc(db,'posts','other-post'),{
      uid:OTHER,title:'Post de outra conta',createdAt:Timestamp.fromMillis(1750000000000),
    });
    batch.set(doc(db,'badges',UID),{lay:'leigo'});
    await batch.commit();
  });
  await verify('histórico ordenado com 20+5 e cursor: somente fixtures',async()=>{
    const base=ordered(owner,UID);
    const first=await assertSucceeds(getDocs(base));
    const second=await assertSucceeds(getDocs(query(base,startAfter(first.docs.at(-1)))));
    assert.deepEqual([first.size,second.size],[20,5]);
    assert.equal(new Set([...first.docs,...second.docs].map(x=>x.id)).size,25);
    assert.ok([...first.docs,...second.docs].every(x=>x.data().uid===UID));
  });
  await verify('varredura legada com limite 20 preservada',async()=>{
    const page=await assertSucceeds(getDocs(legacy(owner,UID)));
    assert.equal(page.size,20);
    assert.ok(page.docs.every(x=>x.data().uid===UID));
  });
  await verify('posts comunitários acessíveis a outra conta verificada, não privados por UID',async()=>{
    const page=await assertSucceeds(getDocs(ordered(other,UID)));
    assert.equal(page.size,20);
    await assertSucceeds(getDoc(doc(other,'posts/dated-00')));
  });
  await verify('anônimo, e-mail não verificado e consulta sem limite/limit 21 negados',async()=>{
    await assertFails(getDocs(ordered(guest,UID)));
    await assertFails(getDocs(ordered(unverified,UID)));
    await assertFails(getDoc(doc(unverified,'posts/dated-00')));
    await assertFails(getDocs(query(collection(owner,'posts'),where('uid','==',UID))));
    await assertFails(getDocs(ordered(owner,UID,21)));
  });
  await verify('clientes não podem criar, editar nem excluir posts de QA',async()=>{
    await assertFails(setDoc(doc(owner,'posts/new'),{uid:UID,title:'Não permitido'}));
    await assertFails(updateDoc(doc(owner,'posts/dated-00'),{title:'Alterado'}));
    await assertFails(setDoc(doc(owner,'posts/dated-00'),{uid:UID,title:'Substituído'}));
  });
  await verify('selos e fotos: leitura autenticada verificada, sem alteração de privilégios',async()=>{
    await assertSucceeds(getDoc(doc(owner,'badges/'+UID)));
    await assertFails(getDoc(doc(guest,'badges/'+UID)));
    await assertFails(getDoc(doc(unverified,'badges/'+UID)));
    await assertFails(setDoc(doc(owner,'badges/'+UID),{clergy:'padre'}));
    await assertFails(setDoc(doc(owner,'profile_photos/'+UID),{url:'https://example.test/photo'}));
  });
  await verify('rotas fora de Perfil, consentimento e dados sensíveis permanecem fechados',async()=>{
    await assertFails(getDoc(doc(owner,'admins/'+UID)));
    await assertFails(setDoc(doc(owner,'admins/'+UID),{enabled:true}));
    await assertFails(setDoc(doc(owner,'users/'+UID+'/private/preferences'),{parish:'fictícia'}));
    await assertFails(getDoc(doc(owner,'users/'+UID+'/private/preferences')));
    await assertFails(setDoc(doc(owner,'chats/demo'),{participants:[UID]}));
    await assertFails(setDoc(doc(owner,'account_deletion_requests/'+UID),{status:'pending'}));
    await assertFails(getDocs(collection(owner,'posts','dated-00','replies')));
  });
  console.log('OK QA PERFIL RULES:',checks,'contratos isolados do Emulator');
} finally {
  await env.cleanup();
}
