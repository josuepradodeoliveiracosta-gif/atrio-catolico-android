// QA #199. Regras reais em loopback, Auth do relay simulado. Nenhum envio FCM.
import assert from 'node:assert/strict';
import test from 'node:test';
import {assertFails, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc, getDocFromServer, writeBatch} from 'firebase/firestore';
import {verifyIdentity} from '../../cloudflare/push-worker/src/index.js';
import {alice, bob, moderator, pilotDocuments, pilotFlags, projectId}
  from '../../firebase/qa-geral-celular/pilot/fixtures.mjs';
import {renderClosedPilotRules} from '../../firebase/qa-geral-celular/pilot/rules.mjs';

const emulatorHost=process.env.FIRESTORE_EMULATOR_HOST;
assert.match(emulatorHost ?? '', /^127\.0\.0\.1:[0-9]{1,5}$/,
  'Executar apenas com Firestore Emulator em loopback');
const emulatorPort=Number(emulatorHost.split(':')[1]);
const simulatedRelayProject='atrio-catolico-qa-general';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const simulatedToken=project=>encode({alg:'RS256'})+'.'+
  encode({aud:project,iss:'https://securetoken.google.com/'+project})+'.assinatura-ficticia';

test('identidade do piloto: Rules compostas e verificador existente do relay', async t=>{
  const env=await initializeTestEnvironment({
    projectId,firestore:{host:'127.0.0.1',port:emulatorPort,rules:renderClosedPilotRules()},
  });
  t.after(()=>env.cleanup());
  const room='chats/'+alice.uid+'__'+bob.uid;
  const now=new Date();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    const batch=writeBatch(db);
    const rows=new Map([...pilotDocuments(now),...pilotFlags(true)]);
    rows.set(room,{participants:[alice.uid,bob.uid],status:'accepted',
      requesterUid:alice.uid,recipientUid:bob.uid});
    rows.set(room+'/messages/fixture',{uid:alice.uid,kind:'text',
      text:'Mensagem fictícia',createdAt:now});
    for (const [path,data] of rows) batch.set(doc(db,path),data);
    await batch.commit();
  });

  const cases=[
    ['Alice verificada',alice,true,true],
    ['Bob verificado',bob,true,true],
    ['Bob sem verificação',bob,false,false],
    ['Bob com o e-mail de Alice',{...bob,email:alice.email},true,false],
    ['conta verificada fora da lista',{uid:'qa-fora',email:'qa-fora@qa.invalid'},true,false],
    ['UID de fora com e-mail de Alice',{uid:'qa-fora',email:alice.email},true,false],
    ['identidade de moderação',moderator,true,false],
  ];
  for (const [label,account,verified,allowed] of cases) {
    await t.test(label,async sub=>{
      const db=env.authenticatedContext(account.uid,{
        email:account.email,email_verified:verified,
      }).firestore();
      const result=getDocFromServer(doc(db,room+'/messages/fixture'));
      if (allowed) assert.equal((await result).exists(),true);
      else await assertFails(result);

      const token=simulatedToken(simulatedRelayProject);
      const auth=sub.mock.method(globalThis,'fetch',async (input,options)=>{
        const url=new URL(input);
        assert.equal(url.origin,'https://identitytoolkit.googleapis.com');
        assert.equal(url.pathname,'/v1/accounts:lookup');
        assert.equal(JSON.parse(options.body).idToken,token);
        return Response.json({users:[{
          localId:account.uid,email:account.email,emailVerified:verified,
        }]});
      });
      const request=new Request('https://qa.invalid/event',{
        headers:{Authorization:'Bearer '+token},
      });
      const uid=await verifyIdentity(request,{FIREBASE_WEB_API_KEY:'chave-ficticia'},
        simulatedRelayProject);
      assert.equal(uid,allowed?account.uid:null);
      assert.equal(auth.mock.callCount(),1);
    });
  }
  await t.test('token de outro projeto é recusado no Worker antes da consulta',async sub=>{
    const noNetwork=sub.mock.method(globalThis,'fetch',()=>assert.fail('rede inesperada'));
    const request=new Request('https://qa.invalid/event',{
      headers:{Authorization:'Bearer '+simulatedToken('atrio-catolico-qa-geral')},
    });
    assert.equal(await verifyIdentity(request,{},simulatedRelayProject),null);
    assert.equal(noNetwork.mock.callCount(),0);
  });
});
