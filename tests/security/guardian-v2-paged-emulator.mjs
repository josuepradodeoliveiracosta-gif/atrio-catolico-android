// Entirely in Firestore Emulator; no external Firebase tokens or paid services.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,serverTimestamp,Timestamp} from 'firebase/firestore';
import {Firestore,caseId} from '../../cloudflare/guardian-worker/src/firestore.js';
import {processDocument} from '../../cloudflare/guardian-worker/src/index.js';
import {scanPagedCycle} from '../../cloudflare/guardian-worker/src/scan-paged.js';

const project='atrio-catolico-qa-v2';
const env=await initializeTestEnvironment({projectId:project,
 firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}});
const server=new Firestore('owner',project,'http://127.0.0.1:8089/v1');
const now=new Date().toISOString();
const creation=Timestamp.fromMillis(Date.now()-60000);
const seen=new Set();
const callbacks={
  onDocument:async(db,item)=>{
    const path=item.name.split('/documents/')[1];
    if(seen.has(path))throw Error('duplicate document in resumed scan');
    seen.add(path);return 'clear';
  },
  onReport:async()=> 'ignored'
};
let passed=0;
async function check(name,fn){await fn();console.log('QA PAGED EMULATOR PASS',++passed,name);}
try{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(let n=0;n<65;n+=10){
   const batch=[];
   for(let i=n;i<Math.min(n+10,65);i++)
     batch.push(setDoc(doc(db,'posts/qa_scan_'+String(i).padStart(3,'0')),{
       uid:'synthetic-qa',title:'QA',body:'Texto fictício',
       createdAt:creation,qaFixture:true
     }));
   await Promise.all(batch);
  }
 });
 await check('primeira varredura preserva checkpoint após 60 documentos',async()=>{
  const result=await scanPagedCycle(server,{enabled:true},callbacks,now);
  assert.equal(result.clear,60);
  assert.equal(result.backlogGroups,1);
  assert.equal(result.error,0);
  const state=await server.get('guardian_runtime/scan_posts');
  assert.equal(state.fields.mode.stringValue,'running');
  assert.ok(state.fields.cursorName.stringValue.endsWith('/posts/qa_scan_005'));
 });
 await check('segunda varredura retoma exatamente os cinco restantes',async()=>{
  const result=await scanPagedCycle(server,{enabled:true},callbacks,now);
  assert.equal(result.clear,5);
  assert.equal(result.error,0);
  assert.equal(result.backlogGroups,0);
  assert.equal(seen.size,65);
  assert.equal((await server.get('guardian_runtime/scan_posts')).fields.mode.stringValue,'complete');
 });
 await check('edição de publicação antiga reaparece em fila updatedAt',async()=>{
   const path='posts/older_than_window';
   await env.withSecurityRulesDisabled(async ctx=>
     setDoc(doc(ctx.firestore(),path),{
       uid:'qa-editor',authorName:'Perfil QA',title:'Discussão antiga',
       body:'Conteúdo legítimo anteriormente publicado',category:'Liturgia',
       createdAt:Timestamp.fromMillis(Date.now()-86400000)
     })
   );
   const editor=env.authenticatedContext('qa-editor').firestore();
   await updateDoc(doc(editor,path),{
     body:'Clique https://exemplo.invalid e informe sua senha',
     updatedAt:serverTimestamp()
   });
   const timeAfter=new Date(Date.now()+5000).toISOString();
   const realCallback={
     ...callbacks,
     onDocument:async(db,document,settings)=>{
       const target=document.name.split('/documents/')[1];
       if(target!==path)throw Error('unexpected target');
       seen.add(target);
       return processDocument(db,document,settings);
     }
   };
   const result=await scanPagedCycle(server,{enabled:true,allowHold:false},realCallback,timeAfter);
   assert.equal(result.review,1);
   assert.equal(result.error,0);
   assert.ok(seen.has(path));
   assert.equal((await server.get('guardian_cases/'+await caseId(path))).fields.status.stringValue,'review');
   assert.ok(await server.get(path));
   assert.equal((await server.get('guardian_runtime/scan_post_edits')).fields.mode.stringValue,'complete');
   const oldPost=await server.get(path);
   assert.ok(Date.parse(oldPost.fields.updatedAt.timestampValue) >
     Date.parse(oldPost.fields.createdAt.timestampValue));
 });
 await check('edição legítima do APK antigo funciona, mas não habilita varredura autônoma',async()=>{
   const path='posts/legacy_old_client';
   await env.withSecurityRulesDisabled(async ctx=>
     setDoc(doc(ctx.firestore(),path),{
       uid:'qa-editor',authorName:'Perfil QA',title:'Discussão antiga',
       body:'Conteúdo legítimo',category:'Liturgia',
       createdAt:Timestamp.fromMillis(Date.now()-86400000)
     })
   );
   const editor=env.authenticatedContext('qa-editor').firestore();
   await assertSucceeds(updateDoc(doc(editor,path),{body:'Edição legada permitida'}));
   const current=await server.get(path);
   assert.equal(current.fields.body.stringValue,'Edição legada permitida');
   assert.equal(current.fields.updatedAt,undefined,
     'Sem updatedAt, scan_post_edits NÃO é cobertura completa; autonomia NO-GO');
 });
 await check('aplicativo não consegue ler nem alterar checkpoint do servidor',async()=>{
  const client=env.authenticatedContext('qa-user').firestore();
  await assertFails(getDoc(doc(client,'guardian_runtime/scan_posts')));
  assert.equal((await server.get('guardian_runtime/scan_posts')).fields.mode.stringValue,'complete');
 });
 console.log('GUARDIAN PAGED FIRESTORE EMULATOR:',passed,'PASS');
}finally{await env.cleanup();}
