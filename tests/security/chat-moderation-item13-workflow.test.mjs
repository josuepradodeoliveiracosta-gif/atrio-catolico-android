// Item 13: contrato mínimo de atendimento humano por caso, SOMENTE Emulator.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {FieldValue,Timestamp,getFirestore} from 'firebase-admin/firestore';
import {assertFails,assertSucceeds,initializeTestEnvironment}
  from '@firebase/rules-unit-testing';
import {collection,doc,getDocFromServer,getDocsFromServer,setDoc,writeBatch}
  from 'firebase/firestore';
import {renderClosedPilotRules} from '../../firebase/qa-geral-celular/pilot/rules.mjs';
import {alice,bob,moderator,pilotDocuments,pilotFlags,projectId}
  from '../../firebase/qa-geral-celular/pilot/fixtures.mjs';
import {createScopedModerationService} from '../../firebase/qa-general/chat-moderation-item13.mjs';
import {createCaseReviewWorkflow,createCaseReviewWorkflowHttpHandler}
  from '../../firebase/qa-general/chat-moderation-item13-workflow.mjs';

assert.equal(projectId,'demo-atrio-v11');
assert.match(process.env.FIRESTORE_EMULATOR_HOST??'',/^127\.0\.0\.1:\d+$/);
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
const base='https://item13.qa.invalid/v1/qa/conversations/moderation/case';
const other={uid:'qa-reviewer-appeal',email:'reviewer@qa.invalid'};
const outside={uid:'qa-item13-fora',email:'fora@qa.invalid'};
const now=new Date();
const end=new Date(now.getTime()+86400000);
const tokenClaims={
  lucia:{uid:moderator.uid,aud:projectId,email_verified:true},
  reviewer:{uid:other.uid,aud:projectId,email_verified:true},
  clara:{uid:alice.uid,aud:projectId,email_verified:true},
  miguel:{uid:bob.uid,aud:projectId,email_verified:true},
  invalidProject:{uid:moderator.uid,aud:'outro',email_verified:true}
};
const sample=[
  {channel:'direct',target:'chatId',reporter:alice.uid,conversation:'qa-dm-clara-miguel',
    message:'dm01',text:'Trecho fictício selecionado DM'},
  {channel:'group',target:'groupId',reporter:bob.uid,conversation:'qa-grupo-clara-miguel',
    message:'gr01',text:'Trecho fictício selecionado grupo'},
  {channel:'direct',target:'chatId',reporter:bob.uid,conversation:'qa-dm-clara-miguel',
    message:'dm02',text:'Protocolo fora do caso da Lúcia'},
  {channel:'group',target:'groupId',reporter:alice.uid,conversation:'qa-grupo-clara-miguel',
    message:'gr02',text:'Outro protocolo fora do caso da Lúcia'}
].map(c=>({...c,id:c.reporter+'__'+c.conversation+'__'+c.message,
  report:(c.channel==='direct'?'chat_reports/':'chat_group_reports/')+
    c.reporter+'__'+c.conversation+'__'+c.message}));
const grantPath=c=>'chatModerationAssignments/'+c.channel+'/cases/'+c.id;
const statePath=c=>'chatModerationCaseStates/'+c.channel+'/cases/'+c.id;
const note='Decisão humana de laboratório, sem remoção de conteúdo.';
const appealReason='Solicito revisão desta decisão fictícia.';
const request=(endpoint,token,body)=>new Request(base+endpoint,{
  method:'POST',headers:{'Content-Type':'application/json',
    Authorization:'Bearer '+token},body:JSON.stringify(body)
});
const bodyOf=(c,extra={})=>({channel:c.channel,caseId:c.id,...extra});

