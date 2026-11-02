/**
 * QA-only worksheet for reviewing retention of all source-inventoried data.
 * Generates a blank questionnaire, checks STRUCTURAL completeness of a filled
 * copy, but NEVER verifies legal truth, authenticates reviewers, changes
 * Cloudflare/Firebase or authorizes deleting users or a Google Play release.
 *
 * Termux:
 * node cloudflare/account-deletion-audit/src/qa-retention-worksheet.js --template
 * node cloudflare/account-deletion-audit/src/qa-retention-worksheet.js --audit /private/path.json
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {retentionReviewRegistry} from './qa-retention-source-registry.js';

const PURPOSE='atrio-retention-review-internal';
const FIELDS=Object.freeze([
  'dataPurpose','legalBasis','sensitiveDataAssessment','retentionTrigger',
  'retentionPeriod','deletionOrAnonymization','thirdPartyHandling',
  'backupAndRestoreHandling','operationalEvidenceUrl','legalReviewEvidenceUrl',
  'legalReviewer','technicalReviewer','reviewedAt'
]);
const PLACEHOLDER=/\[(?:[^\]]{1,120})\]|\b(?:todo|tbd|a confirmar|a definir|placeholder|exemplo|fict[ií]ci[oa]|n\/a)\b/i;
const NORMAL=/[\u0000-\u001f\u007f]/;
const URL_KEYS=new Set(['operationalEvidenceUrl','legalReviewEvidenceUrl']);
const PERSON_KEYS=new Set(['legalReviewer','technicalReviewer']);
const MAX_ROWS=100;
const VALID_STATE='awaiting_independent_legal_and_operational_verification';

function fail(code){throw Error('qa_retention_worksheet_'+code);}
function cleanText(x,key){
  if(typeof x!=='string'||x!==x.trim()||x.length<12||x.length>900||
      NORMAL.test(x)||PLACEHOLDER.test(x))
    return false;
  if(URL_KEYS.has(key)){
    try{
      const url=new URL(x);
      return url.protocol==='https:' && url.hostname.includes('.') &&
        !['example.com','example.org','example.net'].includes(url.hostname) &&
        !url.username&&!url.password&&!url.search&&!url.hash &&
        (!url.port||url.port==='443');
    }catch{return false;}
  }
  if(key==='reviewedAt'){
    return /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
      !Number.isNaN(Date.parse(x)) &&
      new Date(x).toISOString()===x && Date.parse(x)<=Date.now();
  }
  if(PERSON_KEYS.has(key)){
    return x.length<=120 && /^[\p{L}\p{N}_.@ -]+$/u.test(x);
  }
  return !/https?:\/\/|mailto:|password|secret|api[_ -]?key/i.test(x);
}
export function blankRetentionWorksheet(){
  const entries=retentionReviewRegistry().map(row=>({
    id:row.id,source:row.source,review:row.review,
    classification:row.classification,
    status:'pending',
    ...Object.fromEntries(FIELDS.map(key=>[key,null]))
  }));
  return {
    schema:1,purpose:PURPOSE,reviewOnly:true,
    entries
  };
}
/** Fail closed for inventory drift, missing, duplicate, foreign or extra rows.
 * A "completed" worksheet is only READY FOR EXTERNAL VALIDATION, not approved.
 */
export function auditRetentionWorksheet(input){
  const expected=blankRetentionWorksheet();
  if(!input||Object.getPrototypeOf(input)!==Object.prototype ||
     Object.keys(input).sort().join(',')!==Object.keys(expected).sort().join(',') ||
     input.schema!==1||input.purpose!==PURPOSE||input.reviewOnly!==true ||
     !Array.isArray(input.entries)||input.entries.length>MAX_ROWS)
    fail('invalid_envelope');
  const listed=new Map(expected.entries.map(x=>[x.id,x]));
  if(input.entries.length!==listed.size)fail('inventory_incomplete_or_extra');
  const found=new Set();
  let ready=0;
  const counts={pending:0,incomplete:0,awaitingIndependentReview:0};
  const columns=['id','source','review','classification','status',...FIELDS].sort().join(',');
  for(const entry of input.entries){
    if(!entry||Object.getPrototypeOf(entry)!==Object.prototype||
       Object.keys(entry).sort().join(',')!==columns)
      fail('entry_shape_invalid');
    if(typeof entry.id!=='string'||found.has(entry.id)||
       !listed.has(entry.id))fail('duplicate_or_unknown_source');
    found.add(entry.id);
    const source=listed.get(entry.id);
    if(['source','review','classification'].some(k=>entry[k]!==source[k]))
      fail('source_metadata_changed');
    if(!['pending','in_review'].includes(entry.status))
      fail('invalid_review_state');
    const filled=FIELDS.filter(k=>entry[k]!==null);
    for(const field of filled)if(!cleanText(entry[field],field))
      fail('invalid_review_field');
    if(filled.length===0&&entry.status==='pending'){
      counts.pending++;continue;
    }
    if(filled.length<FIELDS.length||entry.status!=='in_review'){
      counts.incomplete++;continue;
    }
    if(entry.legalReviewer===entry.technicalReviewer)
      fail('reviewer_separation_required');
    counts.awaitingIndependentReview++;
    ready++;
  }
  if(found.size!==listed.size)fail('inventory_missing');
  return Object.freeze({
    sources:listed.size,blank:counts.pending,
    incomplete:counts.incomplete,
    readyForIndependentReview:ready,
    awaitingIndependentReview:counts.awaitingIndependentReview,
    localEvidenceStructurallyComplete:ready===listed.size,
    independentEvidenceVerified:false,
    reviewerIdentityAuthenticated:false,
    legalRetentionApproved:false,
    productionDeletionExecutorVerified:false,
    googlePlayReleaseAuthorized:false
  });
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  try{
    if(args.length===1 && args[0]==='--template'){
      process.stdout.write(JSON.stringify(blankRetentionWorksheet(),null,2)+'\n');
    }else if(args.length===2 && args[0]==='--audit'){
      const data=JSON.parse(readFileSync(args[1],'utf8'));
      // Aggregate-only stdout: never echo private review notes or case IDs.
      process.stdout.write(JSON.stringify(auditRetentionWorksheet(data),null,2)+'\n');
    }else{
      throw Error('usage: --template OR --audit /private/path.json');
    }
  }catch(e){
    console.error('Retenção não homologada: '+e.message);
    process.exitCode=1;
  }
}
