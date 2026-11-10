#!/usr/bin/env node
/**
 * Átrio Conversas - exercício exclusivamente sintético da política #200.
 * Não lê protocolos reais, não autentica moderação, não despacha alertas,
 * não executa sanções, não determina SLA nem aprova implantação.
 */
import {fileURLToPath} from 'node:url';

const FIELDS=Object.freeze([
  'surface','intake','reporterVerified','moderatorAuthorized',
  'moderatorAvailable','urgencySignal','evidenceStatus',
  'appealStatus','formerMember'
]);
const valid={
 surface:new Set(['dm','group']),
 intake:new Set(['received','missing','unknown']),
 reporterVerified:new Set([true,false,null]),
 moderatorAuthorized:new Set([true,false,null]),
 moderatorAvailable:new Set([true,false,null]),
 urgencySignal:new Set(['possible','none','unknown']),
 evidenceStatus:new Set(['preserved','missing','unknown']),
 appealStatus:new Set(['pending','none','unknown']),
 formerMember:new Set([true,false,null]),
};
const genericError=()=>{throw TypeError('qa_incident_invalid_synthetic_fixture');};

export function auditQaIncidentTabletop(cases,opts={}){
  if(!Array.isArray(cases)||cases.length>1000 ||
     !opts||typeof opts!=='object'||Array.isArray(opts))genericError();
  const stats={
    inspected:0,dm:0,group:0,unknownIntake:0,
    reporterCheckPending:0,moderatorNotAvailable:0,
    moderatorNotAuthorized:0,possibleUrgency:0,
    missingEvidence:0,unknownEvidence:0,
    pendingAppeals:0,unknownAppeals:0,
    formerMemberCases:0,unknownFormerMembership:0
  };
  for(const record of cases){
    if(!record||typeof record!=='object'||Array.isArray(record)
       ||Object.keys(record).length!==FIELDS.length
       ||!FIELDS.every(k=>Object.hasOwn(record,k)&&valid[k].has(record[k])))
      genericError();
    stats.inspected++;
    stats[record.surface]++;
    if(record.intake!=='received')stats.unknownIntake++;
    if(record.reporterVerified!==true)stats.reporterCheckPending++;
    if(record.moderatorAuthorized!==true)stats.moderatorNotAuthorized++;
    if(record.moderatorAvailable!==true)stats.moderatorNotAvailable++;
    if(record.urgencySignal!=='none')stats.possibleUrgency++;
    if(record.evidenceStatus==='missing')stats.missingEvidence++;
    if(record.evidenceStatus==='unknown')stats.unknownEvidence++;
    if(record.appealStatus==='pending')stats.pendingAppeals++;
    if(record.appealStatus==='unknown')stats.unknownAppeals++;
    if(record.formerMember===true)stats.formerMemberCases++;
    if(record.formerMember===null)stats.unknownFormerMembership++;
  }
  // opts nunca interfere com autoridade (inclusive "approved": true).
  void opts;
  return Object.freeze({
    report:'qa_issue200_incident_tabletop',
    environment:'OFFLINE_SYNTHETIC',
    status:'NO_GO',
    policyApproved:false,
    deploymentAuthorized:false,
    realTriagePerformed:0,
    realEscalationsSent:0,
    realSanctionsApplied:0,
    realCasesClosed:0,
    deletedCount:0,
    actions:'none',
    stats:Object.freeze(stats),
    blockers:Object.freeze([
      'NO_APPROVED_TRIAGE_OWNERS_OR_SLA',
      'NO_AUTHORIZED_EMERGENCY_ESCALATION_ROUTE',
      'NO_REVIEWED_APPEAL_PROCESS',
      'NO_APPROVED_FORMER_MEMBER_EVIDENCE_PROCESS',
      'NO_REAL_MODERATOR_IAM_OR_AGE_PROOF_IN_THIS_LAB',
      'ISSUE_200_AND_QA_ROLLOUT_PENDING'
    ])
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2){
    console.error('qa_incident_tabletop_no_external_input');
    process.exitCode=1;
  }else{
    const specimen=[
      {surface:'dm',intake:'received',reporterVerified:true,
       moderatorAuthorized:false,moderatorAvailable:false,
       urgencySignal:'possible',evidenceStatus:'unknown',
       appealStatus:'none',formerMember:false},
      {surface:'group',intake:'received',reporterVerified:null,
       moderatorAuthorized:null,moderatorAvailable:null,
       urgencySignal:'unknown',evidenceStatus:'preserved',
       appealStatus:'pending',formerMember:true}
    ];
    process.stdout.write(JSON.stringify(auditQaIncidentTabletop(specimen),null,2)+'\n');
  }
}
