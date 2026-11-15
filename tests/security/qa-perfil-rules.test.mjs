/**
 * Contrato MINIMO do piloto Perfil QA — somente Firebase Emulator.
 * Nenhum acesso a Firebase remoto, credencial, conta ou dado real.
 * Piloto da PR #298: login pré-existente, perfil próprio e posts próprios.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {
  collection,deleteDoc,doc,documentId,getDoc,getDocs,limit,orderBy,query,
  serverTimestamp,setDoc,startAfter,Timestamp,updateDoc,where,writeBatch,
} from 'firebase/firestore';

const PROJECT='demo-atrio-v11';
const UID='qa-perfil-owner';
const OTHER='qa-perfil-other';
const NEW='qa-perfil-new';
const CREATED_AT=Timestamp.fromMillis(1750000000000);
const rules=readFileSync('../../firebase/qa-perfil/firestore.rules','utf8');
const env=await initializeTestEnvironment({
  projectId:PROJECT,
  firestore:{host:'127.0.0.1',port:8089,rules},
});
const owner=env.authenticatedContext(UID,{email:'owner@example.test',email_verified:true}).firestore();
const unverified=env.authenticatedContext(UID,{email:'owner@example.test',email_verified:false}).firestore();
const other=env.authenticatedContext(OTHER,{email:'other@example.test',email_verified:true}).firestore();
const newOwner=env.authenticatedContext(NEW,{email:'new@example.test',email_verified:true}).firestore();
const guest=env.unauthenticatedContext().firestore();
const ownerPath='profiles/'+UID;
const publicPath='public_profiles/'+UID;
let checks=0;

async function verify(name,fn){
  await fn();
  checks++;
  console.log('PASS QA PERFIL OWNER RULES',name);
}
function ordered(db,uid,n=20){
  return query(collection(db,'posts'),where('uid','==',uid),
    orderBy('createdAt','desc'),limit(n));
}
function legacy(db,uid){
  return query(collection(db,'posts'),where('uid','==',uid),
    orderBy(documentId()),limit(20));
}
async function privilegedSeed(fn){
  return env.withSecurityRulesDisabled(async context=>fn(context.firestore()));
}

try {
  await env.clearFirestore();
  // Só o operador do EMULADOR povoa fixtures. Nenhum cliente QA pode criar
  // perfil/publicação no Firestore remoto ou pelo Android.
  await privilegedSeed(async db=>{
    const batch=writeBatch(db);
    batch.set(doc(db,ownerPath),{displayName:'Pessoa QA',createdAt:CREATED_AT});
    batch.set(doc(db,'profiles/'+OTHER),{displayName:'Outra Pessoa',createdAt:CREATED_AT});
    for(let i=0;i<25;i++)batch.set(doc(db,'posts','dated-'+String(i).padStart(2,'0')),{
      uid:UID,title:'Discussão sintética '+i,
      createdAt:Timestamp.fromMillis(1750000000000+i*1000),
    });
    for(let i=0;i<2;i++)batch.set(doc(db,'posts','legacy-'+i),{
      uid:UID,title:'Legado sintético '+i,
    });
    batch.set(doc(db,'posts','other-post'),{
      uid:OTHER,title:'Outra conta QA',createdAt:CREATED_AT,
    });
    batch.set(doc(db,'badges',UID),{type:'synthetic-badge'});
    await batch.commit();
  });

  await verify('titular verificado le somente o proprio perfil',async()=>{
    assert.equal((await assertSucceeds(getDoc(doc(owner,ownerPath)))).data().displayName,'Pessoa QA');
    assert.equal((await assertSucceeds(getDoc(doc(other,'profiles/'+OTHER)))).data().displayName,'Outra Pessoa');
    await assertFails(getDoc(doc(other,ownerPath)));
    await assertFails(getDoc(doc(unverified,ownerPath)));
    await assertFails(getDoc(doc(guest,ownerPath)));
    await assertFails(getDocs(collection(owner,'profiles')));
  });

  await verify('nenhuma conta QA pode criar perfil pelo cliente',async()=>{
    await assertFails(setDoc(doc(newOwner,'profiles/'+NEW),{
      displayName:'Novo QA',createdAt:serverTimestamp(),
    }));
    await assertFails(setDoc(doc(other,'profiles/'+NEW),{
      displayName:'Outro QA',createdAt:serverTimestamp(),
    }));
  });

  await verify('sem opt-in publico, editar apenas nome/bio do proprio perfil',async()=>{
    await assertSucceeds(updateDoc(doc(owner,ownerPath),{
      displayName:'Pessoa QA Editada',bio:'Biografia QA',
    }));
    const own=await assertSucceeds(getDoc(doc(owner,ownerPath)));
    assert.equal(own.data().bio,'Biografia QA');
    assert.equal(own.data().createdAt.toMillis(),CREATED_AT.toMillis());
    await assertSucceeds(getDoc(doc(owner,publicPath))); // continua inexistente
  });

  await verify('dados alheios, nao verificado e atributos privilegiados bloqueados',async()=>{
    await assertFails(updateDoc(doc(other,ownerPath),{bio:'Intrusao'}));
    await assertFails(updateDoc(doc(unverified,ownerPath),{bio:'Nao verificado'}));
    await assertFails(updateDoc(doc(owner,ownerPath),{role:'admin'}));
    await assertFails(updateDoc(doc(owner,ownerPath),{createdAt:Timestamp.now()}));
    await assertFails(updateDoc(doc(owner,ownerPath),{displayName:'X'}));
    await assertFails(updateDoc(doc(owner,ownerPath),{bio:'a'.repeat(181)}));
    await assertFails(deleteDoc(doc(owner,ownerPath)));
  });

  await verify('cliente nao cria opt-in publico',async()=>{
    await assertFails(setDoc(doc(owner,publicPath),{
      displayName:'Pessoa QA Editada',bio:'Biografia QA',
      joinedAt:CREATED_AT,updatedAt:serverTimestamp(),
    }));
    await assertFails(setDoc(doc(other,'public_profiles/'+OTHER),{
      displayName:'Outra Pessoa',bio:'',joinedAt:CREATED_AT,
      updatedAt:serverTimestamp(),
    }));
  });

  // Simula opt-in JA EXISTENTE, permitido somente pela fixture offline.
  await privilegedSeed(async db=>{
    await setDoc(doc(db,publicPath),{
      displayName:'Pessoa QA Editada',bio:'Biografia QA',
      joinedAt:CREATED_AT,updatedAt:CREATED_AT,
    });
  });

  await verify('projecao publica so pode ser lida pelo proprio titular',async()=>{
    const current=await assertSucceeds(getDoc(doc(owner,publicPath)));
    assert.equal(current.data().displayName,'Pessoa QA Editada');
    await assertFails(getDoc(doc(other,publicPath)));
    await assertFails(getDoc(doc(unverified,publicPath)));
    await assertFails(getDoc(doc(guest,publicPath)));
    await assertFails(getDocs(collection(owner,'public_profiles')));
  });

  await verify('updatedAt isolado de public_profiles e negado mesmo consistente',async()=>{
    // Regressao P3: antes o getAfter conferia apenas igualdade dos
    // documentos, permitindo atualizar metadado publico sem private write.
    const ref=doc(owner,publicPath);
    const prior=await assertSucceeds(getDoc(ref));
    await assertFails(updateDoc(ref,{updatedAt:serverTimestamp()}));
    const after=await assertSucceeds(getDoc(ref));
    assert.equal(after.data().updatedAt.toMillis(),prior.data().updatedAt.toMillis());
  });

  await verify('batch com update privado sem mudanca efetiva nao libera updatedAt isolado',async()=>{
    const ref=doc(owner,publicPath);
    const prior=await assertSucceeds(getDoc(ref));
    const unchanged=await assertSucceeds(getDoc(doc(owner,ownerPath)));
    const batch=writeBatch(owner);
    batch.update(doc(owner,ownerPath),{
      displayName:unchanged.data().displayName,
      bio:unchanged.data().bio,
    });
    batch.update(ref,{updatedAt:serverTimestamp()});
    await assertFails(batch.commit());
    const after=await assertSucceeds(getDoc(ref));
    assert.equal(after.data().updatedAt.toMillis(),prior.data().updatedAt.toMillis());
  });

  await verify('com opt-in, update privado desacompanhado e bloqueado',async()=>{
    await assertFails(updateDoc(doc(owner,ownerPath),{
      displayName:'Sem Sincronizacao',bio:'Inconsistente',
    }));
  });

  await verify('transacao valida sincroniza private e public sem recriar opt-in',async()=>{
    const batch=writeBatch(owner);
    batch.update(doc(owner,ownerPath),{displayName:'Nome Atual',bio:'Bio Atual'});
    batch.update(doc(owner,publicPath),{
      displayName:'Nome Atual',bio:'Bio Atual',
      updatedAt:serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
    const priv=await assertSucceeds(getDoc(doc(owner,ownerPath)));
    const pub=await assertSucceeds(getDoc(doc(owner,publicPath)));
    assert.equal(priv.data().displayName,'Nome Atual');
    assert.equal(pub.data().bio,'Bio Atual');
    assert.equal(pub.data().joinedAt.toMillis(),CREATED_AT.toMillis());
  });

  await verify('projecao publica adulterada, alteracao externa e delete negados',async()=>{
    await assertFails(updateDoc(doc(other,publicPath),{bio:'Intrusao'}));
    await assertFails(updateDoc(doc(unverified,publicPath),{bio:'Nao verificado'}));
    await assertFails(updateDoc(doc(owner,publicPath),{
      displayName:'Falso',updatedAt:serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(owner,publicPath),{joinedAt:Timestamp.now()}));
    await assertFails(updateDoc(doc(owner,publicPath),{role:'moderator'}));
    await assertFails(deleteDoc(doc(owner,publicPath)));
  });

  await verify('historico do titular 20+5 por createdAt e cursor',async()=>{
    const base=ordered(owner,UID);
    const first=await assertSucceeds(getDocs(base));
    const second=await assertSucceeds(getDocs(query(base,startAfter(first.docs.at(-1)))));
    assert.deepEqual([first.size,second.size],[20,5]);
    const ids=[...first.docs,...second.docs].map(x=>x.id);
    assert.equal(new Set(ids).size,25);
    assert.ok([...first.docs,...second.docs].every(x=>x.data().uid===UID));
  });

  await verify('legado do titular por ID com filtro UID e limite 20',async()=>{
    const page=await assertSucceeds(getDocs(legacy(owner,UID)));
    assert.equal(page.size,20);
    assert.ok(page.docs.every(x=>x.data().uid===UID));
    await assertSucceeds(getDoc(doc(owner,'posts/legacy-0')));
  });

  await verify('get de post so permite documento do proprio autor',async()=>{
    await assertSucceeds(getDoc(doc(owner,'posts/dated-00')));
    await assertSucceeds(getDoc(doc(other,'posts/other-post')));
    await assertFails(getDoc(doc(other,'posts/dated-00')));
    await assertFails(getDoc(doc(owner,'posts/other-post')));
    await assertFails(getDoc(doc(unverified,'posts/dated-00')));
    await assertFails(getDoc(doc(guest,'posts/dated-00')));
  });

  await verify('consulta de posts de terceiros e negada mesmo limitada',async()=>{
    await assertFails(getDocs(ordered(other,UID)));
    await assertFails(getDocs(legacy(other,UID)));
    await assertFails(getDocs(ordered(owner,OTHER)));
    await assertSucceeds(getDocs(ordered(other,OTHER)));
  });

  await verify('consulta sem filtro ou com autores mistos e negada',async()=>{
    await assertFails(getDocs(query(collection(owner,'posts'),limit(20))));
    await assertFails(getDocs(query(collection(owner,'posts'),
      where('uid','in',[UID,OTHER]),limit(20))));
    await assertFails(getDocs(query(collection(owner,'posts'),
      where('uid','==',UID)))); // sem limit
    await assertFails(getDocs(ordered(owner,UID,21)));
    await assertFails(getDocs(ordered(owner,UID,100)));
  });

  await verify('anonimo e email nao verificado nao consultam historico',async()=>{
    await assertFails(getDocs(ordered(guest,UID)));
    await assertFails(getDocs(ordered(unverified,UID)));
    await assertFails(getDocs(legacy(unverified,UID)));
  });

  await verify('cliente nunca publica, edita ou apaga posts',async()=>{
    await assertFails(setDoc(doc(owner,'posts/new'),{
      uid:UID,title:'Novo post',createdAt:serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(owner,'posts/dated-00'),{title:'Alteracao'}));
    await assertFails(deleteDoc(doc(owner,'posts/dated-00')));
    await assertFails(setDoc(doc(other,'posts/dated-00'),{uid:OTHER,title:'Tomada'}));
  });

  await verify('selos, fotos, app_config, replies e outras rotas continuam fechados',async()=>{
    await assertFails(getDoc(doc(owner,'badges/'+UID)));
    await assertFails(getDoc(doc(owner,'profile_photos/'+UID)));
    await assertFails(getDoc(doc(owner,'app_config/email_verification')));
    await assertFails(getDoc(doc(owner,'admins/'+UID)));
    await assertFails(getDoc(doc(owner,'users/'+UID+'/private/account')));
    await assertFails(getDocs(collection(owner,'posts/dated-00/replies')));
    await assertFails(setDoc(doc(owner,'community_consents/'+UID),{accepted:true}));
    await assertFails(setDoc(doc(owner,'chats/demo'),{members:[UID]}));
    await assertFails(setDoc(doc(owner,'users/'+UID+'/savedPosts/demo'),{saved:true}));
    await assertFails(setDoc(doc(owner,'reports/demo'),{reason:'synthetic'}));
    await assertFails(setDoc(doc(owner,'profile_photos/'+UID),{url:'https://example.test/x'}));
  });

  console.log('OK QA PERFIL OWNER RULES:',checks,'contratos do Emulator, sem Firebase remoto');
} finally {
  await env.cleanup();
}
