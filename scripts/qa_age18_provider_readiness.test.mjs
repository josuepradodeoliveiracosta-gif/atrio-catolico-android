import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewCandidate,REQUIRED,shortReport}
  from './qa_age18_provider_readiness.mjs';

const template=JSON.parse(readFileSync(
 new URL('../docs/qa-homologacao/IDADE18-FORNECEDOR-NAO-SELECIONADO.json',import.meta.url),'utf8'));
const copy=()=>structuredClone(template);
const check=input=>reviewCandidate(input);
const blocked=r=>{
 assert.equal(r.status,'NO_GO');
 assert.equal(r.qaDeploymentAuthorized,false);
 assert.equal(r.productionDeploymentAuthorized,false);
 assert.equal(r.chatAccessGranted,false);
 assert.equal(r.verifiedRealProviders,0);
 assert.equal(r.ageVerifiedUsers,0);
 assert.equal(r.legalApprovalVerified,false);
};
test('template não seleciona fornecedor nem define biometria',()=>{
 const r=check(copy());blocked(r);
 assert.equal(r.draftValid,true);
 assert.equal(r.reviewState,'INCOMPLETE');
 assert.equal(r.identifiedPendingControls.length,REQUIRED.length);
 assert.equal(REQUIRED.length,20);
});
test('o único mínimo aprovado é 18 anos para chat e grupos',()=>{
 const x=copy();x.minimumAge=16;const r=check(x);blocked(r);
 assert.equal(r.draftValid,false);
 assert.ok(r.issues.includes('QA_18_PLUS_IDENTITY_MISMATCH'));
});
test('não aceita troca de projeto de QA pela produção',()=>{
 const x=copy();x.projectId='atrio-catolico';
 const r=check(x);blocked(r);assert.equal(r.draftValid,false);
});
test('algoritmo de trust, replay e binding precisam de prova externa',()=>{
 const x=copy();
 for(const k of ['serverAuthenticatedUserBinding',
  'atomicPersistentReplayProtection','issuerAndAudienceVerified'])
  x.evidence[k]=false;
 const r=check(x);blocked(r);
 assert.ok(r.identifiedPendingControls.includes('atomicPersistentReplayProtection'));
});
test('um resultado biométrico não equivale a consentimento, retenção e base legal',()=>{
 const x=copy();
 x.evidence.independentAge18Check=true;
 x.evidence.legalPrivacyReview=false;
 x.evidence.retentionAndDeletionReviewed=false;
 const r=check(x);blocked(r);
 assert.equal(r.reviewState,'INCOMPLETE');
});
test('dados pessoais e metadados não autorizados não entram no modelo',()=>{
 const x=copy();x.cpf='00000000000';x.evidence.photoBase64='private';
 const r=check(x);blocked(r);assert.equal(r.draftValid,false);
 assert.ok(r.issues.includes('REVIEW_SCHEMA_INVALID'));
 assert.ok(r.issues.includes('EVIDENCE_SCHEMA_INVALID'));
 const str=JSON.stringify(r)+shortReport(r);
 assert.equal(str.includes('00000000000'),false);
 assert.equal(str.includes('private'),false);
});
test('uma proposta de fornecedor não é aprovação, mesmo com dados reais',()=>{
 const x=copy();x.providerName='SomeVendor';
 const r=check(x);blocked(r);
 assert.ok(r.issues.includes('PROVIDER_OR_APPROVAL_PRETENDED'));
});
test('falsa autorização de QA ou produção impede a validação do template',()=>{
 for(const k of ['qaDeploymentAuthorized','productionDeploymentAuthorized']){
  const x=copy();x[k]=true;
  const r=check(x);blocked(r);assert.equal(r.draftValid,false);
  assert.ok(r.issues.includes('UNAUTHORIZED_DEPLOY_REQUEST'));
 }
});
test('mesmo 20 declarações true não fazem prova autenticada nem GO',()=>{
 const x=copy();
 for(const key of REQUIRED)x.evidence[key]=true;
 const r=check(x);blocked(r);
 assert.equal(r.reviewState,'CLAIMED_COMPLETE_NOT_VERIFIED');
 assert.equal(r.identifiedPendingControls.length,0);
});
test('valor textual ou objeto de evidência é rejeitado',()=>{
 const x=copy();x.evidence.revocationAndExpiry='true';
 const r=check(x);blocked(r);assert.equal(r.draftValid,false);
 assert.ok(r.issues.includes('EVIDENCE_TYPE_INVALID:revocationAndExpiry'));
});
test('campo faltante não é interpretado como não aplicável',()=>{
 const x=copy();delete x.evidence.costAndQuotaApproved;
 const r=check(x);blocked(r);assert.equal(r.draftValid,false);
 assert.ok(r.issues.includes('EVIDENCE_SCHEMA_INVALID'));
});
test('estado de selecionado e revisor fingido são rejeitados',()=>{
 const x=copy();x.state='APPROVED';x.reviewer='unknown';
 const r=check(x);blocked(r);assert.equal(r.draftValid,false);
});
test('entrada sem estrutura deve falhar com NO-GO e problemas',()=>{
 for(const x of [null,[],{},'approved',false]){
   const r=check(x);blocked(r);
   assert.equal(r.draftValid,false);
 }
});
test('a avaliação não modifica o template',()=>{
 const x=copy(),old=JSON.stringify(x);
 const r=check(x);blocked(r);
 assert.equal(JSON.stringify(x),old);
 assert.equal(Object.isFrozen(r),true);
});
