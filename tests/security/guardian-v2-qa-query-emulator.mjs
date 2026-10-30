// Verifies real Firestore Emulator queries used by the future read-only QA workflow.
// All records below are synthetic and stored in a demo emulator project.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,Timestamp,getDoc} from 'firebase/firestore';
import {Firestore} from '../../cloudflare/guardian-worker/src/firestore.js';
import {scanQaShadow} from '../../cloudflare/guardian-worker/src/shadow-qa.js';
import {validateShadowOutcome} from '../../cloudflare/guardian-worker/src/remote-gate.js';

const project='atrio-catolico-qa-v2';
const env=await initializeTestEnvironment({
  projectId:project,
  firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}
});
const store=new Firestore('owner',project,'http://127.0.0.1:8089/v1');
const flags={
  GUARDIAN_V2_TEST_MODE:'true',GUARDIAN_V2_ENABLED:'false',
  GUARDIAN_V2_HOLD_ENABLED:'false',GUARDIAN_V2_QA_SHADOW_READS:'true',
  GUARDIAN_FIREBASE_PROJECT_ID:project,GUARDIAN_V2_QA_PROJECT_ID:project
};
const past=Timestamp.fromMillis(Date.now()-45*60_000);
const now=Timestamp.now();
let checks=0;
async function verify(name,fn){await fn();checks++;console.log('SHADOW QA EMULATOR PASS:',checks,name);}
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await setDoc(doc(db,'posts/qa-liturgia'),{
      qaFixture:true,createdAt:now,uid:'synthetic-qa',title:'Dúvida litúrgica',
      body:'Como funciona o calendário litúrgico?'
    });
    await setDoc(doc(db,'posts/qa-retained-parent'),{
      qaFixture:true,createdAt:now,uid:'synthetic-qa',title:'Tema aberto',
      body:'Discussão da comunidade fictícia'
    });
    await setDoc(doc(db,'posts/qa-retained-parent/replies/qa-phish'),{
      qaFixture:true,createdAt:now,uid:'synthetic-qa',
      body:'Clique https://exemplo.invalid e informe sua senha'
    });
    await setDoc(doc(db,'reports/qa-report'),{
      qaFixture:true,createdAt:now,reporterUid:'qa-reviewer',
      postId:'qa-liturgia',reason:'denúncia fictícia'
    });
    await setDoc(doc(db,'posts/unmarked-real-like'),{
      qaFixture:false,createdAt:now,uid:'no-user',title:'Texto não marcado',
      body:'Vou te matar amanhã'
    });
    await setDoc(doc(db,'posts/old-fixture'),{
      qaFixture:true,createdAt:past,uid:'qa-old',title:'Teste expirado',
      body:'Vou te matar amanhã'
    });
  });
  await verify('consulta real com filtro servidor e projeção de campos',async()=>{
    const posts=await store.scanQa('posts',20,15);
    assert.equal(posts.length,2);
    assert.equal(posts.every(x=>x.fields?.qaFixture?.booleanValue===true),true);
    assert.equal(posts.every(x=>!x.fields?.uid),true);
    assert.equal(posts.some(x=>x.name.endsWith('/unmarked-real-like')),false);
    assert.equal(posts.some(x=>x.name.endsWith('/old-fixture')),false);
  });
  await verify('consulta collectionGroup de respostas sintéticas',async()=>{
    const replies=await store.scanQa('replies',20,15);
    assert.equal(replies.length,1);
    assert.ok(replies[0].name.endsWith('/replies/qa-phish'));
  });
  await verify('denúncia projetada não vaza IDs nem justificativas',async()=>{
    const reports=await store.scanQa('reports',20,15);
    assert.equal(reports.length,1);
    assert.deepEqual(Object.keys(reports[0].fields),['qaFixture']);
  });
  await verify('classificador real executa sem gravar ou retirar conteúdo',async()=>{
    const before=await store.get('posts/qa-retained-parent/replies/qa-phish');
    const totals=validateShadowOutcome(await scanQaShadow({
      scan:(...args)=>store.scanQa(...args)
    },flags));
    assert.equal(totals.hold_candidate,1);
    assert.equal(totals.review,0);
    assert.equal(totals.reports,1);
    assert.equal(totals.clear,2);
    const after=await store.get('posts/qa-retained-parent/replies/qa-phish');
    assert.deepEqual(after.fields,before.fields);
    assert.equal(await store.get('guardian_cases/qa-phish'),null);
  });
  console.log('GUARDIAN SHADOW REAL EMULATOR:',checks,'PASS');
} finally {await env.cleanup();}
