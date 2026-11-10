#!/usr/bin/env node
// Validador de MINUTA da issue #200. Nunca aprova política ou implantação.
// Fonte: JSON versionado; sem SDK, credenciais, rede, Firebase ou Cloudflare.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const DECISIONS=Object.freeze([
 'trustedAgeProof','contactConsentAndAbusePrevention',
 'reportIntakeAndTriage','moderatorAssignmentsAndAccess',
 'appealsAndEmergencyEscalation','formerMemberEvidence',
 'subjectRightsAndDeletion','retentionPolicyAndHolds',
 'privacyLegalReview','qaRolloutAuthorization',
 'productionRolloutAuthorization'
]);
export const DATA_CLASSES=Object.freeze([
 'directMessages','groupMessages','directReports','groupReports',
 'groupInvites','hiddenMessages','directMetadata','groupMetadata',
 'chatAgeEligibility','groupEligibility','chatPreferences',
 'auditTrails','backups'
]);
const keys=(v,expected)=>v!==null && typeof v==='object'
 && !Array.isArray(v)
 && Object.keys(v).length===expected.length
 && expected.every(k=>Object.hasOwn(v,k));
const isObj=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const pending=(v)=>keys(v,['status','proposal','evidenceRefs','reviewedBy'])
 && v.status==='pending' && v.proposal===null
 && Array.isArray(v.evidenceRefs) && v.evidenceRefs.length===0
 && v.reviewedBy===null;
const retentionPending=(v)=>keys(v,[
 'status','periodDays','legalBasis','preservationRule',
 'deletionProcess','reviewedBy'])
 && v.status==='pending' && v.periodDays===null && v.legalBasis===null
 && v.preservationRule===null && v.deletionProcess===null
 && v.reviewedBy===null;

/**
 * Registro só admite o estado pendente. Para registrar uma deliberação
 * futura, a equipe terá de revisar o schema e autorizar as mudanças,
 * explicitamente; não existe transição automática para "approved".
 *
 * Todo resultado é NO_GO; o boolean "draftValid" significa SOMENTE que
 * a minuta respeita o schema e não contém aprovações presumidas.
 * Retorna exclusivamente códigos e contagens, nenhum texto do registro.
 */
export function auditIssue200Draft(registry){
 const problems=[];
 if(!keys(registry,[
   'schema','issueNumber','scope','minimumChatAge','agePrecheck',
   'qaDeploymentAuthorized','productionDeploymentAuthorized',
   'decisions','retention','governance'
 ]))problems.push('ROOT_STRUCTURE_INVALID');
 if(registry?.schema!=='atrio-issue200-qa-decisions-v1' ||
    registry?.issueNumber!==200 ||
    registry?.scope!=='atrio-conversas-dm-grupos')
   problems.push('SCOPE_MISMATCH');
 if(registry?.minimumChatAge!==18 ||
    registry?.agePrecheck!=='local-only-not-proof')
   problems.push('AGE_REQUIREMENT_MISMATCH');
 if(registry?.qaDeploymentAuthorized!==false ||
    registry?.productionDeploymentAuthorized!==false)
   problems.push('UNAUTHORIZED_DEPLOY_FLAG');
 if(!isObj(registry?.decisions) ||
    !keys(registry.decisions,DECISIONS))
   problems.push('DECISION_KEYS_INVALID');
 for(const k of DECISIONS){
   if(!pending(registry?.decisions?.[k]))
     problems.push('DECISION_NOT_PENDING:'+k);
 }
 if(!isObj(registry?.retention) ||
    !keys(registry.retention,DATA_CLASSES))
   problems.push('RETENTION_CLASSES_INVALID');
 for(const k of DATA_CLASSES){
   if(!retentionPending(registry?.retention?.[k]))
     problems.push('RETENTION_NOT_PENDING:'+k);
 }
 if(!keys(registry?.governance,[
   'policyOwner','moderationLead','legalPrivacyReviewer',
   'qaApprover','productionApprover','decisionDate'
 ]) || Object.values(registry.governance||{}).some(v=>v!==null))
   problems.push('GOVERNANCE_NOT_REVIEWED');
 const result={
   report:'atrio_issue200_policy_draft_gate',
   environment:'QA_DOCUMENTATION_ONLY',
   status:'NO_GO',
   draftValid:problems.length===0,
   minimumChatAgeRequirement:18,
   ageMethodVerified:false,
   qaDeploymentAuthorized:false,
   productionDeploymentAuthorized:false,
   deletionAuthorized:false,
   pendingDecisions:DECISIONS.length,
   pendingRetentionClasses:DATA_CLASSES.length,
   verifiedApprovals:0,
   problems:Object.freeze(problems),
   blockers:Object.freeze([
     'TRUSTED_18_PLUS_PROOF_PENDING',
     'CONTACT_ABUSE_AND_MODERATION_POLICY_PENDING',
     'TRIAGE_APPEALS_EMERGENCY_AND_FORMER_MEMBER_POLICY_PENDING',
     'CLASS_SPECIFIC_RETENTION_LEGAL_HOLD_RIGHTS_PENDING',
     'RESPONSIBLE_REVIEW_PRIVACY_LEGAL_PENDING',
     'NO_EXPLICIT_QA_DEPLOY_AUTHORIZATION',
     'PRODUCTION_ROLLOUT_REQUIRES_SEPARATE_APPROVAL'
   ])
 };
 return Object.freeze(result);
}

export function formatIssue200Summary(report){
 return [
  '## Issue #200 — registro operacional do QA (minuta)',
  '',
  '**NO-GO: política e implantação não aprovadas.**',
  '- Contrato de minuta válido: '+(report.draftValid?'sim':'não'),
  '- Idade mínima definida apenas como requisito: 18 anos',
  '- Decisões operacionais pendentes: '+report.pendingDecisions,
  '- Classes de retenção sem prazo aprovado: '+report.pendingRetentionClasses,
  '- Nenhum deploy, alteração de Rules, Worker ou exclusão autorizado',
  '',
  '### Bloqueios',
  ...report.blockers.map(x=>'- '+x),
  ...(report.problems.length?['','### Falhas no contrato da minuta',
    ...report.problems.map(x=>'- '+x)]:[]),
  '',
  'CI verde = minuta consistente, NUNCA aprovação da issue #200 ou QA.',
  ''
 ].join('\n');
}

const entry=process.argv[1];
if(entry && entry===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length>1 || args.some(x=>x!=='--markdown')){
   console.error('qa_issue200_invalid_cli_arguments');
   process.exitCode=1;
 }else{
   let report;
   try{
     const source=readFileSync(
       new URL('../docs/qa-homologacao/ISSUE-200-REGISTRO-PENDENTE.json',
       import.meta.url),'utf8'
     );
     report=auditIssue200Draft(JSON.parse(source));
     if(args[0]==='--markdown')process.stdout.write(formatIssue200Summary(report));
     else process.stdout.write(JSON.stringify(report,null,2)+'\n');
     if(!report.draftValid)process.exitCode=1;
   }catch{
     // Nunca vazar texto bruto do JSON ou caminhos de secrets.
     console.error('qa_issue200_invalid_draft');
     process.exitCode=1;
   }
 }
}
