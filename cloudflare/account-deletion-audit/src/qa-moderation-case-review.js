/**
 * PRIVATE, OFFLINE, REVIEW-ONLY preparation for per-record moderation
 * dispositions during account deletion. Consumes a separately verified
 * administrative inventory; never trusts client input for authorization.
 * This is not a deletion executor, legal approval or release gate.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validUid} from './plan.js';
import {RELATIONAL_SCOPES,EXTERNAL_SCOPES}
  from './deletion-orchestrator.js';

const ROOTS=Object.freeze([
  'reports','user_reports','guardian_cases',
  'guardian_audit','guardiao_quarantine'
]);
const ALLOWED=new Set(ROOTS);
const SEGMENT=/^[A-Za-z0-9_-]{1,160}$/;
const PURPOSE='atrio-moderation-disposition-review-private';
const LIMIT=2000;
const DECISIONS=new Set(['retain_until','propose_anonymization',
  'propose_erasure']);
const REVIEW_FIELDS=Object.freeze(['treatment','legalBasis',
  'thirdPartyImpactReviewed','retentionUntil','technicalReviewer',
  'legalReviewer','reviewedAt','evidenceUrl','implementationNotes']);
const CASE_KEYS=['path','status',...REVIEW_FIELDS].sort().join(',');
const ENVELOPE_KEYS=['schema','purpose','reviewOnly','uid',
  'inventoryDigest','cases'].sort().join(',');
const URL_DENIED=new Set(['example.com','example.org','example.net',
  'atrio-catolico-privacidade-qa.pages.dev']);
const errors=code=>{throw Error('qa_moderation_review_'+code);};

function checkedPaths(uid,inventory){
  if(!validUid(uid)||inventory?.uid!==uid ||
    inventory.pagesComplete!==true||
    !Array.isArray(inventory.documents)||
    inventory.documents.length>20000)
    errors('unverified_inventory');
  const expected=[...RELATIONAL_SCOPES,...EXTERNAL_SCOPES];
  const reported=inventory.scopesComplete;
  if(!Array.isArray(reported)||reported.length!==expected.length||
    new Set(reported).size!==expected.length||
    expected.some(scope=>!reported.includes(scope)))
    errors('incomplete_source_scope');
  const paths=[],seen=new Set();
  for(const row of inventory.documents){
    if(!row || typeof row.path!=='string')errors('bad_document_path');
    const parts=row.path.split('/');
    if(!ALLOWED.has(parts[0]))continue;
    // An ownership declaration does not prove that the case may be erased.
    // It only determines which pending legal-review docket it enters.
    if(parts.length!==2||!SEGMENT.test(parts[1])||
      row.kind!=='relational'||row.ownerUid!==uid)
      errors('unsafe_case_reference');
    if(seen.has(row.path))errors('duplicate_case_reference');
    seen.add(row.path);
    paths.push(row.path);
    if(paths.length>LIMIT)errors('too_many_moderation_cases');
  }
  return paths.sort();
}
function digest(uid,paths){
  return createHash('sha256').update(JSON.stringify({uid,paths})).digest('hex');
}
function exactKeys(value,expected){
  return !!value && Object.getPrototypeOf(value)===Object.prototype &&
    Object.keys(value).sort().join(',')===expected;
}
function clean(value,min=16,max=600){
  return typeof value==='string'&&value===value.trim()&&
    value.length>=min&&value.length<=max&&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/\b(?:todo|tbd|placeholder|a confirmar|fict[ií]ci[oa])\b/i.test(value);
}
function time(value,now){
  if(typeof value!=='string'||
     !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    return null;
  const ms=Date.parse(value);
  return Number.isFinite(ms)&&new Date(ms).toISOString()===value &&
    ms>=Date.parse('2026-01-01T00:00:00.000Z')&&ms<=now.getTime()
    ? ms:null;
}
function validEvidence(url){
  if(!clean(url,20,1000))return false;
  try{
    const u=new URL(url);
    return u.protocol==='https:'&&u.hostname.includes('.')&&
      !URL_DENIED.has(u.hostname)&&
      !u.hostname.endsWith('.test')&&!u.hostname.endsWith('.invalid')&&
      !u.username&&!u.password&&!u.search&&!u.hash&&
      (!u.port||u.port==='443');
  }catch{return false;}
}
function rowReady(row,now){
  if(!DECISIONS.has(row.treatment)||!clean(row.legalBasis,24,600)||
     row.thirdPartyImpactReviewed!==true||
     !clean(row.implementationNotes,24,600)||
     !clean(row.technicalReviewer,6,120)||
     !clean(row.legalReviewer,6,120)||
     row.technicalReviewer===row.legalReviewer||
     !time(row.reviewedAt,now)||!validEvidence(row.evidenceUrl))
    return false;
  if(row.treatment==='retain_until'){
    const v=row.retentionUntil;
    if(typeof v!=='string'||!/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)||
       !Number.isFinite(Date.parse(v))||
       new Date(Date.parse(v)).toISOString()!==v||
       Date.parse(v)<=now.getTime())return false;
  }else if(row.retentionUntil!==null)return false;
  return true;
}

/** A private worksheet; contains case paths and must never be committed. */
export function blankModerationCaseDossier(uid,inventory){
  const paths=checkedPaths(uid,inventory);
  return {
    schema:1,purpose:PURPOSE,reviewOnly:true,uid,
    inventoryDigest:digest(uid,paths),
    cases:paths.map(path=>({
      path,status:'pending',
      ...Object.fromEntries(REVIEW_FIELDS.map(k=>[k,null]))
    }))
  };
}
/** Completeness is structural only; the current reviewer is NOT verified. */
export function auditModerationCaseDossier(uid,inventory,dossier,{now=new Date()}={}){
  const expected=blankModerationCaseDossier(uid,inventory);
  if(!(now instanceof Date)||!Number.isFinite(now.getTime())||
     !exactKeys(dossier,ENVELOPE_KEYS)||
     dossier.schema!==1||dossier.purpose!==PURPOSE||
     dossier.reviewOnly!==true||dossier.uid!==uid||
     dossier.inventoryDigest!==expected.inventoryDigest||
     !Array.isArray(dossier.cases)||
     dossier.cases.length!==expected.cases.length)
    errors('dossier_drift');
  let pending=0,incomplete=0,ready=0;
  for(let i=0;i<expected.cases.length;i++){
    const row=dossier.cases[i];
    if(!exactKeys(row,CASE_KEYS)||row.path!==expected.cases[i].path)
      errors('case_mismatch_or_extra');
    if(row.status==='pending'){
      if(REVIEW_FIELDS.some(k=>row[k]!==null))
        errors('pending_case_contains_proposal');
      pending++;
    }else if(row.status==='in_review'){
      if(REVIEW_FIELDS.some(k=>row[k]!==null &&
        typeof row[k]!=='string' && k!=='thirdPartyImpactReviewed'))
        errors('invalid_case_field');
      if(rowReady(row,now))ready++;
      else incomplete++;
    }else errors('invalid_case_status');
  }
  return Object.freeze({
    moderationCases:expected.cases.length,
    pending,incomplete,readyForIndependentVerification:ready,
    structurallyComplete:ready===expected.cases.length,
    // No case path, evidence URL or user content in this safe summary.
    caseDetailsDisclosed:false,liveInventoryAuthenticated:false,
    reviewerIdentitiesAuthenticated:false,legalDecisionsApproved:false,
    crossServiceRetentionComplete:false,accountDeletionAuthorized:false,
    googlePlayReleaseAuthorized:false
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(!((args.length===2&&args[0]==='--template')||
      (args.length===3&&args[0]==='--review')))
      errors('usage');
    const raw=readFileSync(args[1],{encoding:'utf8',flag:'r'});
    if(raw.length>2_000_000)errors('large_inventory');
    const inventory=JSON.parse(raw);
    if(args[0]==='--template'){
      process.stdout.write(JSON.stringify(blankModerationCaseDossier(
        inventory.uid,inventory),null,2)+'\n');
    }else{
      const text=readFileSync(args[2],{encoding:'utf8',flag:'r'});
      if(text.length>2_000_000)errors('large_dossier');
      const result=auditModerationCaseDossier(inventory.uid,inventory,
        JSON.parse(text));
      process.stdout.write(JSON.stringify(result,null,2)+'\n');
    }
  }catch{
    console.error('Ficha privada inválida ou incompleta; nenhuma aprovação emitida.');
    process.exitCode=1;
  }
}
