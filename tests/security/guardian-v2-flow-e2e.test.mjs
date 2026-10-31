// ONLY local Firebase Emulator. Never execute against a real Firebase project.
// New coverage: real Firestore REST atomic commits + V2 classification +
// client Security Rules + human restoration, beyond existing unit/mocked tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,collection,getDocs} from 'firebase/firestore';
import {Firestore,caseId} from '../../cloudflare/guardian-worker/src/firestore.js';
import {scanOnce,processDocument,reviewCase,resolveReviewCase} from '../../cloudflare/guardian-worker/src/index.js';

const PROJECT='demo-atrio-v11';
const HOST='127.0.0.1:8089';
const API='http://'+HOST+'/v1';

// Block all unintended environments BEFORE connecting, including genuine QA.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST,'Only the local emulator may be used');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS,'No service credentials in emulator QA');
assert.ok(!process.env.GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON,'No service-account keys');
assert.ok(!process.env.GUARDIAN_V2_ENABLED,'Never enable production V2 during QA');

const env=await initializeTestEnvironment({
  projectId:PROJECT,firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}
});
const server=new Firestore('owner',PROJECT,API); // Firebase Emulator's local-only owner fixture.
const alice=env.authenticatedContext('alice').firestore();
const bob=env.authenticatedContext('bob').firestore();
const admin=env.authenticatedContext('admin').firestore();
let passed=0;
const check=async(name,run)=>{await run();passed++;console.log('GUARDIAN V2 E2E PASS',name);};
const seed=async(entries)=>{
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    for(const [path,data] of entries)await setDoc(doc(db,path),data);
  });
};
const today=()=>new Date();
try{
  await env.clearFirestore();
  const created=today();
  await seed([
    ['admins/admin',{enabled:true}],
    ['posts/faith',{uid:'alice',title:'A Eucaristia',body:'Vamos conversar sobre o Catecismo.',
      createdAt:created,updatedAt:created}],
    ['posts/faith/replies/suspicious',{uid:'alice',
      body:'Clique https://exemplo.invalid e informe sua senha',
      createdAt:created}]
  ]);

  await check('varredura V2 persistiu caso, auditoria e aviso no Firestore Emulator',async()=>{
    const result=await scanOnce(server,{enabled:true,allowHold:false});
    assert.equal(result.error,0,'Nenhum grupo pode falhar silenciosamente');
    assert.equal(result.pausedGroups,0,'Checkpoint não deve ficar suspenso');
    assert.equal(result.review,1,'Apenas a resposta suspeita requer revisão');
    const id=await caseId('posts/faith/replies/suspicious');
    const c=await assertSucceeds(getDoc(doc(alice,'guardian_cases',id)));
    assert.equal(c.data().status,'review');
    assert.equal(c.data().engine,'v2');
    assert.equal(c.data().targetPath,'posts/faith/replies/suspicious');
    await assertFails(getDoc(doc(bob,'guardian_cases',id)));
    const notice=await assertSucceeds(getDoc(doc(alice,'guardian_notices/alice/items',id)));
    assert.equal(notice.data().caseId,id);
    await assertFails(getDoc(doc(bob,'guardian_notices/alice/items',id)));
    const audit=await assertSucceeds(getDoc(doc(admin,'guardian_audit',id)));
    assert.equal(audit.data().actor,'guardian_v2');
    assert.equal((await getDoc(doc(alice,'posts/faith/replies/suspicious'))).exists(),true,
      'Triagem não apaga conteúdo');
  });

  await check('segunda varredura não duplica casos, avisos nem auditoria',async()=>{
    const again=await scanOnce(server,{enabled:true,allowHold:false});
    assert.equal(again.error,0);
    assert.equal(again.review,0);
    const cases=await assertSucceeds(getDocs(collection(admin,'guardian_cases')));
    assert.equal(cases.size,1);
    const notices=await assertSucceeds(getDocs(collection(alice,'guardian_notices/alice/items')));
    assert.equal(notices.size,1);
    const audit=await assertSucceeds(getDocs(collection(admin,'guardian_audit')));
    assert.equal(audit.size,1);
  });

  await check('admin encerra triagem V2 no Firestore real emulado, preservando texto',async()=>{
    const path='posts/faith/replies/suspicious',id=await caseId(path);
    assert.equal(await resolveReviewCase(server,'admin',{caseId:id,action:'dismiss',
      note:'Revisão humana: contexto interpretado sem infração.'}),'dismissed');
    assert.equal((await server.get('guardian_cases/'+id)).fields.status.stringValue,'dismissed');
    assert.ok(await server.get('guardian_audit/'+id+'_dismissed'));
    assert.ok(await server.get('guardian_notices/alice/items/'+id+'_resolved'));
    assert.ok(await server.get(path),'A resolução não pode apagar conteúdo');
    await assert.rejects(resolveReviewCase(server,'admin',{caseId:id,action:'dismiss',
      note:'Decisão já concluída anteriormente.'}),err=>err?.status===409);
  });

  await env.clearFirestore();
  const createdHold=today();
  await seed([
    ['admins/admin',{enabled:true}],
    ['posts/context',{uid:'alice',title:'Discussão legítima',body:'A caridade sempre deve prevalecer.',
      createdAt:createdHold,updatedAt:createdHold}],
    ['posts/context/replies/quarantine_fixture',{uid:'alice',
      body:'Clique https://exemplo.invalid e informe sua senha',
      createdAt:createdHold}]
  ]);
  await check('retenção sintética atômica e restauração humana preservam conteúdo e histórico',async()=>{
    const path='posts/context/replies/quarantine_fixture';
    const original=await server.get(path);
    assert.ok(original?.updateTime);
    const id=await caseId(path);
    assert.equal(await processDocument(server,original,{enabled:true,allowHold:true}),'hold');
    assert.equal(await server.get(path),null,'Somente resposta sob retenção');
    assert.ok(await server.get('posts/context'),'Discussão pai permanece');
    assert.equal((await server.get('guardian_cases/'+id)).fields.status.stringValue,'held');
    assert.equal((await server.get('guardiao_quarantine/'+id)).fields.status.stringValue,'held');
    assert.ok(await server.get('guardian_audit/'+id));
    assert.ok(await server.get('guardian_notices/alice/items/'+id));

    // ReviewCase assumes an authorized moderator. Authorization itself is
    // already covered by Rules/admin tests; this fixture tests persistence.
    assert.equal(await reviewCase(server,'admin',{caseId:id,action:'restore',
      note:'Conteúdo sintético restaurado após revisão humana.'}),'restored');
    const restored=await server.get(path);
    assert.equal(restored.fields.uid.stringValue,'alice');
    assert.equal(restored.fields.body.stringValue,original.fields.body.stringValue);
    assert.equal((await server.get('guardian_cases/'+id)).fields.status.stringValue,'restored');
    assert.equal((await server.get('guardiao_quarantine/'+id)).fields.status.stringValue,'restored');
    assert.ok(await server.get('guardian_audit/'+id+'_restored'));
    assert.ok(await server.get('guardian_notices/alice/items/'+id+'_review'));
    await assert.rejects(reviewCase(server,'admin',{caseId:id,action:'restore',
      note:'Uma segunda revisão idêntica deve falhar.'}),err=>err?.status===409);
  });
  console.log('GUARDIAN V2 E2E:',passed,'new integration scenarios');
}finally{
  await env.cleanup();
}
