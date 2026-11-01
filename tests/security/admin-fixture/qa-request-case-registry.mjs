/** QA only — durable SQLite case UUID. No live Firebase, Cloudflare, network,
 * account deletion, credentials, or actual administrative authentication. */
import {randomUUID} from 'node:crypto';
const UID='qa-delete-alice', PROJECT='demo-atrio-v11';
const REVIEWERS=Object.freeze({privacy:'qa-privacy-reviewer',security:'qa-security-reviewer'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
function deny(code){throw Error('qa_case_'+code);}
function guard(){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089' ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    deny('fixture_environment_required');
}
function validRequest(x){
  if(!x || Object.getPrototypeOf(x)!==Object.prototype ||
     Object.keys(x).sort().join(',')!=='requestedAt,source,uid' ||
     x.uid!==UID || !['android','web'].includes(x.source))
    deny('invalid_fixture_request');
  const at=x.requestedAt;
  if(typeof at!=='string'||!TIME.test(at)||!Number.isFinite(Date.parse(at))||
     new Date(at).toISOString()!==at)deny('invalid_requested_at');
  return {uid:UID,source:x.source,requestedAt:at};
}
function inTransaction(db,fn){
  db.exec('BEGIN IMMEDIATE');
  try{const result=fn();db.exec('COMMIT');return result;}
  catch(error){db.exec('ROLLBACK');throw error;}
}
function time(now){
  const value=now();
  if(!Number.isSafeInteger(value)||value<1000)deny('invalid_clock');
  return value;
}
export function createQaRequestCaseRegistry(db,{now=Date.now}={}){
  guard();
  if(typeof db?.prepare!=='function'||typeof db?.exec!=='function'||
     typeof now!=='function')deny('invalid_store');
  db.exec(`CREATE TABLE IF NOT EXISTS qa_request_cases (
    case_id TEXT PRIMARY KEY,
    uid TEXT NOT NULL CHECK(uid='qa-delete-alice'),
    source TEXT NOT NULL CHECK(source IN ('android','web')),
    requested_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('open','revoked')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS qa_one_open_case_per_uid
    ON qa_request_cases(uid) WHERE state='open';
  CREATE TABLE IF NOT EXISTS qa_case_reviews (
    case_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('privacy','security')),
    reviewer TEXT NOT NULL, reviewed_at INTEGER NOT NULL,
    PRIMARY KEY(case_id,role), UNIQUE(case_id,reviewer),
    FOREIGN KEY(case_id) REFERENCES qa_request_cases(case_id)
  )`);
  function get(caseId){
    if(typeof caseId!=='string'||!UUID.test(caseId))deny('invalid_case_id');
    const row=db.prepare('SELECT * FROM qa_request_cases WHERE case_id=?').get(caseId);
    if(!row)deny('case_not_found');
    return row;
  }
  function active(caseId){
    const row=get(caseId);
    if(row.state!=='open')deny('case_revoked');
    if(row.expires_at<=time(now))deny('case_expired');
    return row;
  }
  return Object.freeze({
    issue(request,{ttlMs=3600000}={}){
      guard();
      const x=validRequest(request);
      if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>86400000)
        deny('invalid_ttl');
      return inTransaction(db,()=>{
        const t=time(now);
        if(!Number.isSafeInteger(t+ttlMs))deny('invalid_clock');
        const prior=db.prepare(
          "SELECT * FROM qa_request_cases WHERE uid=? AND state='open'").get(UID);
        if(prior){
          if(prior.source!==x.source||prior.requested_at!==x.requestedAt)
            deny('new_request_requires_explicit_revoke');
          if(prior.expires_at<=t)deny('case_expired');
          return Object.freeze({caseId:prior.case_id,idempotent:true,productionReady:false});
        }
        const caseId=randomUUID();
        db.prepare('INSERT INTO qa_request_cases VALUES (?,?,?,?,?,?,?)')
          .run(caseId,UID,x.source,x.requestedAt,'open',t,t+ttlMs);
        return Object.freeze({caseId,idempotent:false,productionReady:false});
      });
    },
    approve({caseId,role,reviewer,request}={}){
      guard();
      if(!Object.hasOwn(REVIEWERS,role)||reviewer!==REVIEWERS[role])
        deny('reviewer_not_authorized_fixture');
      const x=validRequest(request);
      return inTransaction(db,()=>{
        const row=active(caseId);
        if(row.source!==x.source||row.requested_at!==x.requestedAt)
          deny('request_mismatch');
        const prior=db.prepare(
          'SELECT reviewer FROM qa_case_reviews WHERE case_id=? AND role=?'
        ).get(caseId,role);
        if(prior){
          if(prior.reviewer!==reviewer)deny('review_already_exists');
          return Object.freeze({recorded:true,idempotent:true,productionReady:false});
        }
        const conflict=db.prepare(
          'SELECT role FROM qa_case_reviews WHERE case_id=? AND reviewer=?'
        ).get(caseId,reviewer);
        if(conflict)deny('same_reviewer_not_allowed');
        db.prepare('INSERT INTO qa_case_reviews VALUES (?,?,?,?)')
          .run(caseId,role,reviewer,time(now));
        return Object.freeze({recorded:true,idempotent:false,productionReady:false});
      });
    },
    authorize({caseId,request}={}){
      guard();
      const x=validRequest(request),row=active(caseId);
      if(row.source!==x.source||row.requested_at!==x.requestedAt)
        deny('request_mismatch');
      const decisions=db.prepare(
        'SELECT role,reviewer FROM qa_case_reviews WHERE case_id=?'
      ).all(caseId);
      if(decisions.length!==2||decisions.some(d=>REVIEWERS[d.role]!==d.reviewer)||
         new Set(decisions.map(d=>d.reviewer)).size!==2)
        deny('dual_review_required');
      return Object.freeze({caseId,requestSource:row.source,
        requestedAt:row.requested_at,reviewedInQa:true,productionReady:false,
        approvedByRealAdministrators:false,canDeleteProductionAccount:false});
    },
    revoke(caseId){
      guard();
      return inTransaction(db,()=>{
        const row=get(caseId);
        if(row.state==='revoked')return false;
        db.prepare("UPDATE qa_request_cases SET state='revoked' "+
          "WHERE case_id=? AND state='open'").run(caseId);
        return true;
      });
    }
  });
}
