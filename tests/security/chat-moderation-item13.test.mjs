// Item 13 #199 — Firestore Emulator, identidades e mensagens 100% fictícias.
// O teste do endpoint injeta um verificador Auth simulado; a ACL de casos,
// os relatórios e a trilha são consultados e persistidos no Firestore Emulator.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {FieldValue, getFirestore} from 'firebase-admin/firestore';
import {assertFails,assertSucceeds,initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,doc,getDocFromServer,getDocsFromServer,setDoc,Timestamp,writeBatch}
  from 'firebase/firestore';
import {alice,bob,moderator,pilotDocuments,pilotFlags,projectId}
  from '../../firebase/qa-geral-celular/pilot/fixtures.mjs';
import {renderClosedPilotRules} from '../../firebase/qa-geral-celular/pilot/rules.mjs';
import {createScopedModerationService,createScopedModerationHttpHandler}
  from '../../firebase/qa-general/chat-moderation-item13.mjs';

assert.match(process.env.FIRESTORE_EMULATOR_HOST??'',/^127\.0\.0\.1:\d+$/);
assert.equal(projectId,'demo-atrio-v11');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
const now=new Date();
const reportTime=Timestamp.fromDate(now);
const expires=Timestamp.fromDate(new Date(now.getTime()+86400000));
const chatId=alice.uid+'__'+bob.uid;
const groupId='qa-item13-grupo';
const chat='chats/'+chatId;
const group='chat_groups/'+groupId;
const cases=[
  {channel:'direct',messageId:'dm1',reporter:alice.uid,kind:'chatId',
    target:chatId,excerpt:'Trecho fictício escolhido da DM, sem contexto adjacente.',
    assigned:true},
  {channel:'direct',messageId:'dm2',reporter:alice.uid,kind:'chatId',
    target:chatId,excerpt:'Outra denúncia fictícia na DM, fora da atribuição.',
    assigned:false},
  {channel:'group',messageId:'gr1',reporter:bob.uid,kind:'groupId',
    target:groupId,excerpt:'Trecho fictício escolhido no grupo, sem contexto adjacente.',
    assigned:true},
  {channel:'group',messageId:'gr2',reporter:bob.uid,kind:'groupId',
    target:groupId,excerpt:'Outra denúncia fictícia no grupo, fora da atribuição.',
    assigned:false}
].map(row=>({...row,caseId:row.reporter+'__'+row.target+'__'+row.messageId,
  path:(row.channel==='direct'?'chat_reports/':'chat_group_reports/')+
    row.reporter+'__'+row.target+'__'+row.messageId}));
const lucia=moderator;
const external={uid:'qa-item13-other-mod',email:'other@qa.invalid'};
const stranger={uid:'qa-item13-fora',email:'fora@qa.invalid'};
const reason='Motivo sintético para revisão humana.';
const endpoint='https://case.qa.invalid/v1/qa/conversations/moderation/case';

