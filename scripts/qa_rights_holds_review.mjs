#!/usr/bin/env node
/**
 * Átrio QA: solicitações de titulares e preservação legal, SOMENTE simulação.
 * Não verifica identidade, não aceita dados reais, não exporta conteúdo,
 * não altera Firestore, backups ou protocolos; nenhum prazo é escolhido.
 */
import {fileURLToPath} from 'node:url';

const SHAPE=Object.freeze([
  'requestKind','dataClass','requesterRelation','identityEvidence',
  'openReport','legalHold','appeal','childrenReviewed'
]);
export const KINDS=Object.freeze([
  'access','correction','erasure','objection','review'
]);
export const CLASSES=Object.freeze([
  'directMessages','groupMessages','directReports','groupReports',
  'groupInvites','hiddenMessages','directMetadata','groupMetadata',
  'chatAgeEligibility','groupEligibility','chatPreferences',
  'auditTrails','backups'
]);
const VALID={
  requestKind:new Set(KINDS),
  dataClass:new Set(CLASSES),
  requesterRelation:new Set(['self','other','unknown']),
  identityEvidence:new Set(['synthetically-checked','missing','unknown']),
  openReport:new Set([true,false,null]),
  legalHold:new Set([true,false,null]),
  appeal:new Set(['pending','none','unknown']),
  childrenReviewed:new Set([true,false,null])
};
function invalid(){throw TypeError('qa_rights_invalid_synthetic_fixture');}
export function auditQaRightsAndHolds(requests,config={}){
 if(!Array.isArray(requests)||requests.length>1000 ||
   !config||typeof config!=='object'||Array.isArray(config))invalid();
 const stats={
  inspected:0,access:0,correction:0,erasure:0,objection:0,review:0,
  requesterNotMatched:0,identityUnconfirmed:0,
  legalHoldOrReport:0,holdOrReportUnknown:0,
  appealPending:0,appealUnknown:0,
  childrenUnreviewed:0,childrenUnknown:0,
  backupRequests:0,reportRequests:0
 };
 for(const item of requests){
   if(!item||typeof item!=='object'||Array.isArray(item)||
     Object.keys(item).length!==SHAPE.length||
     !SHAPE.every(k=>Object.hasOwn(item,k)&&VALID[k].has(item[k])))
     invalid();
   stats.inspected++;stats[item.requestKind]++;
   if(item.requesterRelation!=='self')stats.requesterNotMatched++;
   if(item.identityEvidence!=='synthetically-checked')stats.identityUnconfirmed++;
   if(item.legalHold===true||item.openReport===true)
     stats.legalHoldOrReport++;
   else if(item.legalHold!==false||item.openReport!==false)
     stats.holdOrReportUnknown++;
   if(item.appeal==='pending')stats.appealPending++;
   if(item.appeal==='unknown')stats.appealUnknown++;
   if(item.childrenReviewed===false)stats.childrenUnreviewed++;
   if(item.childrenReviewed===null)stats.childrenUnknown++;
   if(item.dataClass==='backups')stats.backupRequests++;
   if(item.dataClass==='groupReports'||item.dataClass==='directReports')
     stats.reportRequests++;
 }
 void config; // Flags externas não atribuem revisão nem aprovação.
 return Object.freeze({
   report:'qa_issue200_rights_legal_holds_tabletop',
   environment:'OFFLINE_SYNTHETIC',
   status:'NO_GO',
   verifiedRequests:0,
   accessExportsProduced:0,
   correctionsPerformed:0,
   erasuresPerformed:0,
   backupsChanged:0,
   noticesSent:0,
   policyApproved:false,
   realIdentityVerified:false,
   deploymentAuthorized:false,
   deletionAuthorized:false,
   stats:Object.freeze(stats),
   actions:'none',
   blockers:Object.freeze([
     'NO_REAL_REQUESTER_AUTHENTICATION_OR_AUTHORIZATION',
     'NO_APPROVED_SUBJECT_RIGHTS_WORKFLOW',
     'OPEN_REPORTS_APPEALS_LEGAL_HOLDS_NEED_HUMAN_REVIEW',
     'CHILD_COLLECTIONS_AND_BACKUPS_NOT_CONFIRMED',
     'NO_RETENTION_PERIODS_OR_LEGAL_PRIVACY_APPROVAL',
     'ISSUE_200_AND_QA_DEPLOY_PENDING'
   ])
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2){
   console.error('qa_rights_no_external_input');process.exitCode=1;
 }else{
   process.stdout.write(JSON.stringify(auditQaRightsAndHolds([
    {requestKind:'erasure',dataClass:'groupMessages',
     requesterRelation:'self',identityEvidence:'unknown',openReport:true,
     legalHold:null,appeal:'pending',childrenReviewed:false},
    {requestKind:'access',dataClass:'backups',
     requesterRelation:'self',identityEvidence:'missing',openReport:null,
     legalHold:null,appeal:'unknown',childrenReviewed:null}
   ]),null,2)+'\n');
 }
}
