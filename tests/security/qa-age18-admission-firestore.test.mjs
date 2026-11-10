// INTEGRAÇÃO EXCLUSIVAMENTE NO FIREBASE EMULATOR (demo-atrio-v11).
// Não autentica Firebase real, não envia nascimento nem cria atestado real.
// A escrita administrativa usa withSecurityRulesDisabled APENAS no emulador.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,setDoc,serverTimestamp,Timestamp}
  from 'firebase/firestore';
import {createAge18OfflineBindingLab}
  from '../../firebase/qa-general/age18-binding-lab.mjs';
import {QA_AGE18_ATTESTATION_AUDIENCE,QA_AGE18_ATTESTATION_POLICY}
  from '../../firebase/qa-general/age18-attestation-contract.mjs';

const rules=readFileSync('qa-general.generated.rules','utf8');
if(!rules.includes('qaChatAge18Eligible') ||
   !rules.includes('match /users/{uid}/chatAgeEligibility/current')) {
  throw Error('qa_only_rules_required');
}
const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules}
});
const uid='qa-synthetic-verified';
const sessionToken='qa-session-token-verified-0001';
const sessionId='qa-server-session-0001';
const current=1_793_000_000;
const issuer='qa-synthetic-admission-broker';
const agePath='users/'+uid+'/chatAgeEligibility/current';
const privacyPath='users/'+uid+'/chatSettings/privacy';
const limitsPath='users/'+uid+'/chatLimits/requests';
const signedIn=env.authenticatedContext(uid,{email_verified:true}).firestore();
const signedOutEmail=env.authenticatedContext(uid,{email_verified:false}).firestore();
const unrelatedAccount=env.authenticatedContext('qa-unrelated',{email_verified:true}).firestore();
const visitor=env.unauthenticatedContext().firestore();
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const fixture={
  status:'eligible',minimumAge:18,
  policyVersion:'2026-11-18plus-qa-v1',
  reviewExpiresAt:Timestamp.fromDate(new Date('2035-01-01T00:00:00.000Z'))
};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const issueSignedClaim=(nonce,ageAtLeast18)=>{
  const header={alg:'EdDSA',kid:'qa-only-key',typ:'JWT'};
  const body={
    iss:issuer,aud:QA_AGE18_ATTESTATION_AUDIENCE,sub:uid,
    nonce,ageAtLeast18,policyVersion:QA_AGE18_ATTESTATION_POLICY,
    jti:'qa-synthetic-jti-0000001',iat:current-5,exp:current+90
  };
  const data=b64(header)+'.'+b64(body);
  return data+'.'+sign(null,Buffer.from(data),privateKey).toString('base64url');
};
const privateSettings={
  requests:'all',readReceipts:false,showPushPreview:false,
  updatedAt:serverTimestamp()
};

