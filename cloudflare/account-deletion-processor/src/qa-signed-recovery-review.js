/**
 * LOCAL QA-ONLY Ed25519 reviewer verification with durable single-use
 * receipts. No signing private key, provider credential or network code.
 * Signing key custody and production IAM are NOT proved by these fixtures.
 */
import {createPublicKey,createHash,verify as verifySignature} from 'node:crypto';
import {CONTROLLED_DELETION_PHASES} from './controlled-executor.js';
import {createQaPersistentDeletionLedger} from './qa-persistent-case-ledger.js';

export const QA_SIGNED_REVIEW_TABLE='qa_signed_reviewer_receipts';
export const QA_SIGNED_REVIEW_COLUMNS=
  'nonce,uid,case_id,epoch,purpose,phase,created_ms';
const PROJECT='demo-atrio-v11';
const REVIEWER='qa-independent-reviewer-01';
const UID=new Set(['qa-delete-alice','qa-delete-candidate',
  'qa-delete-neighbor','qa-delete-observer']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const B64=/^[A-Za-z0-9_-]{86}$/;
const RETRIES=new Set(['freeze_writes','purge_firestore',
  'purge_media_and_d1','revoke_fcm','delete_auth_last']);
const DDL=[
  'CREATE TABLE IF NOT EXISTS qa_signed_reviewer_receipts (',
  'nonce TEXT PRIMARY KEY NOT NULL,uid TEXT NOT NULL,case_id TEXT NOT NULL,',
  'epoch INTEGER NOT NULL CHECK(epoch>=1),',
  "purpose TEXT NOT NULL CHECK(purpose IN ('case_resume','phase_retry')),",
  'phase TEXT NOT NULL,created_ms INTEGER NOT NULL CHECK(created_ms>0),',
  'UNIQUE(uid,case_id,epoch,purpose,phase)) STRICT'
].join(' ');
const deny=()=>{throw Error('qa_signed_reviewer_denied')};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const digest=text=>createHash('sha256').update(text,'utf8').digest('hex');
const serialized=d=>JSON.stringify([
  'atrio-qa-signed-review-v1',d.purpose,d.projectId,d.reviewer,
  d.uid,d.caseId,d.epoch,d.phase,d.nonce,d.issuedMs,d.expiresMs,
  d.checkpointSha256
]);
function checkDocument(doc){
  const keys='caseId,checkpointSha256,epoch,expiresMs,issuedMs,nonce,phase,projectId,purpose,reviewer,uid';
  if(!plain(doc)||Object.keys(doc).sort().join(',')!==keys||
     doc.projectId!==PROJECT||doc.reviewer!==REVIEWER||
     !UID.has(doc.uid)||!UUID.test(doc.caseId)||
     !Number.isSafeInteger(doc.epoch)||doc.epoch<1||
     (doc.purpose==='case_resume'&&doc.phase!=='case_resume')||
     (doc.purpose==='phase_retry'&&(!RETRIES.has(doc.phase)||doc.epoch<2))||
     !['case_resume','phase_retry'].includes(doc.purpose)||
     !UUID.test(doc.nonce)||!SHA.test(doc.checkpointSha256)||
     !Number.isSafeInteger(doc.issuedMs)||!Number.isSafeInteger(doc.expiresMs)||
     doc.issuedMs<=0||doc.expiresMs<=doc.issuedMs||
     doc.expiresMs-doc.issuedMs>300000)deny();
}
export function createQaSignedReviewAuthority({
  projectId,db,reviewerPublicKey,now=Date.now
}={}){
  if(projectId!==PROJECT||typeof now!=='function'||
     typeof reviewerPublicKey!=='string'||reviewerPublicKey.length>2000)
    deny();
  let publicKey;
  try{
    publicKey=createPublicKey(reviewerPublicKey);
    if(publicKey.asymmetricKeyType!=='ed25519')deny();
  }catch{deny();}
  // Reuse the journal's strict private-directory, schema and mode guards.
  const checkDatabase=()=>createQaPersistentDeletionLedger({projectId,db});
  checkDatabase();
  db.exec(DDL);
  checkDatabase();
  function consume(doc,signature,ctx){
    if(!plain(ctx)||!plain(doc)||typeof signature!=='string'||
       !B64.test(signature))deny();
    checkDocument(doc);
    if(doc.uid!==ctx.uid||doc.caseId!==ctx.caseId||
       doc.epoch!==ctx.epoch||doc.phase!==ctx.phase||
       doc.purpose!==ctx.purpose)deny();
    const at=now();
    if(!Number.isSafeInteger(at)||at<doc.issuedMs-30000||
       at>=doc.expiresMs)deny();
    const bytes=Buffer.from(signature,'base64url');
    if(bytes.length!==64||bytes.toString('base64url')!==signature)deny();
    if(!verifySignature(null,Buffer.from(serialized(doc),'utf8'),
      publicKey,bytes))deny();
    // Readiness is re-evaluated before each grant, including filesystem
    // permissions, known schema and the exact private QA database path.
    checkDatabase();
    // Consume before any effect in one transaction; a crash cannot replay it.
    db.exec('BEGIN IMMEDIATE');
    try{
      const row=db.prepare(
        'SELECT case_id,epoch,state,completed_json FROM qa_controlled_case_ledger WHERE uid=?'
      ).get(ctx.uid);
      if(!row||row.case_id!==ctx.caseId||row.epoch!==ctx.epoch||
         row.state!=='active')deny();
      let completed;
      try{completed=JSON.parse(row.completed_json);}catch{deny();}
      if(!Array.isArray(completed)||completed.length>=CONTROLLED_DELETION_PHASES.length||
         completed.some((p,i)=>p!==CONTROLLED_DELETION_PHASES[i]))deny();
      if(doc.checkpointSha256!==digest(row.completed_json))deny();
      if(doc.purpose==='phase_retry'&&
         doc.phase!==CONTROLLED_DELETION_PHASES[completed.length])deny();
      const result=db.prepare(
        'INSERT INTO qa_signed_reviewer_receipts '+
        '(nonce,uid,case_id,epoch,purpose,phase,created_ms) VALUES (?,?,?,?,?,?,?)'
      ).run(doc.nonce,doc.uid,doc.caseId,doc.epoch,doc.purpose,
        doc.phase,at);
      if(result.changes!==1)deny();
      db.exec('COMMIT');
      return true;
    }catch{
      db.exec('ROLLBACK');
      deny();
    }
  }
  return Object.freeze({
    async approveCaseResume(snapshot,attestation){
      if(!plain(snapshot)||!Array.isArray(snapshot.completed)||
         !plain(attestation))deny();
      return consume(attestation.document,attestation.signature,{
        uid:snapshot.uid,caseId:snapshot.caseId,
        epoch:snapshot.epoch,purpose:'case_resume',phase:'case_resume'
      });
    },
    async authorizeRecoveryRetry(ctx,attestation){
      if(!plain(attestation)||!plain(ctx))deny();
      return consume(attestation.document,attestation.signature,{
        uid:ctx.uid,caseId:ctx.caseId,epoch:ctx.epoch,
        purpose:'phase_retry',phase:ctx.phase
      });
    },
    qaOnly:true,productionAuthorized:false,independentIamVerified:false
  });
}
/** Deterministic signed bytes, no signing key. */
export function qaSignedReviewPayload(document){
  checkDocument(document);
  return Buffer.from(serialized(document),'utf8');
}
export function qaReviewCheckpointDigest(completed){
  if(!Array.isArray(completed)||
     completed.some((p,i)=>p!==CONTROLLED_DELETION_PHASES[i]))deny();
  return digest(JSON.stringify(completed));
}
