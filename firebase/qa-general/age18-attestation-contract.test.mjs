import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signData} from 'node:crypto';
import {QA_AGE18_ATTESTATION_AUDIENCE,QA_AGE18_ATTESTATION_POLICY,
  verifyAge18AttestationOffline} from './age18-attestation-contract.mjs';

const trusted=generateKeyPairSync('ed25519');
const attacker=generateKeyPairSync('ed25519');
const issuer='qa-synthetic-age-broker';
const uid='qa-alice';
const nonce=Buffer.alloc(24,0x25).toString('base64url');
const now=1_793_000_000;
const initial={
  iss:issuer,aud:QA_AGE18_ATTESTATION_AUDIENCE,
  sub:uid,nonce,ageAtLeast18:true,
  policyVersion:QA_AGE18_ATTESTATION_POLICY,
  jti:'synthetic-attestation-0001',
  iat:now-10,exp:now+120
};
const header={alg:'EdDSA',kid:'qa-test-key-1',typ:'JWT'};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function mint(claims=initial,head=header,key=trusted.privateKey){
  const signing=b64(head)+'.'+b64(claims);
  return signing+'.'+signData(null,Buffer.from(signing),key).toString('base64url');
}
function check(token,{expectUid=uid,expectNonce=nonce,keys={'qa-test-key-1':trusted.publicKey},
  issuerOverride=issuer,nowOverride=now,seen=new Set()}={}){
  return verifyAge18AttestationOffline({
    compactJws:token,expectedUid:expectUid,expectedNonce:expectNonce,
    trustedIssuer:issuerOverride,trustedPublicKeys:keys,
    consumedJtis:seen,nowSeconds:nowOverride
  });
}

test('atestado valido exige assinatura de chave confiavel e retorna so sinal minimizado',()=>{
  assert.deepEqual(check(mint()),{accepted:true,subjectUid:uid});
});

test('versao antiga 16+, idade 17 e tentativa de enfiar dados pessoais falham fechados',()=>{
  for(const claims of [
    {...initial,policyVersion:'2026-11-16plus-qa-v1'},
    {...initial,ageAtLeast18:false},
    {...initial,dateOfBirth:'2008-11-10'},
    {...initial,cpf:'12345678901'},
    {...initial,ageAtLeast18:'true'},
    {...initial,exp:now-1},
    {...initial,iat:now+90},
    {...initial,exp:now+600},
    {...initial,sub:'qa-bob'},
    {...initial,nonce:'another-server-challenge'},
    {...initial,iss:'untrusted-broker'},
    {...initial,aud:'arbitrary-app'},
    {...initial,jti:'short'},
  ]) assert.equal(check(mint(claims)),null);
});

test('recusa assinatura adulterada, chave de fraudador, algoritmo none e cabecalhos extras',()=>{
  assert.equal(check(mint(initial,header,attacker.privateKey)),null);
  assert.equal(check(mint(initial,{...header,alg:'none'})),null);
  assert.equal(check(mint(initial,{...header,jku:'https://attacker.invalid/key'})),null);
  assert.equal(check(mint(initial,{...header,kid:'unknown'})),null);
  assert.equal(check(mint(),{keys:{}}),null);
  const token=mint();
  const segs=token.split('.');
  segs[1]=b64({...initial,ageAtLeast18:false});
  assert.equal(check(segs.join('.')),null);
  assert.equal(check('not-a-token'),null);
  assert.equal(check(''),null);
});

test('compara UID autenticado e nonce criado pelo servidor; nao aceita replay na fixture',()=>{
  assert.equal(check(mint(),{expectUid:'qa-bob'}),null);
  assert.equal(check(mint(),{expectNonce:Buffer.alloc(24,1).toString('base64url')}),null);
  const seen=new Set();
  assert.deepEqual(check(mint(),{seen}),{accepted:true,subjectUid:uid});
  assert.equal(check(mint(),{seen}),null);
});

test('nonce errado e expiracao nao queimam jti; prova corrigida da mesma sessao passa',()=>{
  const seen=new Set();
  assert.equal(check(mint(),{seen,expectUid:'qa-bob'}),null);
  assert.equal(seen.size,0);
  assert.equal(check(mint(),{seen,nowOverride:now+400}),null);
  assert.equal(seen.size,0);
  assert.deepEqual(check(mint(),{seen}),{accepted:true,subjectUid:uid});
  assert.equal(seen.size,1);
});

test('sem chave/nonce/issuer de confianca no servidor, nenhuma declaracao e aceita',()=>{
  const token=mint();
  assert.equal(check(token,{keys:null}),null);
  assert.equal(check(token,{expectNonce:'invalido'}),null);
  assert.equal(check(token,{issuerOverride:'another-trusted-server'}),null);
  assert.equal(verifyAge18AttestationOffline({compactJws:token}),null);
});