test('item 13: escopo por caso e trilha sem acesso ao histórico',async t=>{
  const env=await initializeTestEnvironment({projectId,firestore:{
    host,port:Number(port),rules:renderClosedPilotRules()
  }});
  const app=initializeApp({projectId},'item13-'+Date.now());
  const db=getFirestore(app);
  t.after(async()=>{await deleteApp(app);await env.cleanup();});
  const ctx=account=>env.authenticatedContext(account.uid,{
    email:account.email,email_verified:true
  }).firestore();
  const clara=ctx(alice),miguel=ctx(bob),mod=ctx(lucia),
    other=ctx(external),guest=ctx(stranger);
  const sources=new Map([...pilotDocuments(now),...pilotFlags(true)]);
  sources.set(chat,{participants:[alice.uid,bob.uid],requesterUid:alice.uid,
    recipientUid:bob.uid,status:'accepted'});
  sources.set(group,{name:'Grupo de oração fictício',ownerUid:alice.uid,
    memberUids:[alice.uid,bob.uid],adminUids:[alice.uid],status:'active'});
  sources.set('admins/'+external.uid,{enabled:true});
  for(const [path,uid] of [[chat+'/messages/dm1',bob.uid],
    [chat+'/messages/dm2',bob.uid],
    [group+'/messages/gr1',alice.uid],
    [group+'/messages/gr2',alice.uid]]){
    sources.set(path,{uid,kind:'text',text:'Mensagem fictícia isolada '+path,createdAt:reportTime});
  }
  for(const c of cases){
    sources.set(c.path,{[c.kind]:c.target,messageId:c.messageId,
      reporterUid:c.reporter,reason,reportedText:c.excerpt,createdAt:reportTime});
    sources.set('chatModerationAssignments/'+c.channel+'/cases/'+c.caseId,{
      moderatorUid:c.assigned?lucia.uid:external.uid,
      status:'active',reviewExpiresAt:expires
    });
  }
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const batch=writeBatch(context.firestore());
    for(const [path,data] of sources)batch.set(doc(context.firestore(),path),data);
    await batch.commit();
  });

  const tokens=new Map([
    ['lucia-session',{uid:lucia.uid,aud:projectId,email_verified:true}],
    ['other-session',{uid:external.uid,aud:projectId,email_verified:true}],
    ['clara-session',{uid:alice.uid,aud:projectId,email_verified:true}],
    ['wrong-project',{uid:lucia.uid,aud:'outro-projeto',email_verified:true}],
    ['unverified',{uid:lucia.uid,aud:projectId,email_verified:false}]
  ]);
  let authChecks=0;
  let clock=now.getTime();
  const verifyIdToken=async(token,checkRevoked)=>{
    assert.equal(checkRevoked,true);
    authChecks++;
    if(!tokens.has(token))throw Error('token_revoked_or_invalid');
    return tokens.get(token);
  };
  const service=createScopedModerationService({
    db,verifyIdToken,serverTimestamp:()=>FieldValue.serverTimestamp(),
    clock:()=>clock,projectId
  });
  const http=createScopedModerationHttpHandler(service,{enabled:true});
  const send=(c,token='lucia-session')=>http(new Request(endpoint,{
    method:'POST',headers:{'Content-Type':'application/json',
      Authorization:'Bearer '+token},
    body:JSON.stringify({channel:c.channel,caseId:c.caseId})
  }));
  const denied=async(response)=>{
    assert.equal(response.status,404);
    assert.deepEqual(await response.json(),{status:'case_unavailable'});
  };
  const audit=()=>db.collection('chatModerationAccessEvents').get();

  await t.test('13.1/13.2: autor lê apenas o próprio protocolo; ninguém lista',async()=>{
    for(const c of cases){
      const owner=ctx(c.reporter===alice.uid?alice:bob);
      const report=await assertSucceeds(getDocFromServer(doc(owner,c.path)));
      assert.equal(report.get('reportedText'),c.excerpt);
      assert.equal(Object.keys(report.data()).sort().join('|'),
        [c.kind,'createdAt','messageId','reason','reportedText','reporterUid']
          .sort().join('|'));
      assert.equal(report.get('messageId'),c.messageId);
      await assertFails(getDocFromServer(doc(
        c.reporter===alice.uid?miguel:clara,c.path)));
    }
    for(const client of [clara,miguel,mod,other,guest]){
      await assertFails(getDocsFromServer(collection(client,'chat_reports')));
      await assertFails(getDocsFromServer(collection(client,'chat_group_reports')));
    }
  });

  await t.test('13.3: Lúcia vê somente os dois casos atribuídos; auditoria atômica',async()=>{
    for(const c of cases.filter(item=>item.assigned)){
      const response=await send(c);
      assert.equal(response.status,200);
      assert.match(response.headers.get('cache-control'),/no-store/);
      const body=await response.json();
      assert.equal(body.status,'available');
      assert.deepEqual(Object.keys(body.case).sort(),[
        'caseId','channel','excerpt','reason','reportedAt'
      ]);
      assert.equal(body.case.excerpt,c.excerpt);
      assert.equal(body.case.caseId,c.caseId);
      assert.equal(body.case.channel,c.channel);
      assert.equal(body.case.reason,reason);
      assert.ok(!JSON.stringify(body).includes('Mensagem fictícia isolada'));
    }
    const logs=await audit();
    assert.equal(logs.size,2);
    for(const row of logs.docs){
      assert.deepEqual(Object.keys(row.data()).sort(),[
        'accessedAt','caseId','channel','moderatorUid','outcome'
      ]);
      assert.equal(row.get('moderatorUid'),lucia.uid);
      assert.equal(row.get('outcome'),'allowed');
      assert.ok(row.get('accessedAt')?.toDate());
    }
  });

  await t.test('13.4: atribuição alheia e sessão inválida não retornam metadados',async()=>{
    const initial=(await audit()).size;
    for(const c of cases.filter(item=>!item.assigned))await denied(await send(c));
    for(const token of ['clara-session','wrong-project','unverified','expired-token'])
      await denied(await send(cases[0],token));
    await denied(await send(cases[0],'other-session'));
    await denied(await send({...cases[0],caseId:'nao-existe'}));
    assert.equal((await audit()).size,initial);
    assert.ok(authChecks>=7);
  });

  await t.test('13.5: revogar atribuição e papel fecha a sessão anterior',async()=>{
    const selected=cases[0];
    const ref=db.doc('chatModerationAssignments/'+selected.channel+'/cases/'+selected.caseId);
    await ref.update({status:'revoked'});
    await denied(await send(selected));
    await ref.update({status:'active',reviewExpiresAt:Timestamp.fromDate(new Date(clock+4000))});
    assert.equal((await send(selected)).status,200);
    await db.doc('admins/'+lucia.uid).update({enabled:false});
    await denied(await send(selected));
    await db.doc('admins/'+lucia.uid).update({enabled:true});
    clock+=4000; // Vence exatamente no limite, sem espera real.
    await denied(await send(selected));
  });

  await t.test('13.6: atribuída não abre DM, grupo, mensagens ou trechos vizinhos',async()=>{
    for(const path of [chat,group,...['dm1','dm2'].map(id=>chat+'/messages/'+id),
      ...['gr1','gr2'].map(id=>group+'/messages/'+id)]){
      await assertFails(getDocFromServer(doc(mod,path)));
    }
    await assertFails(getDocsFromServer(collection(mod,chat,'messages')));
    await assertFails(getDocsFromServer(collection(mod,group,'messages')));
    for(const c of cases){
      await assertFails(getDocFromServer(doc(mod,c.path)));
      await assertFails(setDoc(doc(mod,'chatModerationAssignments/'+c.channel+'/cases/'+c.caseId),
        {moderatorUid:lucia.uid,status:'active',reviewExpiresAt:expires}));
    }
    await assertFails(setDoc(doc(mod,'chatModerationAccessEvents/forged'),
      {moderatorUid:lucia.uid}));
    // O controle positivo de leitura de participante deve usar Rules de chat,
    // nunca a credencial administrativa do serviço.
    await assertSucceeds(getDocFromServer(doc(clara,chat+'/messages/dm1')));
    await assertSucceeds(getDocFromServer(doc(miguel,group+'/messages/gr1')));
  });

  await t.test('endpoint fechado por padrão, fora de rota e sem corpo aceito',async()=>{
    const disabled=createScopedModerationHttpHandler(service);
    const request=new Request(endpoint,{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer lucia-session'},
      body:JSON.stringify({channel:cases[0].channel,caseId:cases[0].caseId})});
    assert.equal((await disabled(request)).status,503);
    assert.equal((await http(new Request(endpoint.replace('/case','/queue'),{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({channel:'direct',caseId:cases[0].caseId})
    }))).status,400);
    assert.equal((await audit()).size,3);
  });
});
