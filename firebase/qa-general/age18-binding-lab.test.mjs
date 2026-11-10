import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createAge18OfflineBindingLab} from './age18-binding-lab.mjs';
import {QA_AGE18_ATTESTATION_AUDIENCE,
  QA_AGE18_ATTESTATION_POLICY} from './age18-attestation-contract.mjs';

const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const {privateKey:attackerPrivate,publicKey:attackerPublic}=generateKeyPairSync('ed25519');
const issuer='qa-offline-simulated-issuer';
const time=1_793_000_000;
const tokenA='test-session-token-alice-0001';
const tokenB='test-session-token-bob-00002';
const tokenA2='test-session-token-alice-0002';
const uidA='qa-alice';
const sessionDb=new Map([
  [tokenA,{uid:uidA,sessionId:'server-auth-session-0001'}],
  [tokenA2,{uid:uidA,sessionId:'server-auth-session-0002'}],
  [tokenB,{uid:'qa-bob',sessionId:'server-auth-session-0003'}]
]);
let next=1;
const mk=()=>createAge18OfflineBindingLab({
  resolveSession:token=>sessionDb.get(token),
  trustedIssuer:issuer,trustedPublicKeys:{qa:publicKey},
  makeNonce:()=>Buffer.alloc(24,next++).toString('base64url')
});
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const attest=(nonce,{
  uid=uidA,jti='unique-attestation-0001',ageAtLeast18=true,
  policyVersion=QA_AGE18_ATTESTATION_POLICY,exp=time+90,
  privateSigningKey=privateKey,extra={}
}={})=>{
  const header={alg:'EdDSA',typ:'JWT',kid:'qa'};
  const body={iss:issuer,aud:QA_AGE18_ATTESTATION_AUDIENCE,
    sub:uid,nonce,iat:time-2,exp,jti,policyVersion,ageAtLeast18,...extra};
  const payload=encode(header)+'.'+encode(body);
  return payload+'.'+sign(null,Buffer.from(payload),privateSigningKey)
    .toString('base64url');
};
const finish=(lab,session,nonce,jws,clock=time)=>
  lab.complete({authenticatedSessionToken:session,challengeNonce:nonce,
    compactJws:jws,nowSeconds:clock});

test('emissao exige sessao existente no backend sintetico, nao declaracao cliente',()=>{
  const lab=mk();
  assert.equal(lab.begin({authenticatedSessionToken:'invalid',nowSeconds:time}),null);
  assert.equal(lab.begin({nowSeconds:time}),null);
  assert.equal(lab.begin({authenticatedSessionToken:tokenA,nowSeconds:NaN}),null);
  const c=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time});
  assert.equal(typeof c.challengeNonce,'string');
  assert.equal(c.expiresAt,time+120);
  assert.equal(c.challengeNonce.length,32);
});

test('conta e sessao sao vinculadas; conta diferente e nova sessao nao herdam o desafio',()=>{
  const lab=mk();
  const c=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time});
  const jws=attest(c.challengeNonce);
  assert.equal(finish(lab,tokenB,c.challengeNonce,jws),null);
  assert.equal(finish(lab,tokenA2,c.challengeNonce,jws),null);
  assert.deepEqual(finish(lab,tokenA,c.challengeNonce,jws),{
    simulatedOnly:true,subjectUid:uidA,minimumAge:18,
    policyVersion:QA_AGE18_ATTESTATION_POLICY
  });
  assert.equal(finish(lab,tokenA,c.challengeNonce,jws),null);
});

test('comprovante de menor, de outra conta, de versao 16+ e fraudado falha fechado',()=>{
  const lab=mk();
  const c=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time});
  for(const options of [
    {ageAtLeast18:false},
    {uid:'qa-bob'},
    {policyVersion:'2026-11-16plus-qa-v1'},
    {privateSigningKey:attackerPrivate},
    {extra:{dateOfBirth:'2008-11-10'}}
  ])assert.equal(finish(lab,tokenA,c.challengeNonce,
    attest(c.challengeNonce,options)),null);
  assert.deepEqual(finish(lab,tokenA,c.challengeNonce,
    attest(c.challengeNonce)),{
      simulatedOnly:true,subjectUid:uidA,minimumAge:18,
      policyVersion:QA_AGE18_ATTESTATION_POLICY
    });
});

test('reemitir desafio invalida anterior, e prazo impede desafio vencido',()=>{
  const lab=mk();
  const first=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time});
  const second=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time+5});
  assert.notEqual(first.challengeNonce,second.challengeNonce);
  assert.equal(finish(lab,tokenA,first.challengeNonce,attest(first.challengeNonce)),null);
  assert.equal(finish(lab,tokenA,second.challengeNonce,
    attest(second.challengeNonce),time+125),null);
  assert.equal(finish(lab,tokenA,second.challengeNonce,
    attest(second.challengeNonce),time+6),null);
});

test('JTI duplicado recusa outro desafio mesmo quando assinado novamente',()=>{
  const lab=mk();
  const c1=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time});
  assert.notEqual(finish(lab,tokenA,c1.challengeNonce,attest(c1.challengeNonce)),null);
  const c2=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time});
  assert.equal(finish(lab,tokenA,c2.challengeNonce,attest(c2.challengeNonce)),null);
  assert.notEqual(finish(lab,tokenA,c2.challengeNonce,
    attest(c2.challengeNonce,{jti:'unique-attestation-0002'})),null);
});