test('item 13: ciclo de atendimento humano limitado ao caso e com trilha',async t=>{
  const env=await initializeTestEnvironment({projectId,
    firestore:{host,port:Number(port),rules:renderClosedPilotRules()}});
  const app=initializeApp({projectId},'workflow13-'+Date.now());
  const db=getFirestore(app);
  t.after(async()=>{await deleteApp(app);await env.cleanup();});
  await env.clearFirestore();
  // A leitura positiva do denunciante exige flags e papéis sintéticos do piloto.
  await env.withSecurityRulesDisabled(async context=>{
    const seeded=context.firestore();
    const fixture=writeBatch(seeded);
    for(const [path,data] of [...pilotDocuments(now),...pilotFlags(true)])
      fixture.set(doc(seeded,path),data);
    await fixture.commit();
  });
  const batch=db.batch();
  for(const {uid} of [moderator,other])batch.set(db.doc('admins/'+uid),{enabled:true});
  for(let i=0;i<sample.length;i++){
    const c=sample[i];
    batch.set(db.doc(c.report),{[c.target]:c.conversation,messageId:c.message,
      reporterUid:c.reporter,reason:'Relato fictício para moderação humana.',
      reportedText:c.text,createdAt:Timestamp.fromDate(now)});
    batch.set(db.doc(grantPath(c)),{moderatorUid:i<2?moderator.uid:other.uid,
      status:'active',reviewExpiresAt:Timestamp.fromDate(end)});
  }
  // Documentos reais de chat e grupo não são necessários nem acessados.
  await batch.commit();

  let authCalls=0;
  const verifyIdToken=async(token,checkRevoked)=>{
    assert.equal(checkRevoked,true);
    authCalls++;
    if(!Object.hasOwn(tokenClaims,token))throw Error('revoked');
    return tokenClaims[token];
  };
  let clock=now.getTime();
  const parameters={db,verifyIdToken,serverTimestamp:()=>FieldValue.serverTimestamp(),
    clock:()=>clock,projectId};
  const workflow=createCaseReviewWorkflow(parameters);
  const http=createCaseReviewWorkflowHttpHandler(workflow,{enabled:true});
  const opener=createScopedModerationService(parameters);
  const direct=sample[0],group=sample[1],outsider=sample[2],outerGroup=sample[3];
  const send=(c,operation,token='lucia',fields={})=>{
    const path=operation==='appeal'?'/appeal':
      operation==='state'?'/state':'/action';
    const extra=operation==='state'?{}:operation==='appeal'?fields:
      {action:operation,...fields};
    return http(request(path,token,bodyOf(c,extra)));
  };
  const deny=async(p)=>{
    const r=await p;assert.equal(r.status,404);
    assert.deepEqual(await r.json(),{status:'case_unavailable'});
    assert.match(r.headers.get('cache-control'),/no-store/);
  };
  const ok=async(p,stage)=>{
    const r=await p;assert.equal(r.status,200);
    assert.match(r.headers.get('cache-control'),/no-store/);
    const d=await r.json();assert.equal(d.stage,stage);
    assert.ok(!JSON.stringify(d).includes('Trecho fictício'));
    assert.ok(!JSON.stringify(d).includes('Decisão humana'));
    return d;
  };
  const audits=()=>db.collection('chatModerationWorkflowEvents').get();

  await t.test('consulta existente permanece imutável e atribuída',async()=>{
    const previous=await opener.open({
      idToken:'lucia',channel:direct.channel,caseId:direct.id
    });
    assert.deepEqual(Object.keys(previous).sort(),[
      'caseId','channel','excerpt','reason','reportedAt']);
    assert.equal(previous.excerpt,direct.text);
    assert.equal(await opener.open({idToken:'lucia',channel:outsider.channel,
      caseId:outsider.id}),null);
    assert.equal((await db.collection('chatModerationAccessEvents').get()).size,1);
    await ok(send(direct,'state'), 'open');
    await deny(send(outsider,'state'));
    await deny(send(outerGroup,'state'));
  });

  await t.test('triagem exige atribuição e estado inicial; DM e grupo',async()=>{
    await deny(send(outsider,'triage'));
    await deny(send(outerGroup,'triage'));
    await deny(send(direct,'triage','invalidProject'));
    await deny(send(direct,'triage','clara'));
    await ok(send(direct,'triage'),'triaged');
    await ok(send(group,'triage'),'triaged');
    await deny(send(direct,'triage'));
    await ok(send(direct,'state'),'triaged');
    assert.equal((await db.doc(statePath(direct)).get()).get('stage'),'triaged');
  });

  await t.test('decisão com justificativa, sem remover conteúdo ou acessar conversa',async()=>{
    await deny(send(direct,'decide','lucia',{decision:'removed',note}));
    await deny(send(direct,'decide','lucia',{decision:'dismissed',note:'cur'}));
    await ok(send(direct,'decide','lucia',{decision:'dismissed',note}),'decided');
    await ok(send(group,'decide','lucia',{decision:'action_recommended',note}),
      'decided');
    await deny(send(direct,'decide','lucia',{decision:'dismissed',note}));
    assert.equal((await db.doc(statePath(group)).get()).get('decision'),
      'action_recommended');
    const c=await db.doc(group.report).get();
    assert.equal(c.get('reportedText'),group.text);
    assert.equal(c.get('reason'),'Relato fictício para moderação humana.');
    assert.equal((await db.collection('chats').get()).size,0);
    assert.equal((await db.collection('chat_groups').get()).size,0);
  });

  await t.test('recurso apenas da pessoa denunciante; nenhuma segunda interposição',async()=>{
    await deny(send(direct,'appeal','lucia',{reason:appealReason}));
    await deny(send(direct,'appeal','miguel',{reason:appealReason}));
    await deny(send(group,'appeal','clara',{reason:appealReason}));
    await ok(send(direct,'appeal','clara',{reason:appealReason}),'appealed');
    await ok(send(group,'appeal','miguel',{reason:appealReason}),'appealed');
    await deny(send(direct,'appeal','clara',{reason:appealReason}));
    assert.equal((await db.doc(statePath(direct)).get()).get('appealBy'),alice.uid);
  });

  await t.test('revisão do recurso exige outro moderador atribuído',async()=>{
    await deny(send(direct,'review_appeal','lucia',{decision:'upheld',note}));
    await db.doc(grantPath(direct)).update({moderatorUid:other.uid});
    await db.doc(grantPath(group)).update({moderatorUid:other.uid});
    await deny(send(direct,'review_appeal','lucia',{decision:'upheld',note}));
    await deny(send(group,'review_appeal','lucia',{decision:'upheld',note}));
    await ok(send(direct,'review_appeal','reviewer',{decision:'upheld',note}),
      'appeal_reviewed');
    await ok(send(group,'review_appeal','reviewer',{decision:'revised',note}),
      'appeal_reviewed');
    await deny(send(direct,'review_appeal','reviewer',{decision:'revised',note}));
    await deny(send(direct,'appeal','clara',{reason:appealReason}));
    assert.equal((await db.doc(statePath(direct)).get()).get('appealResult'),'upheld');
    assert.equal((await db.doc(statePath(group)).get()).get('appealResult'),'revised');
  });

  await t.test('revogar atribuição, papel e expirar sessão fecha transições/estado',async()=>{
    await db.doc(grantPath(direct)).update({status:'revoked'});
    await deny(send(direct,'state','reviewer'));
    await db.doc(grantPath(direct)).update({status:'active'});
    await ok(send(direct,'state','reviewer'),'appeal_reviewed');
    await db.doc('admins/'+other.uid).update({enabled:false});
    await deny(send(direct,'state','reviewer'));
    await db.doc('admins/'+other.uid).update({enabled:true});
    await db.doc(grantPath(direct)).update({
      reviewExpiresAt:new Date(clock+1000)});
    clock+=1000;
    await deny(send(direct,'state','reviewer'));
    await deny(send(direct,'state','not-a-token'));
  });

  await t.test('cliente comum ou moderador não lê/escreve histórico nem estados brutos',async()=>{
    const user=env.authenticatedContext(alice.uid,{email_verified:true}).firestore();
    const mod=env.authenticatedContext(moderator.uid,{email_verified:true}).firestore();
    for(const c of sample){
      await assertFails(getDocFromServer(doc(mod,c.report)));
      await assertFails(getDocFromServer(doc(mod,statePath(c))));
      await assertFails(getDocFromServer(doc(user,statePath(c))));
      await assertFails(setDoc(doc(user,statePath(c)),{stage:'appeal_reviewed'}));
      await assertFails(setDoc(doc(mod,grantPath(c)),{
        moderatorUid:moderator.uid,status:'active'
      }));
    }
    for(const col of ['chat_reports','chat_group_reports','chatModerationWorkflowEvents',
      'chatModerationCaseStates','chatModerationAssignments']){
      await assertFails(getDocsFromServer(collection(mod,col)));
    }
    await assertFails(getDocFromServer(doc(mod,
      'chats/qa-dm-clara-miguel/messages/dm01')));
    await assertFails(getDocFromServer(doc(mod,
      'chat_groups/qa-grupo-clara-miguel/messages/gr01')));
    await assertFails(setDoc(doc(mod,'chatModerationWorkflowEvents/forged'),{
      action:'triage'
    }));
    // Relator continua com direito pontual ao próprio protocolo (Rules #445).
    assert.ok((await assertSucceeds(getDocFromServer(doc(user,direct.report)))).exists());
  });

  await t.test('trilha tem apenas ator, caso, ação e horário',async()=>{
    const docs=await audits();assert.ok(docs.size>=10);
    const expected=['action','actorUid','caseId','channel','outcome','recordedAt'];
    for(const d of docs.docs){
      assert.deepEqual(Object.keys(d.data()).sort(),expected);
      assert.equal(d.get('outcome'),'accepted');
      assert.ok(d.get('recordedAt')?.toDate());
      assert.ok(!JSON.stringify(d.data()).includes('Trecho fictício'));
      assert.ok(!JSON.stringify(d.data()).includes('Decisão humana'));
    }
    assert.ok(authCalls>=18);
  });

  await t.test('handler fechado, requisição inválida e falhas não expõem evidências',async()=>{
    const disabled=createCaseReviewWorkflowHttpHandler(workflow);
    assert.equal((await disabled(request('/state','lucia',bodyOf(direct)))).status,503);
    const malformed=await http(request('/action','lucia',
      {...bodyOf(direct),action:'triage',role:'superadmin'}));
    assert.equal(malformed.status,400);
    assert.deepEqual(await malformed.json(),{status:'invalid_request'});
    const wrongRoute=await http(request('/global','lucia',bodyOf(direct)));
    assert.equal(wrongRoute.status,400);
    await deny(send(outsider,'state'));
    assert.equal((await db.collection('chatModerationAccessEvents').get()).size,1);
  });
});
