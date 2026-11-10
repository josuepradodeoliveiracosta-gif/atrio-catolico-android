#!/usr/bin/env node
/**
 * Inventário SINTÉTICO de retenção para QA. Sem acesso ao Firebase,
 * Cloudflare, arquivos de usuários, credenciais, rede ou qualquer exclusão.
 * Não determina prazos nem autoriza política, backup ou deploy.
 */
import {fileURLToPath} from 'node:url';

export const QA_RETENTION_CLASSES=Object.freeze([
  'directMessages',
  'groupMessages',
  'directReports',
  'groupReports',
  'groupInvites',
  'hiddenMessages',
  'directMetadata',
  'groupMetadata',
  'chatAgeEligibility',
  'groupEligibility',
  'chatPreferences',
  'auditTrails',
  'backups'
]);

const isObject=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const fail=()=>{throw TypeError('qa_retention_invalid_fixture');};

/**
 * Classificação para APENAS triagem fictícia de risco. Todos os estados
 * (inclusive reviewOnly) permanecem NO-GO. Uma declaração de ausência
 * de denúncias ou hold fornecida pelo caller NÃO é uma prova verificada.
 */
function classify(record){
  if(!isObject(record))return 'unknown';
  if(record.legalHold===true || record.openReports===true ||
     record.appealPending===true)return 'held';
  if(record.parentMissing===true || record.unreviewedChildren===true)
    return 'orphanRisk';
  if(record.legalHold!==false || record.openReports!==false ||
     record.appealPending!==false || record.parentMissing!==false ||
     record.unreviewedChildren!==false)return 'unknown';
  return 'reviewOnly';
}

export function auditQaRetentionFixtures(inventory,{policy}={}){
  if(!isObject(inventory))fail();
  const allowed=new Set(QA_RETENTION_CLASSES);
  if(Object.keys(inventory).some(k=>!allowed.has(k)))fail();
  const missingClasses=[];
  const classes={};
  const totals={inspected:0,held:0,orphanRisk:0,unknown:0,reviewOnly:0};
  for(const name of QA_RETENTION_CLASSES){
    const list=inventory[name];
    if(list===undefined){
      missingClasses.push(name);
      classes[name]=Object.freeze({present:false,inspected:0,
        held:0,orphanRisk:0,unknown:0,reviewOnly:0});
      continue;
    }
    if(!Array.isArray(list) || list.length>10000)fail();
    const summary={present:true,inspected:list.length,
      held:0,orphanRisk:0,unknown:0,reviewOnly:0};
    for(const fixture of list){
      const kind=classify(fixture);
      summary[kind]++;
      totals[kind]++;
      totals.inspected++;
    }
    classes[name]=Object.freeze(summary);
  }
  // A aprovação de uma política não é inferível de flags recebidas.
  // A propriedade policy é aceita apenas para exercitar testes adversariais.
  void policy;
  return Object.freeze({
    reportType:'qa_retention_synthetic_inventory',
    environment:'QA_OFFLINE_NO_DEPLOY',
    status:'NO_GO',
    completedMilestones:2,
    totalMilestones:7,
    policyApproved:false,
    deletionAuthorized:false,
    deletedCount:0,
    deletionCandidateCount:0,
    action:'none',
    // Agregados e NOMES DE CLASSES, jamais IDs, textos ou documentos.
    missingClasses:Object.freeze(missingClasses),
    classes:Object.freeze(classes),
    totals:Object.freeze(totals),
    limitations:Object.freeze([
      'synthetic_fixtures_not_authentic_evidence',
      'no_collection_specific_retention_periods_approved',
      'open_reports_legal_holds_appeals_and_subcollections_require_review',
      'issue_200_policy_and_qa_deploy_authorization_pending'
    ])
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2){
    console.error('qa_retention_no_external_input');
    process.exitCode=1;
  }else{
    const inventory=Object.fromEntries(
      QA_RETENTION_CLASSES.map(name=>[name,[]])
    );
    // Exemplos puramente sintéticos, sem identificadores ou textos reais.
    inventory.groupMessages=[
      {legalHold:true,openReports:false,appealPending:false,
       parentMissing:false,unreviewedChildren:false},
      {legalHold:false,openReports:false,appealPending:false,
       parentMissing:true,unreviewedChildren:true},
      {legalHold:false,openReports:false,appealPending:false,
       parentMissing:false,unreviewedChildren:false}
    ];
    inventory.groupReports=[
      {legalHold:false,openReports:true,appealPending:false,
       parentMissing:false,unreviewedChildren:false}
    ];
    process.stdout.write(JSON.stringify(auditQaRetentionFixtures(inventory),null,2)+'\n');
  }
}
