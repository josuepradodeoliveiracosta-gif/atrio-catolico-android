// Only demo emulator. Exact emoji allowlist, ownership, realtime state and legacy compatibility.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, collection, setDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot, serverTimestamp, Timestamp} from 'firebase/firestore';
const rules=readFileSync('firestore.rules','utf8');
const catalog=readFileSync('../../app/src/main/assets/reaction_emojis.tsv','utf8').trim().split('\n').map(x=>x.split('\t'));
const patterns=[...rules.matchAll(/kind\.matches\('((?:\\.|[^'])*)'\)/g)].map(m=>m[1].replaceAll('\\\\','\\'));
const regex=new RegExp('^(?:'+patterns.join('|')+')$','u');
assert.equal(catalog.length,3944);
assert.ok(catalog.every(([emoji])=>regex.test(emoji)));
const invalid=['text','👍👍','❤️🙏','🏽','👨\u200d','🇧','a👍','👍\n','', '👍'.repeat(100)];
for(const kind of invalid) assert.equal(regex.exec(kind)?.[0] === kind,false,JSON.stringify(kind));
const env=await initializeTestEnvironment({projectId:'demo-atrio-v11',firestore:{host:'127.0.0.1',port:8089,rules}});
const a=env.authenticatedContext('emoji-a').firestore();
const b=env.authenticatedContext('emoji-b').firestore();
const anon=env.unauthenticatedContext().firestore();
const path='posts/emoji-post/replies/emoji-reply/reactions';
const ref=doc(a,path,'emoji-a');
let passed=0;
async function check(name, action){await action();passed++;console.log('PASS EMOJI',name);}
function expectLive(db, predicate) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error); else resolve();
    };
    // No emulador a view autenticada pode iniciar a partir do cache e jamais
    // emitir um segundo snapshot apenas para a mudança de metadados. Uma
    // mudança entregue ao observador b e que satisfaz o predicado já comprova
    // recepção da atualização; não exigir fromCache=false para terminar.
    // A suite testa separadamente permissões e leituras reais com getDocs().
    const timer = setTimeout(() => finish(new Error('realtime reaction timeout')), 30000);
    unsubscribe = onSnapshot(collection(db, path), {includeMetadataChanges: true}, snapshot => {
      if (predicate(snapshot.docs.map(d => ({uid: d.id, ...d.data()})))) finish();
    }, error => finish(error));
    if (settled) unsubscribe();
  });
}
try {
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'posts/emoji-post'),{uid:'emoji-a'});
    await setDoc(doc(ctx.firestore(),'posts/emoji-post/replies/emoji-reply'),{uid:'emoji-b'});
  });
  const examples=[...new Set(['heart','prayer','light','👍','❤️','😂','😮','😢','🙏','👨‍👩‍👧‍👦','👩🏽‍💻','🇧🇷','1️⃣','🧑🏾‍🤝‍🧑🏻','👍🏻','👍🏼','👍🏽','👍🏾','👍🏿',...Array.from({length:9},(_,i)=>catalog.find(row=>Number(row[1])===i)[0]),catalog.at(-1)[0]])];
  await check('legacy, categories, families, flags and skin tones accepted by real rules',async()=>{
    for(const kind of examples){
      await assertSucceeds(setDoc(ref,{kind,createdAt:serverTimestamp()}));
      assert.equal((await getDoc(ref)).data().kind,kind);
      await assertSucceeds(deleteDoc(ref));
    }
  });
  await check('text, multiple emojis, incomplete sequences and modifiers alone rejected',async()=>{
    for(const kind of invalid) await assertFails(setDoc(ref,{kind,createdAt:serverTimestamp()}));
  });
  await check('owner can create, replace and remove without duplicates; second account sees snapshots',async()=>{
    let seen=expectLive(b,rows=>rows.length===1 && rows[0].kind==='prayer');
    await assertSucceeds(setDoc(ref,{kind:'prayer',createdAt:serverTimestamp()})); await seen;
    const created=(await getDoc(ref)).data().createdAt;
    seen=expectLive(b,rows=>rows.length===1 && rows[0].kind==='👩🏽‍💻');
    await assertSucceeds(updateDoc(ref,{kind:'👩🏽‍💻'})); await seen;
    assert.ok((await getDoc(ref)).data().createdAt.isEqual(created));
    await assertSucceeds(setDoc(doc(b,path,'emoji-b'),{kind:'👩🏽‍💻',createdAt:serverTimestamp()}));
    assert.equal((await getDocs(collection(a,path))).docs.filter(x=>x.data().kind==='👩🏽‍💻').length,2);
    seen=expectLive(b,rows=>rows.length===1 && rows[0].uid==='emoji-b');
    await assertSucceeds(deleteDoc(ref)); await seen;
  });
  await check('no write, update or delete in another account identity',async()=>{
    await assertFails(setDoc(doc(b,path,'emoji-a'),{kind:'👍',createdAt:serverTimestamp()}));
    await assertFails(updateDoc(doc(a,path,'emoji-b'),{kind:'🙏'}));
    await assertFails(deleteDoc(doc(a,path,'emoji-b')));
  });
  await check('no anonymous access, fake counters, extra fields or forged timestamps',async()=>{
    await assertFails(getDocs(collection(anon,path)));
    await assertFails(setDoc(doc(anon,path,'emoji-a'),{kind:'👍',createdAt:serverTimestamp()}));
    await assertFails(setDoc(ref,{kind:'👍',createdAt:serverTimestamp(),count:100}));
    await assertFails(setDoc(ref,{kind:'👍',createdAt:Timestamp.fromMillis(1)}));
    await assertFails(updateDoc(doc(b,path,'emoji-b'),{kind:'😢',createdAt:serverTimestamp()}));
    await assertFails(setDoc(doc(a,'posts/emoji-post/replies/missing/reactions/emoji-a'),{kind:'👍',createdAt:serverTimestamp()}));
  });
  await check('deleted reply cannot receive updates; owner can still clean up own reaction',async()=>{
    await env.withSecurityRulesDisabled(ctx=>deleteDoc(doc(ctx.firestore(),'posts/emoji-post/replies/emoji-reply')));
    await assertFails(updateDoc(doc(b,path,'emoji-b'),{kind:'🙏'}));
    await assertSucceeds(deleteDoc(doc(b,path,'emoji-b')));
  });
  console.log(`EMOJI SECURITY: ${passed} scenarios passed; ${catalog.length} catalog entries checked`);
} finally {await env.cleanup();}
