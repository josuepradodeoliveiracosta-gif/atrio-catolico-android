/* Perfil 2.0: fixtures somente do Firebase Emulator demo-atrio-v11.
 * Não consulta nem altera Firebase real. O emulador NÃO confirma índices implantados.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {
  collection, doc, documentId, getDocs, limit, orderBy, query,
  setDoc, startAfter, Timestamp, where, writeBatch
} from 'firebase/firestore';

const indexes = JSON.parse(readFileSync('../../firestore.indexes.json','utf8'));
assert.ok(indexes.indexes.some(x =>
  x.collectionGroup === 'posts' && x.queryScope === 'COLLECTION' &&
  JSON.stringify(x.fields) === JSON.stringify([
    {fieldPath:'uid',order:'ASCENDING'},
    {fieldPath:'createdAt',order:'DESCENDING'}
  ])
), 'Indice composto do Perfil ausente na configuracao versionada');

const env = await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}
});
const uid='qa-profile-history-owner';
const owner=env.authenticatedContext(uid).firestore();
const visitor=env.authenticatedContext('qa-profile-history-visitor').firestore();
const guest=env.unauthenticatedContext().firestore();
const ownPosts=collection(owner,'posts');
const pageSize=20;
let checks=0;
async function verify(label,fn){await fn();checks++;console.log('PASS PROFILE HISTORY',label);}
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const firestore=context.firestore();
    const batch=writeBatch(firestore);
    for(let i=1;i<=41;i++){
      batch.set(doc(firestore,'posts','dated-'+String(i).padStart(3,'0')),{
        uid,authorName:'Pessoa de QA',title:'Discussao datada '+i,
        body:'Registro sintetico de QA.',category:'Vida espiritual',
        createdAt:Timestamp.fromMillis(1750000000000+i*1000)
      });
    }
    for(const id of ['legacy-001','legacy-002']){
      batch.set(doc(firestore,'posts',id),{
        uid,authorName:'Pessoa de QA',title:'Discussao antiga '+id,
        body:'Registro sintetico sem data.',category:'Vida espiritual'
      });
    }
    batch.set(doc(firestore,'posts','other-001'),{
      uid:'qa-profile-history-visitor',title:'Registro de outra conta',
      createdAt:Timestamp.fromMillis(1750000000000)
    });
    await batch.commit();
  });
  await verify('41 datadas ordenadas e paginadas 20 + 20 + 1',async()=>{
    const base=query(ownPosts,where('uid','==',uid),orderBy('createdAt','desc'),limit(pageSize));
    let cursor=null;const lengths=[];const ids=[];
    for(let i=0;i<4;i++){
      const snap=await assertSucceeds(getDocs(cursor?query(base,startAfter(cursor)):base));
      lengths.push(snap.size);
      ids.push(...snap.docs.map(x=>x.id));
      cursor=snap.docs.at(-1)??cursor;
    }
    assert.deepEqual(lengths,[20,20,1,0]);
    assert.equal(ids[0],'dated-041');
    assert.equal(ids.at(-1),'dated-001');
    assert.equal(new Set(ids).size,41);
  });
  await verify('varredura de legados continua apos lote sem registros antigos',async()=>{
    const base=query(ownPosts,where('uid','==',uid),orderBy(documentId()),limit(pageSize));
    let cursor=null;const sizes=[];const found=[];const matches=[];
    for(let i=0;i<10;i++){
      const snap=await assertSucceeds(getDocs(cursor?query(base,startAfter(cursor)):base));
      sizes.push(snap.size);
      const legacy=snap.docs.filter(x=>!Object.hasOwn(x.data(),'createdAt'));
      matches.push(legacy.length);
      found.push(...legacy.map(x=>x.id));
      cursor=snap.docs.at(-1)??cursor;
      if(snap.size<pageSize)break;
    }
    assert.deepEqual(sizes,[20,20,3]);
    assert.deepEqual(matches,[0,0,2]);
    assert.deepEqual(found.sort(),['legacy-001','legacy-002']);
  });
  await verify('cliente comum nao publica novo post sem data',()=>assertFails(
    setDoc(doc(owner,'posts','no-date-rejected'),{
      uid,authorName:'Pessoa de QA',title:'Titulo valido',
      body:'Corpo valido de QA.',category:'Vida espiritual'
    })
  ));
  await verify('usuario deslogado nao enumera posts',()=>assertFails(
    getDocs(query(collection(guest,'posts'),where('uid','==',uid),limit(pageSize)))
  ));
  await verify('busca por UID nao mistura usuarios',async()=>{
    const result=await assertSucceeds(getDocs(query(
      collection(visitor,'posts'),where('uid','==','qa-profile-history-visitor'),limit(pageSize)
    )));
    assert.deepEqual(result.docs.map(x=>x.id),['other-001']);
  });
  console.log('OK PROFILE HISTORY:',checks,'contratos no emulador');
} finally { await env.cleanup(); }
