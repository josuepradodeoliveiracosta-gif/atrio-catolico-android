// Entirely in Firestore Emulator; no external Firebase tokens or paid services.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,Timestamp} from 'firebase/firestore';
import {Firestore} from '../../cloudflare/guardian-worker/src/firestore.js';
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
 await check('aplicativo não consegue ler nem alterar checkpoint do servidor',async()=>{
  const client=env.authenticatedContext('qa-user').firestore();
  await assertFails(getDoc(doc(client,'guardian_runtime/scan_posts')));
  assert.equal((await server.get('guardian_runtime/scan_posts')).fields.mode.stringValue,'complete');
 });
 console.log('GUARDIAN PAGED FIRESTORE EMULATOR:',passed,'PASS');
}finally{await env.cleanup();}
