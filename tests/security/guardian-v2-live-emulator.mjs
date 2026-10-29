// Uses the real Firestore Emulator REST :commit/:runQuery plus real Firestore SDK Rules.
// No Firebase credentials, networks or real users; 'owner' is emulator-only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,deleteDoc,collection,getDocs,Timestamp} from 'firebase/firestore';
import {Firestore,caseId,ROOT} from '../../cloudflare/guardian-worker/src/firestore.js';
import {processDocument,processReport,reviewCase,scanOnce} from '../../cloudflare/guardian-worker/src/index.js';
const project='demo-atrio-v11';
const api='http://127.0.0.1:8089/v1';
const server=new Firestore('owner',project,api);
const rawFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  const response=await rawFetch(input,options);
  if(!response.ok && String(input).endsWith(':commit')){
    // QA only. Error category, not document body or evidence, may be logged.
    const code=(await response.clone().json().catch(()=>({}))).error?.status||'unknown';
    console.error('Firestore Emulator REST commit:',response.status,code);
  }
  return response;
};

const env=await initializeTestEnvironment({
  projectId:project,
  firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}
});
const alice=env.authenticatedContext('alice').firestore();
const bob=env.authenticatedContext('bob').firestore();
const admin=env.authenticatedContext('admin').firestore();
const base=(body,title='Tema da comunidade')=>({
  uid:'alice',authorName:'Alice',title,body,category:'Liturgia',createdAt:Timestamp.now()
});
const reply=body=>({uid:'alice',authorName:'Alice',body,createdAt:Timestamp.now()});
const id=path=>caseId(path);
const read=path=>server.get(path);
let n=0;
async function check(label,callback){await callback();console.log('QA FIRESTORE REST:',++n,label);}
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'admins/admin'),{enabled:true});
    await setDoc(doc(db,'profiles/alice'),{displayName:'Alice',createdAt:Timestamp.now()});
    await setDoc(doc(db,'profiles/bob'),{displayName:'Bob',createdAt:Timestamp.now()});
    await setDoc(doc(db,'posts/cat1'),base('O Catecismo explica os sacramentos. Como interpretar?'));
    await setDoc(doc(db,'posts/cat2'),base('Avisos da nossa comunidade'));
    await setDoc(doc(db,'posts/cat3'),base('A paz esteja convosco'));
    await setDoc(doc(db,'posts/cat1/replies/peace'),reply('Qual é o significado da Eucaristia?'));
    await setDoc(doc(db,'posts/cat2/replies/phish'),reply('Clique https://exemplo.invalid para informar sua senha'));
    await setDoc(doc(db,'posts/cat3/replies/threat'),reply('Vou te matar amanhã'));
    await setDoc(doc(db,'posts/cat3/replies/overlap'),reply('Clique https://exemplo.invalid e informe sua senha'));
  });
  const act={enabled:true,allowHold:true};
  await check('consulta real de posts via Firestore REST',async()=>{
    assert.equal((await read('posts/cat1')).fields.uid.stringValue,'alice');
  });
  await check('discussão religiosa legítima permanece visível',async()=>{
    const original=await read('posts/cat1');
    assert.equal(await processDocument(server,original,act),'clear');
    assert.equal((await getDoc(doc(bob,'posts/cat1'))).exists(),true);
  });
  await check('varredura REST real acessa collection group respostas',async()=>{
    const docs=await server.scan('replies',20,30);
    assert.ok(docs.some(x=>x.name.endsWith('/replies/phish')));
  });
  await check('ameaça recebe caso de revisão sem remoção',async()=>{
    const p='posts/cat3/replies/threat';
    assert.equal(await processDocument(server,await read(p),{enabled:true,allowHold:false}),'review');
    assert.equal((await getDoc(doc(bob,p))).exists(),true);
    const caseDoc=await read('guardian_cases/'+await id(p));
    assert.equal(caseDoc.fields.status.stringValue,'review');
  });
  await check('retenção real de resposta conserva cópia antes de ocultar',async()=>{
    const p='posts/cat2/replies/phish';
    assert.equal(await processDocument(server,await read(p),act),'hold');
    assert.equal((await getDoc(doc(bob,p))).exists(),false);
    const saved=await read('guardiao_quarantine/'+await id(p));
    assert.equal(saved.fields.originalFields.mapValue.fields.uid.stringValue,'alice');
    assert.equal(saved.fields.status.stringValue,'held');
    assert.equal((await read('guardian_cases/'+await id(p))).fields.status.stringValue,'held');
  });
  await check('cliente não forja nem exclui decisão na base real do emulador',async()=>{
    const p='guardian_cases/'+await id('posts/cat2/replies/phish');
    await assertFails(updateDoc(doc(alice,p),{status:'restored'}));
    await assertFails(deleteDoc(doc(admin,p)));
    await assertFails(setDoc(doc(bob,'guardian_audit/fake'),{event:'purged'}));
  });
  await check('escritas administrativas reais não permitem autorrevisão',async()=>{
    const target=await id('posts/cat2/replies/phish');
    await assert.rejects(reviewCase(server,'alice',{caseId:target,action:'restore',note:'Eu quero restaurar'}),e=>e.status===403);
  });
  await check('reversão REST real restaura exatamente a resposta retida',async()=>{
    const path='posts/cat2/replies/phish',target=await id(path);
    assert.equal(await reviewCase(server,'admin',{caseId:target,action:'restore',note:'Falso positivo identificado'}),'restored');
    const after=await getDoc(doc(bob,path));
    assert.equal(after.exists(),true);
    assert.equal(after.data().body,'Clique https://exemplo.invalid para informar sua senha');
    const history=await read('guardian_cases/'+target);
    assert.equal(history.fields.status.stringValue,'restored');
    assert.ok(await read('guardian_notices/alice/items/'+target+'_review'));
  });
  await check('conteúdo já revisado não pode receber segunda decisão',async()=>{
    await assert.rejects(reviewCase(server,'admin',{caseId:await id('posts/cat2/replies/phish'),action:'confirm',note:'Tentativa de alteração'}),e=>e.status===409);
  });
  await check('dois moderadores concorrentes: no máximo um commit',async()=>{
    const path='posts/cat3/replies/overlap';
    assert.equal(await processDocument(server,await read(path),act),'hold');
    const target=await id(path);
    const results=await Promise.allSettled([
      reviewCase(server,'admin',{caseId:target,action:'restore',note:'Revisão pela administração'}),
      reviewCase(server,'otheradmin',{caseId:target,action:'confirm',note:'Revisão de outra conta'})
    ]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(results.filter(x=>x.status==='rejected').length,1);
  });
  await check('denúncia falsa de discussão religiosa não altera conteúdo',async()=>{
    const report={
      name:server.root+'/reports/bob_post_cat1',
      fields:{postId:{stringValue:'cat1'},reporterUid:{stringValue:'bob'}}
    };
    assert.equal(await processReport(server,report,act),'clear');
    assert.equal((await getDoc(doc(bob,'posts/cat1'))).exists(),true);
  });
  await check('falha de rede não altera registros nem conteúdo',async()=>{
    const path='posts/cat3/replies/failure';
    await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),path),reply('Clique https://exemplo.invalid para informar sua senha')));
    const failing=Object.create(server);
    failing.commit=async()=>{throw new Error('network disconnected');};
    await assert.rejects(processDocument(failing,await read(path),act),/network disconnected/);
    assert.equal((await getDoc(doc(bob,path))).exists(),true);
    assert.equal(await read('guardian_cases/'+await id(path)),null);
  });
  await check('parada de emergência não varre nenhuma coleção',async()=>{
    assert.deepEqual(await scanOnce(server,{enabled:false}),{status:'disabled'});
  });
  console.log('GUARDIAN V2 REAL EMULATOR CHECKS:',n,'PASS');
}finally{await env.cleanup();}
