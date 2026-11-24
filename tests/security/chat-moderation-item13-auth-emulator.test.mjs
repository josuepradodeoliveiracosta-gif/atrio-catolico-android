// #199 item 13: Auth Emulator REAL + Firestore Emulator, sem servidor remoto.
// Complementa o teste com verifyIdToken simulado: verifica tokens emitidos pelo
// Auth Emulator e revogação/remoção da identidade no ciclo por caso.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deleteApp,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {FieldValue,getFirestore,Timestamp} from 'firebase-admin/firestore';
import {createScopedModerationService} from '../../firebase/qa-general/chat-moderation-item13.mjs';
import {createCaseReviewWorkflow,createCaseReviewWorkflowHttpHandler}
  from '../../firebase/qa-general/chat-moderation-item13-workflow.mjs';

const projectId='demo-atrio-v11';
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
assert.equal(process.env.GCLOUD_PROJECT,projectId);
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
const authBase='http://127.0.0.1:9099';
const endpoint='https://case.qa.invalid/v1/qa/conversations/moderation/case';
const uid={
  moderator:'qa-case-auth-moderator',
  reviewer:'qa-case-auth-reviewer',
  reporter:'qa-case-auth-reporter',
  other:'qa-case-auth-other',
  unverified:'qa-case-auth-unverified'
};
const channel='direct',target='qa-auth-private-chat',messageId='msg01';
const caseId=uid.reporter+'__'+target+'__'+messageId;
const reportPath='chat_reports/'+caseId;
const grantPath='chatModerationAssignments/direct/cases/'+caseId;
const statePath='chatModerationCaseStates/direct/cases/'+caseId;
const note='Justificativa fictícia aprovada pelo revisor humano.';
const reason='Solicito uma revisão humana do caso.';
const password='somente-emulador-senha-ficticia';

