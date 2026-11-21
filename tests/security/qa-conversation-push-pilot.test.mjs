// O Worker lê documentos do mesmo Firestore Emulator que autoriza a leitura do destinatário.
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {isDeepStrictEqual} from 'node:util';
import {assertFails, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {deleteApp, initializeApp} from 'firebase-admin/app';
import {FieldValue, getFirestore} from 'firebase-admin/firestore';
import {collection,deleteDoc,doc,getDocFromServer,getDocsFromServer,limit,query,setDoc,
  where,writeBatch} from 'firebase/firestore';
import {renderConversationPushPilotWorker}
  from '../../cloudflare/push-worker/scripts/conversation-push-pilot.mjs';
import {renderConversationPushPilotRules}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-rules.mjs';
import {conversationPushPilot as pilot,conversationPushPilotDocuments}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-fixtures.mjs';
import {createConversationPushAdmission}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
import {createConversationPushAdminHttpHandler}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-admin-http.mjs';
import {pilotDocuments, projectId as demoProject} from '../../firebase/qa-geral-celular/pilot/fixtures.mjs';

const emulatorHost=process.env.FIRESTORE_EMULATOR_HOST ?? '';
assert.match(emulatorHost,/^127\.0\.0\.1:[0-9]{1,5}$/,
  'Executar apenas com Firestore Emulator em loopback');
const originalFetch=globalThis.fetch;
const remoteRoot='projects/'+pilot.projectId+'/databases/'+pilot.databaseId+'/documents';
const demoRoot='projects/'+demoProject+'/databases/'+pilot.databaseId+'/documents';
const rules=renderConversationPushPilotRules();
const workerSource=renderConversationPushPilotWorker(readFileSync(
  new URL('../../cloudflare/push-worker/src/index.js',import.meta.url),'utf8'));
const worker=(await import('data:text/javascript;base64,'+
  Buffer.from(workerSource).toString('base64'))).default;
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const secret=JSON.stringify({
  project_id:pilot.projectId,
  client_email:'fixture@'+pilot.projectId+'.iam.gserviceaccount.com',
  private_key:privateKey.export({type:'pkcs8',format:'pem'}),
});
const reverse=process.env.ATRIO_383_REVERSE==='1';
const sender=reverse ? pilot.recipientUid : pilot.senderUid;
const recipient=reverse ? pilot.senderUid : pilot.recipientUid;
const unreadCounter=reverse ? 'unreadRequester' : 'unreadRecipient';
const room='chats/'+pilot.conversationId;
const event=room+'/messages/'+pilot.messageId;
const pending='users/'+recipient+'/chatPushPending/current';
const admission=uid=>'users/'+uid+'/chatPushAdmission/current';
const age=uid=>'users/'+uid+'/chatAgeEligibility/current';
const config='app_config/conversations';
const block=(a,b)=>'users/'+a+'/blockedMembers/'+b;
const mute='users/'+recipient+'/chatBox/'+pilot.conversationId;
const wrongProject='atrio-catolico-qa-geral';
const sha=value=>createHash('sha256').update(value).digest('hex');
console.log('qa_push_pilot_rules_sha256='+sha(rules)+' worker_sha256='+sha(workerSource));

function fakeToken(project, uid=sender) {
  const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return b64({alg:'RS256'})+'.'+
    b64({aud:project,iss:'https://securetoken.google.com/'+project,sub:uid})+'.fixture-signature';
}
function request(project=pilot.projectId, messageId=pilot.messageId) {
  return new Request('https://qa.invalid/event',{
    method:'POST',headers:{Authorization:'Bearer '+fakeToken(project)},
    body:JSON.stringify({type:'chat_message',chatId:pilot.conversationId,messageId}),
  });
}

function requestNotice(project=pilot.projectId, uid=recipient, suffix='') {
  return new Request('https://qa.invalid/notice'+suffix,{
    headers:{Authorization:'Bearer '+fakeToken(project,uid)},
  });
}

async function assertNotice(fixture, expected=200, messageId=pilot.messageId) {
  const before=fixture.stats();
  const notice=await worker.fetch(requestNotice(),fixture.env);
  assert.equal(notice.status,expected);
  assert.equal(notice.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await notice.json(),expected===200 ? {
    conversationId:pilot.conversationId,messageId,senderUid:sender,
  } : {status:expected===401 ? 'unauthorized' : 'no_notice'});
  assert.equal(fixture.stats().reserved,before.reserved);
  assert.equal(fixture.stats().sent,before.sent);
}

function useExternalFixtures(t,{changeAuth=()=>{},afterReservation=async()=>{}}={}) {
  const accounts=Object.fromEntries(Object.entries(pilot.accounts).map(([uid,email])=>
    [uid,{localId:uid,email,emailVerified:true}]));
  changeAuth(accounts);
  let reserved=0,sent=0,reads=0,cloudCalls=0;
  const database={
    prepare(sql) {
      return {bind(...params) {
        return {
          async first() {
            assert.match(sql,/atrio_qa_identity/);
            assert.deepEqual(params,['atrio-qa-conversations-pilot']);
            return {project_id:pilot.projectId};
          },
          async run() {
            if (/^INSERT OR IGNORE INTO delivered/.test(sql)) {
              reserved++;
              await afterReservation();
            } else assert.match(sql,/^(DELETE FROM delivered|INSERT INTO push_delivery_stats)/);
            return {meta:{changes:1}};
          },
        };
      }};
    },
  };
  const network=t.mock.method(globalThis,'fetch',async (input,init={})=>{
    cloudCalls++;
    const url=new URL(input);
    assert.equal(init.redirect,'error');
    const headers=new Headers(init.headers);
    if (url.origin==='https://oauth2.googleapis.com' && url.pathname==='/token') {
      assert.match(String(init.body),/assertion=/);
      return Response.json({access_token:'fixture-access-token',expires_in:3600});
    }
    if (url.origin==='https://identitytoolkit.googleapis.com'
        && url.pathname==='/v1/accounts:lookup') {
      const idToken=JSON.parse(init.body).idToken;
      const uid=[sender,recipient].find(candidate=>fakeToken(pilot.projectId,candidate)===idToken);
      return uid ? Response.json({users:[accounts[uid]]}) : new Response(null,{status:401});
    }
    if (url.origin==='https://identitytoolkit.googleapis.com'
        && url.pathname===('/v1/projects/'+pilot.projectId+'/accounts:lookup')) {
      assert.equal(headers.get('Authorization'),'Bearer fixture-access-token');
      const {localId}=JSON.parse(init.body);
      assert.deepEqual(localId,[sender,recipient]);
      return Response.json({users:localId.map(uid=>accounts[uid]).filter(Boolean)});
    }
    if (url.origin==='https://fcm.googleapis.com'
        && url.pathname===('/v1/projects/'+pilot.projectId+'/messages:send')) {
      assert.equal(headers.get('Authorization'),'Bearer fixture-access-token');
      assert.deepEqual(JSON.parse(init.body),{message:{
        token:'fixture-device-token-for-recipient',data:{signal:'refresh'},
        android:{priority:'HIGH',ttl:'60s'},
      }});
      sent++;
      return Response.json({name:'projects/'+pilot.projectId+'/messages/fixture'});
    }
    assert.equal(url.origin,'https://firestore.googleapis.com');
    assert.ok(url.pathname.startsWith('/v1/'+remoteRoot));
    assert.equal(headers.get('Authorization'),'Bearer fixture-access-token');
    reads++;
    headers.set('Authorization','Bearer owner'); // acesso administrativo do Emulator
    const body=init.body?.replaceAll(remoteRoot,demoRoot);
    const local=await originalFetch('http://'+emulatorHost+
      url.pathname.replace(remoteRoot,demoRoot)+url.search,{...init,headers,body});
    const response=await local.text();
    return new Response(response.replaceAll(demoRoot,remoteRoot),{
      status:local.status,headers:{'Content-Type':'application/json'},
    });
  });
  const env={
    ATRIO_GENERAL_QA_MODE:'true',ATRIO_GENERAL_QA_PROJECT:pilot.projectId,
    ATRIO_QA_AGE_POLICY:pilot.ageMode,PUSH_ENABLED:'true',
    FIREBASE_WEB_API_KEY:'fixture',FIREBASE_SERVICE_ACCOUNT_JSON:secret,PUSH_DB:database,
  };
  return {env, network, accounts, stats:()=>({reserved,sent,reads,cloudCalls})};
}

test('mesmos documentos para Rules e Worker de Conversas do piloto DM #199',async t=>{
  const env=await initializeTestEnvironment({
    projectId:demoProject,firestore:{host:'127.0.0.1',port:Number(emulatorHost.split(':')[1]),rules},
  });
  t.after(()=>env.cleanup());
  const session=(uid=recipient,claims={})=>env.authenticatedContext(uid,{
    email:pilot.accounts[uid] ?? 'outside@qa.invalid',email_verified:true,...claims,
  }).firestore();
  async function seed(change=()=>{}) {
    await env.clearFirestore();
    const proofs=new Map(pilotDocuments(new Date()).filter(([path])=>path===age(sender) || path===age(recipient)));
    await put(proofs);
    await delay(5); // Deixar a comprovação 18+ anterior à concessão, inclusive no mesmo relógio de teste.
    const admittedAt=new Date();
    await delay(5);
    const rows=new Map(conversationPushPilotDocuments(new Date(),admittedAt));
    for (const [path,proof] of proofs) rows.set(path,structuredClone(proof));
    if (reverse) {
      rows.set(room,{...rows.get(room),lastSenderUid:sender,unreadRequester:1,unreadRecipient:0});
      rows.set(event,{...rows.get(event),uid:sender});
      const originalPending='users/'+pilot.recipientUid+'/chatPushPending/current';
      rows.set(pending,{
        ...rows.get(originalPending), senderUid:sender,
        senderGeneration:rows.get(admission(sender)).generation,
        recipientGeneration:rows.get(admission(recipient)).generation,
      });
      rows.delete(originalPending);
    }
    rows.set('users/'+recipient+'/pushDevices/fixture',{
      token:'fixture-device-token-for-recipient',updatedAt:new Date(),
    });
    change(rows);
    const writes=new Map(rows);
    for (const [path,proof] of proofs) {
      if (!rows.has(path)) writes.set(path,null);
      else if (isDeepStrictEqual(rows.get(path),proof)) writes.delete(path);
    }
    await put(writes);
    return rows;
  }
  async function put(rows) {
    await env.withSecurityRulesDisabled(async context=>{
      const admin=context.firestore();
      const batch=writeBatch(admin);
      for (const [path,data] of rows) {
        const ref=doc(admin,path);
        if (data===null) batch.delete(ref);
        else batch.set(ref,data);
      }
      await batch.commit();
    });
  }

  const alter=(path,fields)=>rows=>rows.set(path,{...rows.get(path),...fields});
  const blocked=(a,b)=>alter(block(a,b),{createdAt:new Date()});
  const old=new Date(0);
  for (const [name,change,allowed] of [
    ['par admitido',()=>{},true],
    ['credencial do destinatário revogada',alter(admission(recipient),{status:'revoked'}),false],
    ['credencial do autor revogada',alter(admission(sender),{status:'revoked'}),false],
    ['credencial do destinatário expirada',alter(admission(recipient),{expiresAt:old}),false],
    ['credencial do autor expirada',alter(admission(sender),{expiresAt:old}),false],
    ['readmissão de rodada antiga',alter(admission(recipient),{roundId:'rodada-antiga'}),false],
    ['admissão excluída',rows=>rows.delete(admission(recipient)),false],
    ['admissão legada sem geração',rows=>delete rows.get(admission(sender)).generation,false],
    ['admissão sem data de concessão',rows=>delete rows.get(admission(recipient)).admittedAt,false],
    ['aviso legado sem geração',rows=>delete rows.get(pending).senderGeneration,false],
    ['aviso com gerações invertidas',rows=>{
      const notice=rows.get(pending);
      [notice.senderGeneration,notice.recipientGeneration]=[notice.recipientGeneration,notice.senderGeneration];
    },false],
    ['mensagem no mesmo milissegundo que a admissão',rows=>{
      rows.get(admission(sender)).admittedAt=rows.get(event).createdAt;
    },false],
    ['idade do autor revogada',alter(age(sender),{status:'revoked'}),false],
    ['idade do destinatário expirada',alter(age(recipient),{reviewExpiresAt:old}),false],
    ['idade em formato incorreto',alter(age(recipient),{minimumAge:'18'}),false],
    ['bloqueio pelo autor',blocked(sender,recipient),false],
    ['bloqueio pelo destinatário',blocked(recipient,sender),false],
    ['DM silenciada',alter(mute,{muted:true}),false],
    ['meta de silenciamento mal tipada',alter(mute,{muted:'true'}),false],
    ['aviso de evento divergente',alter(pending,{messageId:'outra'}),false],
    ['aviso vencido',alter(pending,{expiresAt:old}),false],
    ['aviso marcado como lido',alter(pending,{unread:false}),false],
    ['aviso com conteúdo estranho ao contrato',alter(pending,{body:'conteúdo fictício'}),false],
    ['aviso pertence a outro tipo',alter(pending,{kind:'group_message'}),false],
    ['contador canônico zerado',alter(room,{[unreadCounter]:0}),false],
    ['última mensagem divergente',alter(room,{lastMessageId:'outra'}),false],
    ['mensagem removida',alter(event,{deletedForAll:true}),false],
    ['participantes divergentes',alter(room,{participants:[sender,'outro']}),false],
    ['janela fechada',rows=>rows.set(config,{...rows.get(config),enabled:false}),false],
    ['round inválido',rows=>rows.set(config,{
      ...rows.get(config),pushPilot:{...rows.get(config).pushPilot,roundId:'outro'},
    }),false],
  ]) {
    await t.test(name,async sub=>{
      await seed(change);
      await assertFails(getDocFromServer(doc(session(),pending)));
      const fixture=useExternalFixtures(sub);
      await assertNotice(fixture,allowed ? 200 : 404);
      const before=fixture.stats().cloudCalls;
      const response=await worker.fetch(request(),fixture.env);
      assert.equal(response.status,202);
      const counts=fixture.stats();
      assert.equal(counts.reserved,Number(allowed),JSON.stringify(counts));
      assert.equal(counts.sent,Number(allowed),JSON.stringify(counts));
      assert.ok(counts.cloudCalls-before<=50);
    });
  }

  for (const [role,uid] of [['autor',sender],['destinatário',recipient]]) {
    await t.test('readmissão do '+role+' bloqueia aviso antigo e libera mensagem nova',async sub=>{
      const rows=await seed();
      const originalMessage=rows.get(event);
      const originalPending=rows.get(pending);
      const originalAdmission=rows.get(admission(uid));
      const fixture=useExternalFixtures(sub);
      await assertNotice(fixture); // Aviso que pode já estar visível no Android.
      await put([[admission(uid),{...originalAdmission,status:'revoked'}]]);
      await assertNotice(fixture,404);

      const admittedAt=new Date(originalMessage.createdAt.getTime()+1);
      const newAdmission=createConversationPushAdmission(uid,admittedAt,originalAdmission.expiresAt);
      assert.notEqual(newAdmission.generation,originalAdmission.generation);
      await put([[admission(uid),newAdmission]]);
      await assertFails(getDocFromServer(doc(session(),pending)));
      await assertNotice(fixture,404); // Reconsulta no toque atrasado.
      for (let retry=0; retry<2; retry++) {
        assert.equal((await worker.fetch(request(),fixture.env)).status,202);
      }
      assert.equal(fixture.stats().reserved,0);
      assert.equal(fixture.stats().sent,0);

      const renewedPending={
        ...originalPending,
        [uid===sender ? 'senderGeneration' : 'recipientGeneration']:newAdmission.generation,
      };
      await put([[pending,renewedPending]]);
      await assertNotice(fixture,404);
      assert.equal((await worker.fetch(request(),fixture.env)).status,202);
      assert.equal(fixture.stats().reserved,0);
      assert.equal(fixture.stats().sent,0);

      const newId='qa-199-mensagem-nova';
      const createdAt=new Date(admittedAt.getTime()+1);
      await put([
        [room,{...rows.get(room),lastMessageId:newId,updatedAt:createdAt}],
        [room+'/messages/'+newId,{...originalMessage,createdAt,text:'Outra mensagem fictícia'}],
        [pending,{...renewedPending,messageId:newId}],
      ]);
      await assertNotice(fixture,200,newId);
      assert.equal((await worker.fetch(request(),fixture.env)).status,202);
      assert.equal(fixture.stats().reserved,0);
      assert.equal(fixture.stats().sent,0);
      assert.equal((await worker.fetch(request(pilot.projectId,newId),fixture.env)).status,202);
      assert.equal(fixture.stats().reserved,1);
      assert.equal(fixture.stats().sent,1);

      for (const account of [sender,recipient]) {
        const manual=await getDocFromServer(doc(session(account),event));
        assert.equal(manual.id,pilot.messageId);
        assert.equal(manual.get('uid'),sender);
        assert.equal(manual.get('text'),originalMessage.text);
      }
    });
  }

  for (const [role,uid] of [['autor',sender],['destinatário',recipient]]) {
    for (const removeProof of [false,true]) {
      const change=removeProof ? 'exclusão' : 'revogação';
      await t.test('restauração 18+ após '+change+' do '+role+' recupera só a leitura manual',async sub=>{
        const rows=await seed();
        const fixture=useExternalFixtures(sub);
        await assertNotice(fixture);
        const proofPath=age(uid);
        const proof=rows.get(proofPath);
        await put([[proofPath,removeProof ? null : {...proof,status:'revoked'}]]);
        await assertFails(getDocFromServer(doc(session(uid),event)));
        await assertNotice(fixture,404);

        await put([[proofPath,proof]]); // Restauração autorizada no contexto privilegiado do Emulator.
        for (const account of [sender,recipient]) {
          const manual=await getDocFromServer(doc(session(account),event));
          assert.equal(manual.get('text'),rows.get(event).text);
        }
        // As admissões e a pendência anteriores continuam intactas na fixture.
        await assertNotice(fixture,404);
        assert.equal((await worker.fetch(request(),fixture.env)).status,202);
        assert.equal(fixture.stats().reserved,0);
        assert.equal(fixture.stats().sent,0);

        const renewed=createConversationPushAdmission(uid,new Date(),rows.get(admission(uid)).expiresAt);
        await put([[admission(uid),renewed]]);
        await assertNotice(fixture,404); // A nova concessão também não reabilita a pendência anterior.
        const renewedPending={...rows.get(pending),
          [uid===sender ? 'senderGeneration' : 'recipientGeneration']:renewed.generation};
        await put([[pending,renewedPending]]);
        await assertNotice(fixture,404); // Nem mesmo após religar o evento antigo à geração nova.

        const newId='mensagem-apos-restauracao';
        const createdAt=new Date();
        await put([
          [room,{...rows.get(room),lastMessageId:newId,updatedAt:createdAt}],
          [room+'/messages/'+newId,{...rows.get(event),createdAt}],
          [pending,{...renewedPending,messageId:newId}],
        ]);
        await assertNotice(fixture,200,newId);
        assert.equal((await worker.fetch(request(pilot.projectId,newId),fixture.env)).status,202);
        assert.equal(fixture.stats().reserved,1);
        assert.equal(fixture.stats().sent,1);
      });
    }
  }

  const adminApp=initializeApp({projectId:demoProject},'restoration-integrated');
  t.after(()=>deleteApp(adminApp));
  const database=getFirestore(adminApp);
  const operator='fixture-admission-operator';
  const publisher='fixture-notice-publisher';
  const allowedOperators={[operator]:['manage_admissions'],[publisher]:['publish_notices']};
  const handler=createConversationPushAdminHttpHandler({
    db:database, enabled:true, allowedOperators, serverTimestamp:()=>FieldValue.serverTimestamp(),
    auth:{async verifyIdToken(token, checkRevoked) {
      assert.equal(checkRevoked,true);
      assert.ok(Object.hasOwn(allowedOperators,token));
      return {uid:token,aud:pilot.projectId,email_verified:true,
        firebase:{sign_in_provider:'password'},atrioQaPushCapabilities:allowedOperators[token]};
    }},
  });
  const admin=(action,body,token=operator)=>handler(new Request(
    'https://admin.qa.invalid/v1/qa/conversations/push/admin/'+action, {
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(body),
    }));
  const revoke=async(uid,expectedGeneration)=>{
    const result=await admin('revoke',{uid,operationKey:'revogacao-integrada',expectedGeneration});
    assert.equal(result.status,200);
  };

  for (const [role,uid] of [['autor',sender],['destinatário',recipient]]) {
    await t.test('HTTP administrativo — revogação invalida admissão enfileirada para o '+role,async()=>{
      const rows=await seed();
      const oldAdmission=rows.get(admission(uid));
      const queued={uid,operationKey:'admissao-enfileirada',expectedGeneration:oldAdmission.generation,
        expiresAt:oldAdmission.expiresAt.toISOString()};
      await revoke(uid,queued.expectedGeneration);
      const staleRequest=await admin('admit',queued);
      assert.equal(staleRequest.status,409,'A revogação deve invalidar a intenção enfileirada antes dela');
      assert.deepEqual(await staleRequest.json(),{error:'stale_admission_generation'});
      assert.equal((await database.doc(admission(uid)).get()).data().status,'revoked');
    });

    await t.test('HTTP administrativo — restauração 18+ do '+role+' e nova concessão',async sub=>{
      const rows=await seed();
      const fixture=useExternalFixtures(sub);
      const oldAdmission=rows.get(admission(uid));
      await assertNotice(fixture);
      await revoke(uid,oldAdmission.generation);
      const revoked=(await database.doc(admission(uid)).get()).data();
      assert.equal(revoked.status,'revoked');

      const proofPath=age(uid);
      await put([[proofPath,null]]);
      await assertFails(getDocFromServer(doc(session(uid),event)));
      await put([[proofPath,rows.get(proofPath)]]); // Operação privilegiada somente no Emulator.
      for (const account of [sender,recipient]) {
        const manual=await getDocFromServer(doc(session(account),event));
        assert.equal(manual.get('text'),rows.get(event).text);
      }
      await assertNotice(fixture,404);
      assert.equal((await worker.fetch(request(),fixture.env)).status,202);
      assert.equal(fixture.stats().reserved,0);
      assert.equal(fixture.stats().sent,0);

      const readmission=await admin('admit',{uid,operationKey:'readmissao-integrada',
        expectedGeneration:revoked.generation,expiresAt:oldAdmission.expiresAt.toISOString()});
      assert.equal(readmission.status,200);
      const {generation}=await readmission.json();
      assert.notEqual(generation,oldAdmission.generation);
      const publish={senderUid:sender,recipientUid:recipient,conversationId:pilot.conversationId,
        messageId:pilot.messageId,expiresAt:rows.get(pending).expiresAt.toISOString(),
        expectedSenderGeneration:uid===sender ? generation : rows.get(admission(sender)).generation,
        expectedRecipientGeneration:uid===recipient ? generation : rows.get(admission(recipient)).generation};
      assert.equal((await admin('publish',publish,publisher)).status,403);
      await assertNotice(fixture,404);

      await delay(5);
      const newId='mensagem-integrada-apos-restauracao';
      const batch=database.batch();
      batch.update(database.doc(room),{lastMessageId:newId,updatedAt:FieldValue.serverTimestamp()});
      batch.set(database.doc(room+'/messages/'+newId),{...rows.get(event),createdAt:FieldValue.serverTimestamp()});
      await batch.commit();
      assert.equal((await admin('publish',{...publish,messageId:newId},publisher)).status,200);
      await assertNotice(fixture,200,newId);
      assert.equal((await worker.fetch(request(pilot.projectId,newId),fixture.env)).status,202);
      assert.equal(fixture.stats().reserved,1);
      assert.equal(fixture.stats().sent,1);
    });
  }

  await t.test('flag de push desligada não autoriza solicitação ao backend',async sub=>{
    const fixture=useExternalFixtures(sub);
    fixture.env.PUSH_ENABLED='false';
    const response=await worker.fetch(request(),fixture.env);
    assert.equal(response.status,503);
    assert.equal((await response.json()).status,'disabled');
    const notice=await worker.fetch(requestNotice(),fixture.env);
    assert.equal(notice.status,503);
    assert.equal((await notice.json()).status,'disabled');
    for (const action of ['admit','revoke','publish']) {
      const administrative=new Request('https://qa.invalid/v1/qa/conversations/push/admin/'+action,
        {method:'POST'});
      assert.equal((await worker.fetch(administrative,fixture.env)).status,404);
    }
    assert.deepEqual(fixture.stats(),{reserved:0,sent:0,reads:0,cloudCalls:0});
  });

  await t.test('Rules impedem recriação de admissão e listagem de chats',async()=>{
    await seed(rows=>rows.delete(admission(recipient)));
    const owner=session();
    await assertFails(setDoc(doc(owner,admission(recipient)),{
      ...createConversationPushAdmission(recipient,new Date(),new Date(Date.now()+60_000)),
    }));
    await assertFails(setDoc(doc(owner,pending),{unread:true},{merge:true}));
    await assertFails(getDocsFromServer(query(collection(owner,'chats'),
      where('participants','array-contains',recipient),limit(10))));
  });

  await t.test('identidade externa e projeto divergem antes de D1 de entrega',async sub=>{
    await seed();
    await assertFails(getDocFromServer(doc(session('externo'),pending)));
    const fixture=useExternalFixtures(sub,{changeAuth(accounts){
      accounts[sender]={localId:'externo',email:'outside@qa.invalid',emailVerified:true};
    }});
    assert.equal((await worker.fetch(request(wrongProject),fixture.env)).status,401);
    assert.equal(fixture.network.mock.callCount(),0);
    assert.equal((await worker.fetch(request(),fixture.env)).status,401);
    assert.deepEqual(fixture.stats(),{reserved:0,sent:0,reads:0,cloudCalls:1});
  });

  for (const [label,uid] of [['autor',sender],['destinatário',recipient]]) {
    for (const [change,patch] of [
      ['mudança de e-mail',{email:'changed@qa.invalid'}],
      ['perda de verificação',{emailVerified:false}],
      ['desativação',{disabled:true}],
    ]) {
      await t.test(label+' — '+change+' com sessão anterior e admissão vigente',async sub=>{
        await seed();
        const fixture=useExternalFixtures(sub);
        await assertNotice(fixture);
        Object.assign(fixture.accounts[uid],patch);
        await assertFails(getDocFromServer(doc(session(),pending)));
        await assertNotice(fixture,uid===recipient ? 401 : 404);
        assert.equal((await worker.fetch(request(),fixture.env)).status,uid===sender ? 401 : 202);
        assert.equal(fixture.stats().reserved,0);
        assert.equal(fixture.stats().sent,0);
      });
    }
  }

  await t.test('aviso privado do titular; mensagem manual independe da admissão push',async sub=>{
    await seed();
    const fixture=useExternalFixtures(sub);
    assert.equal((await worker.fetch(requestNotice(pilot.projectId,sender),fixture.env)).status,404);
    assert.equal((await worker.fetch(requestNotice(wrongProject),fixture.env)).status,401);
    assert.equal((await worker.fetch(requestNotice(pilot.projectId,recipient,'?uid='+sender),
      fixture.env)).status,404);
    await env.withSecurityRulesDisabled(async context=>{
      await deleteDoc(doc(context.firestore(),admission(recipient)));
    });
    await assertNotice(fixture,404);
    for (const uid of [sender,recipient]) {
      const message=await getDocFromServer(doc(session(uid),event));
      assert.equal(message.get('text'),'Mensagem fictícia do teste 08–09');
    }
  });

  await t.test('revogação na reserva D1 barra a primeira tentativa',async sub=>{
    await seed();
    const fixture=useExternalFixtures(sub,{afterReservation:async()=>{
      await env.withSecurityRulesDisabled(async context=>{
        await deleteDoc(doc(context.firestore(),admission(recipient)));
      });
    }});
    const response=await worker.fetch(request(),fixture.env);
    assert.equal(response.status,503);
    assert.equal((await response.json()).status,'authorization_interrupted');
    assert.equal(fixture.stats().reserved,1);
    assert.equal(fixture.stats().sent,0);
  });

  await t.test('restaurar 18+ durante a reserva D1 não libera a entrega antiga',async sub=>{
    const rows=await seed();
    const proofPath=age(recipient);
    const proof=rows.get(proofPath);
    const fixture=useExternalFixtures(sub,{afterReservation:async()=>{
      await put([[proofPath,{...proof,status:'revoked'}]]);
      await put([[proofPath,proof]]);
    }});
    const response=await worker.fetch(request(),fixture.env);
    assert.equal(response.status,503);
    assert.equal((await response.json()).status,'authorization_interrupted');
    assert.equal(fixture.stats().reserved,1);
    assert.equal(fixture.stats().sent,0);
    await assertNotice(fixture,404);
    assert.equal((await getDocFromServer(doc(session(),event))).get('text'),rows.get(event).text);
  });
});
