import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createAutomaticServiceContract,AUTO_AUDIENCE} from '../../cloudflare/push-worker/scripts/qa-automatic-service-contract.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const wrong=generateKeyPairSync('rsa',{modulusLength:2048});
const kid='fixture-key',subject='123456789012345678901',email='qa-auto-fixture@atrio-catolico-qa-general.iam.gserviceaccount.com';
const jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'};
const now=1800000000;
const eventKey='a'.repeat(64);
const claims={iss:'https://accounts.google.com',aud:AUTO_AUDIENCE,sub:subject,email,email_verified:true,iat:now-10,exp:now+3590};
const header={alg:'RS256',kid,typ:'JWT'};
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function token(c=claims,h=header,k=privateKey){
 const prefix=b64(h)+'.'+b64(c);
 return 'Bearer '+prefix+'.'+sign('RSA-SHA256',Buffer.from(prefix),k).toString('base64url');
}
const make=extra=>createAutomaticServiceContract({enabled:true,subject,email,now:()=>now*1000,
 resolveKey:async id=>id===kid?jwk:null,...extra});
const call=(authorization=token(),body={eventKey},service=make())=>service.authorize({authorization,body});
test('disabled by default',async()=>assert.deepEqual(await createAutomaticServiceContract().authorize(),{status:'disabled'}));
test('invalid server identity refused',()=>assert.throws(()=>make({email:'bob.navegacao@qa.invalid'}),/invalid_service_configuration/));
test('valid signature and pinned claims',async()=>assert.deepEqual(await call(),{status:'authenticated_lab',eventKey}));
for(const [name,change] of [
 ['issuer',{iss:'https://evil.invalid'}],['audience',{aud:'https://other.invalid'}],
 ['audience array',{aud:[AUTO_AUDIENCE]}],['subject',{sub:'999999999999999999999'}],
 ['email',{email:'bob.navegacao@qa.invalid'}],['unverified',{email_verified:false}],
 ['expiry',{exp:now}],['issued in future',{iat:now+1}],['stale token',{iat:now-301,exp:now+10}],
 ['long lifetime',{exp:now+3601}],['not yet valid',{nbf:now+1}],['wrong azp',{azp:'999'}]
]){
 test(name+' refused despite valid signature',async()=>assert.deepEqual(await call(token({...claims,...change})),{status:'unauthorized'}));
}
test('wrong signature refused',async()=>assert.equal((await call(token(claims,header,wrong.privateKey))).status,'unauthorized'));
test('tampered body of signed token refused',async()=>{
 const [h,p,s]=token().slice(7).split('.');
 assert.equal((await call('Bearer '+h+'.'+b64({...claims,iat:now-5})+'.'+s)).status,'unauthorized');
});
test('unknown signing key refused',async()=>assert.equal((await call(token(claims,{...header,kid:'other'}))).status,'unauthorized'));
test('algorithm none refused',async()=>assert.equal((await call(token(claims,{...header,alg:'none'}))).status,'unauthorized'));
test('caller key URL refused',async()=>assert.equal((await call(token(claims,{...header,jku:'https://evil.invalid/keys'}))).status,'unauthorized'));
test('key resolver failure closed',async()=>assert.equal((await call(token(),{eventKey},make({resolveKey:async()=>{throw Error('unavailable')}}))).status,'unauthorized'));
test('caller cannot choose sender, recipient, token, or message',async()=>{
 for(const field of ['senderUid','recipientUid','messageId','token']){
  assert.equal((await call(token(),{eventKey,[field]:'forged'})).status,'unauthorized');
 }
});
test('malformed eventKey or bearer refused',async()=>{
 assert.equal((await call(token(),{eventKey:'../x'})).status,'unauthorized');
 assert.equal((await call('Bearer arbitrary')).status,'unauthorized');
});
