/** QA only — durable SQLite case UUID. No live Firebase, Cloudflare, network,
 * account deletion, credentials, or actual administrative authentication. */
import {randomUUID,createHash} from 'node:crypto';
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
const SHA=/^[0-9a-f]{64}$/;
const ZERO='0'.repeat(64);
function hash(parts){
  return createHash('sha256').update(parts.join('\\u001f')).digest('hex');
}
function requestHash(row){
  return hash([row.uid,row.source,row.requested_at]);
}
function eventHash(row){
  return hash([row.seq,row.case_id,row.kind,row.reviewer_role??'',
    row.at,row.prev_hash,row.request_hash]);
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
  );
  CREATE TABLE IF NOT EXISTS qa_case_audit_events (
    seq INTEGER PRIMARY KEY,case_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('issued','reviewed','revoked')),
    reviewer_role TEXT,at INTEGER NOT NULL,
    prev_hash TEXT NOT NULL,event_hash TEXT NOT NULL,
    request_hash TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS qa_audit_no_update
    BEFORE UPDATE ON qa_case_audit_events BEGIN
      SELECT RAISE(ABORT,'qa_audit_immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS qa_audit_no_delete
    BEFORE DELETE ON qa_case_audit_events BEGIN
      SELECT RAISE(ABORT,'qa_audit_immutable');
    END`);
  // An append-only local SHA-256 chain is tamper-evident in QA. It is NOT
  // an independently anchored, privileged-production audit log.
  function inspectAudit(){
    const cases=db.prepare('SELECT * FROM qa_request_cases').all();
    const byCase=new Map(cases.map(x=>[x.case_id,x]));
    const events=db.prepare('SELECT * FROM qa_case_audit_events ORDER BY seq').all();
    const states=new Map();
    let seq=0,previous=ZERO;
    for(const event of events){
      const record=byCase.get(event.case_id);
      if(!record || event.seq!==++seq || event.prev_hash!==previous ||
         !SHA.test(event.event_hash) ||
         event.request_hash!==requestHash(record) ||
         event.event_hash!==eventHash(event) ||
         !Number.isSafeInteger(event.at)||event.at<1000)
        deny('audit_integrity_failed');
      previous=event.event_hash;
      let state=states.get(event.case_id);
      if(event.kind==='issued'){
        if(state || event.reviewer_role!==null ||
           event.at<record.created_at)deny('audit_integrity_failed');
        state={issued:1,revoked:false,roles:new Set()};
        states.set(event.case_id,state);
      } else if(event.kind==='reviewed'){
        if(!state || state.revoked ||
           !Object.hasOwn(REVIEWERS,event.reviewer_role) ||
           state.roles.has(event.reviewer_role))
          deny('audit_integrity_failed');
        state.roles.add(event.reviewer_role);
      } else if(event.kind==='revoked'){
        if(!state || state.revoked || event.reviewer_role!==null)
          deny('audit_integrity_failed');
        state.revoked=true;
      } else deny('audit_integrity_failed');
    }
    const reviews=db.prepare('SELECT case_id,role,reviewer FROM qa_case_reviews').all();
    for(const review of reviews){
      const state=states.get(review.case_id);
      if(!state || !state.roles.has(review.role) ||
         REVIEWERS[review.role]!==review.reviewer)
        deny('audit_integrity_failed');
    }
    for(const record of cases){
      const state=states.get(record.case_id);
      if(!state || state.revoked!==(record.state==='revoked') ||
         state.roles.size!==reviews.filter(x=>x.case_id===record.case_id).length)
        deny('audit_integrity_failed');
    }
    return Object.freeze({verified:true,events:seq,productionReady:false});
  }
  function appendAudit(kind,row,role=null){
    const last=db.prepare(
      'SELECT seq,event_hash FROM qa_case_audit_events ORDER BY seq DESC LIMIT 1'
    ).get();
    const event={seq:(last?.seq||0)+1,case_id:row.case_id,kind,
      reviewer_role:role,at:time(now),prev_hash:last?.event_hash||ZERO,
      request_hash:requestHash(row)};
    if(!Number.isSafeInteger(event.seq))deny('audit_integrity_failed');
    event.event_hash=eventHash(event);
    db.prepare('INSERT INTO qa_case_audit_events VALUES (?,?,?,?,?,?,?,?)')
      .run(event.seq,event.case_id,event.kind,event.reviewer_role,
        event.at,event.prev_hash,event.event_hash,event.request_hash);
  }
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
    inspectAudit(){
      guard();
      return inspectAudit();
    },
    issue(request,{ttlMs=3600000}={}){
      guard();
      const x=validRequest(request);
      if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>86400000)
        deny('invalid_ttl');
      return inTransaction(db,()=>{
        inspectAudit();
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
        appendAudit('issued',{case_id:caseId,uid:UID,source:x.source,
          requested_at:x.requestedAt});
        return Object.freeze({caseId,idempotent:false,productionReady:false});
      });
    },
    approve({caseId,role,reviewer,request}={}){
      guard();
      if(!Object.hasOwn(REVIEWERS,role)||reviewer!==REVIEWERS[role])
        deny('reviewer_not_authorized_fixture');
      const x=validRequest(request);
      return inTransaction(db,()=>{
        inspectAudit();
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
        appendAudit('reviewed',row,role);
        return Object.freeze({recorded:true,idempotent:false,productionReady:false});
      });
    },
    authorize({caseId,request}={}){
      guard();
      inspectAudit();
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
        inspectAudit();
        const row=get(caseId);
        if(row.state==='revoked')return false;
        db.prepare("UPDATE qa_request_cases SET state='revoked' "+
          "WHERE case_id=? AND state='open'").run(caseId);
        appendAudit('revoked',row);
        return true;
      });
    }
  });
}
