#!/usr/bin/env node
// Gate de EVIDÊNCIAS, não gate de concessão de idade ou deploy.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const REQUIRED=Object.freeze([
 'independentAge18Check','serverAuthenticatedUserBinding',
 'shortLivedSignedEvidence','issuerAndAudienceVerified',
 'nonceAndJtiSingleUse','atomicPersistentReplayProtection',
 'keyPinningAndRotation','revocationAndExpiry',
 'providerOutageFailsClosed','tamperAndCrossAccountTests',
 'noBirthdateOrIdInChat','noBiometricsStoredInChat',
 'purposeAndMinimizationReviewed','retentionAndDeletionReviewed',
 'processorsAndTransfersReviewed','legalPrivacyReview',
 'costAndQuotaApproved','accessibilityAndAppealPath',
 'incidentResponseReviewed','qaOnlyPilotAndRollbackReviewed'
]);
const rootKeys=[
 'schema','scope','projectId','minimumAge','policyVersion','state',
 'providerName','providerContractReference','reviewer','reviewDate',
 'evidence','qaDeploymentAuthorized','productionDeploymentAuthorized'
];
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exactly=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export function reviewCandidate(input){
 const problems=[],missing=[];
 if(!exactly(input,rootKeys))problems.push('REVIEW_SCHEMA_INVALID');
 if(input?.schema!=='atrio-age18-provider-review-v1' ||
    input?.scope!=='atrio-conversas-chat-and-groups'||
    input?.projectId!=='atrio-catolico-qa-geral'||
    input?.policyVersion!=='2026-11-18plus-qa-v1'||
    input?.minimumAge!==18)problems.push('QA_18_PLUS_IDENTITY_MISMATCH');
 if(input?.qaDeploymentAuthorized!==false ||
    input?.productionDeploymentAuthorized!==false)
   problems.push('UNAUTHORIZED_DEPLOY_REQUEST');
 if(input?.state!=='NOT_SELECTED' ||
    input?.providerName!==null ||
    input?.providerContractReference!==null ||
    input?.reviewer!==null||input?.reviewDate!==null)
   problems.push('PROVIDER_OR_APPROVAL_PRETENDED');
 if(!exactly(input?.evidence,REQUIRED))problems.push('EVIDENCE_SCHEMA_INVALID');
 for(const key of REQUIRED){
   const v=input?.evidence?.[key];
   if(v===null)missing.push(key);
   else if(v!==true && v!==false)problems.push('EVIDENCE_TYPE_INVALID:'+key);
   else if(v!==true)missing.push(key);
 }
 // Mesmo uma ficha falsificada com tudo true NÃO prova avaliação externa.
 const result={
  report:'atrio_age18_provider_readiness',
  status:'NO_GO',
  environment:'OFFLINE_DOCUMENTATION_ONLY',
  draftValid:problems.length===0,
  reviewState:missing.length===0?'CLAIMED_COMPLETE_NOT_VERIFIED':'INCOMPLETE',
  minimumChatAgeRequirement:18,
  identifiedPendingControls:missing,
  requiredControls:REQUIRED.length,
  evaluatedAsTrue:REQUIRED.length-missing.length,
  verifiedRealProviders:0,
  ageVerifiedUsers:0,
  legalApprovalVerified:false,
  policyApproved:false,
  qaDeploymentAuthorized:false,
  productionDeploymentAuthorized:false,
  chatAccessGranted:false,
  privacyDataExported:false,
  issues:Object.freeze(problems),
  blockers:Object.freeze([
   'PROVIDER_NOT_SELECTED_OR_CONTRACTED',
   'CLAIMS_NOT_VERIFIED_FROM_INDEPENDENT_SOURCE',
   'SERVER_AUTH_AND_ATOMIC_LEDGER_NOT_INTEGRATED',
   'LEGAL_AND_PRIVACY_REVIEW_PENDING',
   'ISSUE_200_AND_QA_ROLLOUT_AUTHORIZATION_PENDING'
  ])
 };
 return Object.freeze(result);
}
export function shortReport(r){
 return [
  '## Parecer preliminar: aferição 18+ para Átrio Conversas',
  '',
  '**NO-GO**: nenhum fornecedor escolhido ou aprovado neste registro.',
  '- Critérios técnicos, de privacidade e operação: '+r.requiredControls,
  '- Critérios ainda sem evidência: '+r.identifiedPendingControls.length,
  '- Fornecedores reais autenticados: 0',
  '- Limite para chat: 18 anos, somente requisito já decidido',
  '',
  '### Critérios sem evidência',
  ...r.identifiedPendingControls.map(x=>'- '+x),
  '',
  'A aprovação humana, a conformidade jurídica e o piloto QA dependem',
  'de autorização expressa. Esta ferramenta jamais abre o chat.',
  ''
 ].join('\n');
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
   if(process.argv.length>3||
      (process.argv.length===3 && process.argv[2]!=='--markdown'))
     throw Error('args');
   const raw=readFileSync(new URL('../docs/qa-homologacao/IDADE18-FORNECEDOR-NAO-SELECIONADO.json',import.meta.url),'utf8');
   const result=reviewCandidate(JSON.parse(raw));
   process.stdout.write(process.argv[2]==='--markdown'?shortReport(result):
     JSON.stringify(result,null,2)+'\n');
   if(!result.draftValid)process.exitCode=1;
 }catch{console.error('qa_age18_provider_review_invalid');process.exitCode=1;}
}
