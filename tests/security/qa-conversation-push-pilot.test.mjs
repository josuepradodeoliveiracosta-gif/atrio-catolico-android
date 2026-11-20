// O Worker lê documentos do mesmo Firestore Emulator que autoriza a leitura do destinatário.
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assertFails, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,deleteDoc,doc,getDocFromServer,getDocsFromServer,limit,query,setDoc,
  where,writeBatch} from 'firebase/firestore';
import {renderConversationPushPilotWorker}
  from '../../cloudflare/push-worker/scripts/conversation-push-pilot.mjs';
import {renderConversationPushPilotRules}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-rules.mjs';
import {conversationPushPilot as pilot,conversationPushPilotDocuments}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-fixtures.mjs';
import {projectId as demoProject} from '../../firebase/qa-geral-celular/pilot/fixtures.mjs';

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
const sender=pilot.senderUid;
const recipient=pilot.recipientUid;
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

function fakeToken(project) {
  const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return b64({alg:'RS256'})+'.'+
    b64({aud:project,iss:'https://securetoken.google.com/'+project})+'.fixture-signature';
}
function request(project=pilot.projectId) {
  return new Request('https://qa.invalid/event',{
    method:'POST',headers:{Authorization:'Bearer '+fakeToken(project)},
    body:JSON.stringify({type:'chat_message',chatId:pilot.conversationId,messageId:pilot.messageId}),
  });
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
      assert.equal(JSON.parse(init.body).idToken,fakeToken(pilot.projectId));
      return Response.json({users:[accounts[sender]]});
    }
    if (url.origin==='https://identitytoolkit.googleapis.com'
        && url.pathname===('/v1/projects/'+pilot.projectId+'/accounts:lookup')) {
      assert.equal(headers.get('Authorization'),'Bearer fixture-access-token');
      assert.deepEqual(JSON.parse(init.body),{localId:[sender,recipient]});
      return Response.json({users:[accounts[sender],accounts[recipient]].filter(Boolean)});
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
  return {env, network, stats:()=>({reserved,sent,reads,cloudCalls})};
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
    const rows=new Map(conversationPushPilotDocuments());
    rows.set('users/'+recipient+'/pushDevices/fixture',{
      token:'fixture-device-token-for-recipient',updatedAt:new Date(),
    });
    change(rows);
    await env.withSecurityRulesDisabled(async context=>{
      const admin=context.firestore();
      const batch=writeBatch(admin);
      for (const [path,data] of rows) batch.set(doc(admin,path),data);
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
    ['contador canônico zerado',alter(room,{unreadRecipient:0}),false],
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
      const read=getDocFromServer(doc(session(),pending));
      if (allowed) assert.equal((await read).exists(),true);
      else await assertFails(read);
      const fixture=useExternalFixtures(sub);
      const response=await worker.fetch(request(),fixture.env);
      assert.equal(response.status,202);
      const counts=fixture.stats();
      assert.equal(counts.reserved,Number(allowed),JSON.stringify(counts));
      assert.equal(counts.sent,Number(allowed),JSON.stringify(counts));
      assert.ok(counts.cloudCalls<=50);
    });
  }

  await t.test('readmissão administrativa explícita restabelece a pendência',async sub=>{
    await seed(rows=>rows.delete(admission(recipient)));
    const owner=session();
    await assertFails(getDocFromServer(doc(owner,pending)));
    await env.withSecurityRulesDisabled(async context=>{
      await setDoc(doc(context.firestore(),admission(recipient)),{
        status:'active',roundId:pilot.roundId,email:pilot.accounts[recipient],
        expiresAt:new Date(Date.now()+60_000),
      });
    });
    assert.equal((await getDocFromServer(doc(owner,pending))).exists(),true);
    const fixture=useExternalFixtures(sub);
    assert.equal((await worker.fetch(request(),fixture.env)).status,202);
    assert.equal(fixture.stats().reserved,1);
    assert.equal(fixture.stats().sent,1);
  });

  await t.test('flag de push desligada não autoriza solicitação ao backend',async sub=>{
    const fixture=useExternalFixtures(sub);
    fixture.env.PUSH_ENABLED='false';
    const response=await worker.fetch(request(),fixture.env);
    assert.equal(response.status,503);
    assert.equal((await response.json()).status,'disabled');
    assert.deepEqual(fixture.stats(),{reserved:0,sent:0,reads:0,cloudCalls:0});
  });

  await t.test('Rules impedem recriação de admissão e listagem de chats',async()=>{
    await seed(rows=>rows.delete(admission(recipient)));
    const owner=session();
    await assertFails(setDoc(doc(owner,admission(recipient)),{
      status:'active',roundId:pilot.roundId,email:pilot.accounts[recipient],
      expiresAt:new Date(Date.now()+60_000),
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

  await t.test('e-mail do destinatário precisa continuar verificado',async sub=>{
    await seed();
    await assertFails(getDocFromServer(doc(session(recipient,{email_verified:false}),pending)));
    const fixture=useExternalFixtures(sub,{changeAuth(accounts){
      accounts[recipient].emailVerified=false;
    }});
    assert.equal((await worker.fetch(request(),fixture.env)).status,202);
    assert.equal(fixture.stats().reserved,0);
    assert.equal(fixture.stats().sent,0);
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
});