test('sem sessao resolvida ou emissor confiavel nao ha autorizacao',()=>{
  const lab=createAge18OfflineBindingLab({
    resolveSession:()=>{throw Error('provider-unavailable')},
    trustedIssuer:issuer,trustedPublicKeys:{qa:publicKey}
  });
  assert.equal(lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time}),null);
  assert.equal(lab.complete({authenticatedSessionToken:tokenA,
    challengeNonce:Buffer.alloc(24).toString('base64url'),
    compactJws:'x.y.z',nowSeconds:time}),null);
});

test('mock nao oferece API de escrita, deploy ou ativacao do chat',()=>{
  const lab=mk();
  assert.deepEqual(Object.keys(lab).sort(),['begin','complete']);
  assert.equal('grantChatAccess' in lab,false);
  assert.equal('writeFirestore' in lab,false);
});

test('logout revoga sessao: desafio anterior nao atravessa novo login',()=>{
  const activeSessions=new Map(sessionDb);
  const lab=createAge18OfflineBindingLab({
    resolveSession:token=>activeSessions.get(token),
    trustedIssuer:issuer,trustedPublicKeys:{qa:publicKey},
    makeNonce:()=>Buffer.alloc(24,0x39).toString('base64url')
  });
  const original=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time});
  const signed=attest(original.challengeNonce);
  activeSessions.delete(tokenA); // logout confirmado pelo resolvedor do servidor
  assert.equal(finish(lab,tokenA,original.challengeNonce,signed),null);
  assert.equal(finish(lab,tokenA2,original.challengeNonce,signed),null);
  // Mesmo UID, porém sessão de login diferente: não pode herdar desafio.
  activeSessions.set(tokenA,{uid:uidA,sessionId:'server-auth-session-7777'});
  assert.equal(finish(lab,tokenA,original.challengeNonce,signed),null);
});

test('mutar lista externa de chaves apos inicio nao troca emissor confiavel',()=>{
  const serverKeys={qa:publicKey};
  const lab=createAge18OfflineBindingLab({
    resolveSession:token=>sessionDb.get(token),
    trustedIssuer:issuer,trustedPublicKeys:serverKeys,
    makeNonce:()=>Buffer.alloc(24,0x57).toString('base64url')
  });
  serverKeys.qa=attackerPublic; // mutacao do caller nao deve alterar pins
  const c=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time});
  assert.equal(finish(lab,tokenA,c.challengeNonce,
    attest(c.challengeNonce,{privateSigningKey:attackerPrivate})),null);
  assert.notEqual(finish(lab,tokenA,c.challengeNonce,attest(c.challengeNonce)),null);
});

test('desafio consumido nao pode ser reemitido com o mesmo nonce',()=>{
  const fixed=Buffer.alloc(24,0x68).toString('base64url');
  const lab=createAge18OfflineBindingLab({
    resolveSession:token=>sessionDb.get(token),
    trustedIssuer:issuer,trustedPublicKeys:{qa:publicKey},
    makeNonce:()=>fixed
  });
  const c=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time});
  assert.notEqual(finish(lab,tokenA,c.challengeNonce,attest(c.challengeNonce)),null);
  // Um RNG quebrado nunca recicla um desafio antigo, mesmo consumido.
  assert.equal(lab.begin({authenticatedSessionToken:tokenB,nowSeconds:time+1}),null);
});

test('horario regressivo e estouro de TTL falham fechados',()=>{
  const lab=createAge18OfflineBindingLab({
    resolveSession:token=>sessionDb.get(token),
    trustedIssuer:issuer,trustedPublicKeys:{qa:publicKey},
    makeNonce:()=>Buffer.alloc(24,0x69).toString('base64url')
  });
  assert.equal(lab.begin({authenticatedSessionToken:tokenA,
    nowSeconds:Number.MAX_SAFE_INTEGER}),null);
  const c=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time+10});
  assert.equal(finish(lab,tokenA,c.challengeNonce,
    attest(c.challengeNonce),time),null);
  assert.notEqual(finish(lab,tokenA,c.challengeNonce,
    attest(c.challengeNonce),time+11),null);
});

test('reemissao com nonce invalido revoga o desafio anterior sem impedir recuperacao',()=>{
  const one=Buffer.alloc(24,0x70).toString('base64url');
  const next=Buffer.alloc(24,0x71).toString('base64url');
  const values=[one,'nonce-curto',next];
  const lab=createAge18OfflineBindingLab({
    resolveSession:token=>sessionDb.get(token),
    trustedIssuer:issuer,trustedPublicKeys:{qa:publicKey},
    makeNonce:()=>values.shift()
  });
  const first=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time});
  assert.equal(first.challengeNonce,one);
  assert.equal(lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time+1}),null);
  assert.equal(finish(lab,tokenA,first.challengeNonce,attest(one),time+2),null);
  const recovered=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time+3});
  assert.equal(recovered.challengeNonce,next);
  assert.notEqual(finish(lab,tokenA,next,attest(next),time+4),null);
});

test('colisao e excecao na fonte de nonce nunca preservam desafio antigo',()=>{
  const fixed=Buffer.alloc(24,0x72).toString('base64url');
  for(const mode of ['colisao','excecao']){
    let calls=0;
    const lab=createAge18OfflineBindingLab({
      resolveSession:token=>sessionDb.get(token),
      trustedIssuer:issuer,trustedPublicKeys:{qa:publicKey},
      makeNonce:()=>{
        calls++;
        if(mode==='excecao' && calls===2)throw Error('qa-entropy-unavailable');
        return fixed;
      }
    });
    const first=lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time});
    assert.equal(first.challengeNonce,fixed);
    assert.equal(lab.begin({authenticatedSessionToken:tokenA,nowSeconds:time+1}),null);
    assert.equal(finish(lab,tokenA,fixed,attest(fixed),time+2),null);
  }
});
