/**
 * Perfil 2.0 / PR #291 — authorization + pagination contracts in the local
 * Firestore Emulator only. This test never reaches real Firebase or users.
 *
 * The posts collection is public to authenticated/eligible community members;
 * UID filtering in "Minhas discussões" is a UI query, not a private-data rule.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {
  collection, doc, documentId, getDocs, limit, orderBy, query,
  setDoc, startAfter, Timestamp, where, writeBatch,
} from 'firebase/firestore';

const PROJECT='demo-atrio-v11';
const OWNER='qa-profile2-owner';
const OTHER='qa-profile2-other';
const INDEXED_PAGE=20;
const env=await initializeTestEnvironment({
  projectId:PROJECT,
  firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')},
});
let passed=0;
const ownerVerified=env.authenticatedContext(OWNER,{
  email:'profile-owner@example.test',email_verified:true,
}).firestore();
const ownerUnverified=env.authenticatedContext(OWNER,{
  email:'profile-owner@example.test',email_verified:false,
}).firestore();
const outsiderVerified=env.authenticatedContext(OTHER,{
  email:'profile-outsider@example.test',email_verified:true,
}).firestore();
const anonymous=env.unauthenticatedContext().firestore();

function dated(db,uid){
  return query(collection(db,'posts'),where('uid','==',uid),
    orderBy('createdAt','desc'),limit(INDEXED_PAGE));
}
function legacy(db,uid){
  return query(collection(db,'posts'),where('uid','==',uid),
    orderBy(documentId()),limit(INDEXED_PAGE));
}
async function verify(name,check){
  await check();
  passed++;
  console.log('PASS PROFILE AUTH QUERY',name);
}
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    const batch=writeBatch(db);
    // Intentional mismatch of document ID sort and createdAt sort; cursors
    // must follow the actual ordered fields, not a synthetic local timestamp.
    for(let i=1;i<=25;i++){
      batch.set(doc(db,'posts','a-'+String(i).padStart(3,'0')),{
        uid:OWNER,authorName:'Pessoa de QA',title:'Discussão '+i,
        body:'Conteúdo exclusivamente sintético',category:'Vida espiritual',
        createdAt:Timestamp.fromMillis(1750000000000 + (26-i)*1000),
      });
      batch.set(doc(db,'posts','b-'+String(i).padStart(3,'0')),{
        uid:OTHER,authorName:'Outra pessoa',title:'Discussão externa '+i,
        body:'Conteúdo exclusivamente sintético',category:'Vida espiritual',
        createdAt:Timestamp.fromMillis(1750000000000 + i*1000),
      });
    }
    for(const id of ['a-legacy-001','a-legacy-002']){
      batch.set(doc(db,'posts',id),{
        uid:OWNER,authorName:'Pessoa de QA',title:'Publicação anterior',
        body:'Registro sintético sem createdAt',category:'Vida espiritual',
      });
    }
    await batch.commit();
  });
  await verify('histórico datado: 20 + 5, cursor por snapshot, sem duplicações ou UID alheio',async()=>{
    const base=dated(ownerVerified,OWNER);
    const first=await assertSucceeds(getDocs(base));
    const second=await assertSucceeds(getDocs(query(base,startAfter(first.docs.at(-1)))));
    const all=[...first.docs,...second.docs];
    assert.deepEqual([first.size,second.size],[20,5]);
    assert.equal(new Set(all.map(x=>x.id)).size,25);
    assert.ok(all.every(x=>x.data().uid===OWNER));
    assert.ok(all.every(x=>Object.hasOwn(x.data(),'createdAt')));
    assert.deepEqual([all[0].id,all.at(-1).id],['a-001','a-025']);
  });
  await verify('varredura por ID recupera antigos e não duplica registros com data',async()=>{
    const base=legacy(ownerVerified,OWNER);
    const seen=new Set();
    let cursor=null;
    let legacyCount=0;
    let fetched=0;
    for(let n=0;n<4;n++){
      const snapshot=await assertSucceeds(getDocs(cursor?
        query(base,startAfter(cursor)):base));
      for(const post of snapshot.docs){
        assert.equal(post.data().uid,OWNER);
        assert.ok(!seen.has(post.id));
        seen.add(post.id);
        if(!Object.hasOwn(post.data(),'createdAt'))legacyCount++;
      }
      fetched+=snapshot.size;
      cursor=snapshot.docs.at(-1)??cursor;
      if(snapshot.size<INDEXED_PAGE)break;
    }
    assert.equal(fetched,27);
    assert.equal(legacyCount,2);
  });
  // Set the same administrative gate used by the application; no remote writes.
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'app_config/email_verification'),{
      enabled:true,version:'2026-11-v1',
    });
  });
  await verify('consulta ordenada é negada sem e-mail confirmado quando gate ativo',()=>
    assertFails(getDocs(dated(ownerUnverified,OWNER))));
  await verify('varredura legada é negada sem e-mail confirmado quando gate ativo',()=>
    assertFails(getDocs(legacy(ownerUnverified,OWNER))));
  await verify('ambas as consultas são negadas sem sessão autenticada',async()=>{
    await assertFails(getDocs(dated(anonymous,OWNER)));
    await assertFails(getDocs(legacy(anonymous,OWNER)));
  });
  await verify('conta com e-mail confirmado mantém as duas consultas pagináveis',async()=>{
    const indexed=await assertSucceeds(getDocs(dated(ownerVerified,OWNER)));
    const byId=await assertSucceeds(getDocs(legacy(ownerVerified,OWNER)));
    assert.equal(indexed.size,20);
    assert.equal(byId.size,20);
  });
  await verify('UID correto filtra outros autores sem declarar privacidade inexistente',async()=>{
    const own=await assertSucceeds(getDocs(dated(ownerVerified,OWNER)));
    const different=await assertSucceeds(getDocs(dated(outsiderVerified,OTHER)));
    assert.ok(own.docs.every(x=>x.data().uid===OWNER));
    assert.ok(different.docs.every(x=>x.data().uid===OTHER));
  });
  // Real production posts are publicly readable for signed-in and eligible
  // members. Do not invent a "no cross-account reading" guarantee.
  await verify('leitura comunitária de outro UID continua deliberadamente permitida',async()=>{
    const other=await assertSucceeds(getDocs(dated(outsiderVerified,OWNER)));
    assert.equal(other.size,20);
    assert.ok(other.docs.every(x=>x.data().uid===OWNER));
  });
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'app_config/email_verification'),{
      enabled:false,version:'2026-11-v1',
    });
  });
  await verify('com gate desativado, cliente legado mantém consultas e dados sem migração',async()=>{
    const indexed=await assertSucceeds(getDocs(dated(ownerUnverified,OWNER)));
    const byId=await assertSucceeds(getDocs(legacy(ownerUnverified,OWNER)));
    assert.equal(indexed.size,20);
    assert.equal(byId.size,20);
  });
  console.log('OK PROFILE AUTH QUERY:',passed,'contratos isolados de QA');
} finally {
  await env.cleanup();
}
