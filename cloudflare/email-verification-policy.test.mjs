import test from 'node:test';
import assert from 'node:assert/strict';
import {emailAllowsCommunity,EMAIL_VERIFICATION_POLICY_URL} from './email-verification-policy.mjs';

const token='t'.repeat(150);
const policy=(enabled,version='2026-11-v1')=>Response.json({
  name:'projects/atrio-catolico/databases/(default)/documents/app_config/email_verification',
  fields:{
    enabled:{booleanValue:enabled},
    version:{stringValue:version}
  }
});

test('conta confirmada nunca depende de flag ou disponibilidade da politica',async()=>{
  let called=0;
  assert.equal(await emailAllowsCommunity(token,true,async()=>{called++;throw Error('offline');}),true);
  assert.equal(called,0);
});

test('conta nao confirmada e bloqueada por documento ativo na versao oficial',async()=>{
  let called=0;
  const actual=await emailAllowsCommunity(token,false,async(url,options)=>{
    called++;
    assert.equal(url,EMAIL_VERIFICATION_POLICY_URL);
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');
    assert.ok(options.signal);
    return policy(true);
  });
  assert.equal(actual,false);
  assert.equal(called,1);
});

test('documento ausente ou flag desligada mantem compatibilidade anterior',async()=>{
  assert.equal(await emailAllowsCommunity(token,false,async()=>new Response('',{status:404})),true);
  assert.equal(await emailAllowsCommunity(token,false,async()=>policy(false)),true);
  assert.equal(await emailAllowsCommunity(token,false,async()=>policy(true,'versao-desconhecida')),true);
});

test('nao liberar acesso se Firebase responde 401, 403, 429 ou 503',async()=>{
  for(const status of [401,403,429,503]) {
    await assert.rejects(
      emailAllowsCommunity(token,false,async()=>new Response('',{status})),
      /email_policy_unavailable/
    );
  }
});

test('falha de rede ou documento malformado falham fechado',async()=>{
  await assert.rejects(
    emailAllowsCommunity(token,false,async()=>{throw Error('offline');}),
    /email_policy_unavailable/
  );
  await assert.rejects(
    emailAllowsCommunity(token,false,async()=>Response.json({})),
    /email_policy_unavailable/
  );
  await assert.rejects(
    emailAllowsCommunity(token,false,async()=>Response.json({
      fields:{enabled:{booleanValue:'true'},version:{stringValue:'2026-11-v1'}}
    })),
    /email_policy_unavailable/
  );
  await assert.rejects(
    emailAllowsCommunity(token,false,async()=>new Response('invalid json',{status:200})),
    /email_policy_unavailable/
  );
});

test('emailVerified so aceita boolean true, jamais texto ou perfil',async()=>{
  assert.equal(await emailAllowsCommunity(token,'true',async()=>policy(true)),false);
  assert.equal(await emailAllowsCommunity(token,undefined,async()=>policy(true)),false);
});

test('token nao confiavel nao gera consulta de politica',async()=>{
  await assert.rejects(emailAllowsCommunity('',false,async()=>{throw Error('must not call');}),
    /invalid_identity/);
});