try {
  await env.clearFirestore();
  // A política administrativamente aprovada é uma fixture, NÃO aprovação real.
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'app_config/conversations'),{
      enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
      safetyReviewVersion:'2026-11-safety-v1'
    });
  });
  // Nenhum caminho do cliente pode criar a própria prova ou acessar chat.
  await assertFails(getDoc(doc(signedIn,limitsPath)));
  await assertFails(setDoc(doc(signedIn,privacyPath),privateSettings));
  await assertFails(setDoc(doc(signedIn,agePath),fixture));
  const lab=createAge18OfflineBindingLab({
    resolveSession:token=>token===sessionToken
      ?{uid,sessionId}:null,
    trustedIssuer:issuer,
    trustedPublicKeys:{'qa-only-key':publicKey},
    makeNonce:()=>Buffer.alloc(24,0x55).toString('base64url')
  });
  const challenge=lab.begin({
    authenticatedSessionToken:sessionToken,nowSeconds:current
  });
  assert.ok(challenge?.challengeNonce);
  assert.equal(lab.complete({
    authenticatedSessionToken:sessionToken,
    challengeNonce:challenge.challengeNonce,
    compactJws:issueSignedClaim(challenge.challengeNonce,false),
    nowSeconds:current
  }),null);
  await assertFails(getDoc(doc(signedIn,limitsPath)));
  // Somente após a verificação sintética: simula um backend PRIVILEGIADO
  // escrevendo uma fixture mínima no emulador. O lab NUNCA escreve Firestore.
  const accepted=lab.complete({
    authenticatedSessionToken:sessionToken,
    challengeNonce:challenge.challengeNonce,
    compactJws:issueSignedClaim(challenge.challengeNonce,true),
    nowSeconds:current
  });
  assert.deepEqual(accepted,{
    simulatedOnly:true,subjectUid:uid,minimumAge:18,
    policyVersion:QA_AGE18_ATTESTATION_POLICY
  });
  await assertFails(getDoc(doc(signedIn,limitsPath)));
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),agePath),{
      status:'eligible',minimumAge:accepted.minimumAge,
      policyVersion:accepted.policyVersion,
      reviewExpiresAt:fixture.reviewExpiresAt
    });
  });
  // Sigilo do atestado: o titular só consulta o seu documento;
  // nenhum cliente pode listar registros ou ler o de outra conta.
  await assertSucceeds(getDoc(doc(signedIn,agePath)));
  await assertFails(getDoc(doc(unrelatedAccount,agePath)));
  await assertFails(getDoc(doc(visitor,agePath)));
  await assertFails(getDocs(collection(signedIn,'users/'+uid+'/chatAgeEligibility')));
  await assertFails(getDocs(collection(unrelatedAccount,'users/'+uid+'/chatAgeEligibility')));
  await assertFails(setDoc(doc(unrelatedAccount,agePath),fixture));
  await assertSucceeds(getDoc(doc(signedIn,limitsPath)));
  await assertSucceeds(setDoc(doc(signedIn,privacyPath),privateSettings));
  await assertFails(getDoc(doc(signedOutEmail,limitsPath)));
  // Contrato mínimo: metadados extras ou campos ausentes fecham o chat.
  // O bypass administrativo é APENAS do Firebase Emulator.
  const {reviewExpiresAt:discardedExpiry, ...withoutExpiry}=fixture;
  const malformedProofs=[
    {...fixture,dateOfBirth:'2000-01-01'},
    {...fixture,cpf:'000.000.000-00'},
    {...fixture,verificationProvider:'unapproved-test-provider'},
    withoutExpiry,
    {...fixture,minimumAge:'18'},
    {...fixture,reviewExpiresAt:'2035-01-01'}
  ];
  for(const malformed of malformedProofs){
    await env.withSecurityRulesDisabled(async ctx=>{
      await setDoc(doc(ctx.firestore(),agePath),malformed);
    });
    await assertFails(getDoc(doc(signedIn,limitsPath)));
    await assertFails(setDoc(doc(signedIn,privacyPath),privateSettings));
  }
  // Mesmo cenário volta a passar quando a fixture exata é restaurada.
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),agePath),fixture);
  });
  await assertSucceeds(getDoc(doc(signedIn,limitsPath)));
  // Um cliente nem mesmo elegível pode renovar ou reativar sua prova.
  await assertFails(setDoc(doc(signedIn,agePath),fixture));
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),agePath),{...fixture,status:'revoked'});
  });
  await assertFails(getDoc(doc(signedIn,limitsPath)));
  await assertFails(setDoc(doc(signedIn,privacyPath),privateSettings));
  // Versão da política anterior permanece inválida mesmo com status eligible.
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),agePath),{
      ...fixture,policyVersion:'2026-11-16plus-qa-v1'
    });
  });
  await assertFails(getDoc(doc(signedIn,limitsPath)));
  console.log('QA offline: atestado ficticio -> fixture privilegiada -> revogacao testados no Emulator.');
} finally {
  await env.cleanup();
}