test('item 13: Auth Emulator confirma papel, atribuição e revogação de sessão',async t=>{
  const app=initializeApp({projectId},'case-auth-'+Date.now());
  const auth=getAuth(app), db=getFirestore(app);
  t.after(async()=>deleteApp(app));
  let current=Date.now();
  for(const [name,id] of Object.entries(uid)){
    await auth.createUser({
      uid:id,email:name+'@case-qa.invalid',password,
      emailVerified:name!=='unverified'
    });
  }
  const tokenFor=async name=>{
    const response=await fetch(authBase+
      '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=qa-fake-key',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          email:name+'@case-qa.invalid',password,returnSecureToken:true
        })
      });
    assert.equal(response.status,200);
    const json=await response.json();
    assert.equal(typeof json.idToken,'string');
    return json.idToken;
  };
  const tokens={};
  for(const name of Object.keys(uid))tokens[name]=await tokenFor(name);
  const fixture=db.batch();
  fixture.set(db.doc('admins/'+uid.moderator),{enabled:true});
  fixture.set(db.doc('admins/'+uid.reviewer),{enabled:true});
  fixture.set(db.doc(reportPath),{
    chatId:target,messageId,reporterUid:uid.reporter,
    reason:'Relato fictício para revisão',
    reportedText:'Apenas a prova mínima autorizada em QA',
    createdAt:Timestamp.fromMillis(current)
  });
  fixture.set(db.doc(grantPath),{
    moderatorUid:uid.moderator,status:'active',
    reviewExpiresAt:Timestamp.fromMillis(current+86400000)
  });
  await fixture.commit();
  let authChecks=0;
  const verify=async(token,checkRevoked)=>{
    assert.equal(checkRevoked,true);
    authChecks++;
    return auth.verifyIdToken(token,checkRevoked);
  };
  const dependencies={
    db,verifyIdToken:verify,serverTimestamp:()=>FieldValue.serverTimestamp(),
    clock:()=>current,projectId
  };
  const service=createCaseReviewWorkflow(dependencies);
  const read=createScopedModerationService(dependencies);
  const http=createCaseReviewWorkflowHttpHandler(service,{enabled:true});
  const request=(path,token,fields)=>http(new Request(endpoint+path,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({channel,caseId,...fields})
  }));
  const check=async(response,code,status)=>{
    assert.equal(response.status,code);
    const data=await response.json();
    assert.equal(data.status,status);
    assert.match(response.headers.get('cache-control'),/no-store/);
    return data;
  };
  await t.test('token real verificado e papel atribuído abrem somente prova mínima',async()=>{
    const proof=await read.open({idToken:tokens.moderator,channel,caseId});
    assert.deepEqual(Object.keys(proof).sort(),
      ['caseId','channel','excerpt','reason','reportedAt']);
    assert.equal(proof.excerpt,'Apenas a prova mínima autorizada em QA');
    assert.equal(await read.open({idToken:tokens.other,channel,caseId}),null);
    assert.equal(await read.open({idToken:tokens.unverified,channel,caseId}),null);
    assert.equal((await db.collection('chatModerationAccessEvents').get()).size,1);
  });

  await t.test('triagem e decisão autenticadas são transações por caso',async()=>{
    await check(await request('/action',tokens.other,{action:'triage'}),404,
      'case_unavailable');
    await check(await request('/action',tokens.unverified,{action:'triage'}),404,
      'case_unavailable');
    const triaged=await check(await request('/action',tokens.moderator,
      {action:'triage'}),200,'accepted');
    assert.equal(triaged.stage,'triaged');
    const decided=await check(await request('/action',tokens.moderator,{
      action:'decide',decision:'dismissed',note
    }),200,'accepted');
    assert.equal(decided.stage,'decided');
    assert.equal((await db.doc(statePath).get()).get('decisionBy'),uid.moderator);
  });

  await t.test('recurso pertence à denunciante, nunca ao moderador ou terceiro',async()=>{
    await check(await request('/appeal',tokens.other,{reason}),404,'case_unavailable');
    await check(await request('/appeal',tokens.moderator,{reason}),404,
      'case_unavailable');
    const appealed=await check(await request('/appeal',tokens.reporter,
      {reason}),200,'accepted');
    assert.equal(appealed.stage,'appealed');
    await check(await request('/appeal',tokens.reporter,{reason}),404,
      'case_unavailable');
    await check(await request('/action',tokens.moderator,{
      action:'review_appeal',decision:'upheld',note
    }),404,'case_unavailable');
  });

  await t.test('revogação de atribuição atua antes da leitura de estado',async()=>{
    await db.doc(grantPath).update({moderatorUid:uid.reviewer});
    await check(await request('/state',tokens.moderator,{}),404,'case_unavailable');
    await check(await request('/state',tokens.reviewer,{}),200,'available');
    const reviewed=await check(await request('/action',tokens.reviewer,{
      action:'review_appeal',decision:'upheld',note
    }),200,'accepted');
    assert.equal(reviewed.stage,'appeal_reviewed');
  });

  await t.test('role desligado, token apagado e grant vencido não autorizam',async()=>{
    await db.doc('admins/'+uid.reviewer).update({enabled:false});
    await check(await request('/state',tokens.reviewer,{}),404,'case_unavailable');
    await db.doc('admins/'+uid.reviewer).update({enabled:true});
    await auth.deleteUser(uid.reviewer);
    // ID token emitido anteriormente: checkRevoked=true consulta a identidade.
    await check(await request('/state',tokens.reviewer,{}),404,'case_unavailable');
    current+=86400000;
    // Restaurar o papel não renova a atribuição com prazo vencido.
    await check(await request('/state',tokens.moderator,{}),404,'case_unavailable');
  });

  await t.test('trilha não contém prova, notas, identidade denunciada ou tokens',async()=>{
    const events=await db.collection('chatModerationWorkflowEvents').get();
    assert.ok(events.size>=4);
    for(const row of events.docs){
      assert.deepEqual(Object.keys(row.data()).sort(),
        ['action','actorUid','caseId','channel','outcome','recordedAt']);
      assert.equal(row.get('outcome'),'accepted');
      assert.ok(row.get('recordedAt')?.toDate());
      const json=JSON.stringify(row.data());
      assert.ok(!json.includes('Apenas a prova mínima'));
      assert.ok(!json.includes(password));
      assert.ok(!json.includes(note));
      assert.ok(!json.includes(reason));
    }
    assert.ok(authChecks>=10);
  });
});
