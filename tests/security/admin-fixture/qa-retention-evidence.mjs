/**
 * QA ONLY: durable, account-bound retention decision. No real identity,
 * signature, legal decision or production authorisation is implemented.
 *
 * Review must be reissued after EVERY case/hold change. External creation
 * of holds is a fixture operation only. Real production would require an
 * independent, authenticated compliance service and legal retention policy.
 */
const A='qa-delete-alice';
const PROJECT='demo-atrio-v11';
const REQUEST='2026-10-31T12:00:00.000Z';
const PRIVACY='qa-privacy-reviewer',SECURITY='qa-security-reviewer';
const MINUTE=60000,MAX_LIFETIME=24*60*MINUTE;
const ID=/^qa-case-[a-z0-9_-]{3,80}$/;
const deny=x=>{throw Error('qa_retention_'+x);};
function guard(){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089' ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099' ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.CLOUDINARY_API_KEY ||
     process.env.CLOUDINARY_CLOUD_NAME ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    deny('nonlocal_environment');
}
function iso(s){
  if(typeof s!=='string'||!/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)||
     !Number.isFinite(Date.parse(s)))deny('invalid_timestamp');
  return Date.parse(s);
}
function check(uid,requestAt){
  if(uid!==A)deny('unlisted_identity');
  if(requestAt!==REQUEST)deny('unmatched_request');
}
function auth(approvals){
  if(!Array.isArray(approvals)||approvals.length!==2||
     approvals[0]!==PRIVACY||approvals[1]!==SECURITY)
    deny('invalid_reviewers');
}
export function createQaRetentionEvidenceAdapter(db,{now}={}){
  guard();
  if(typeof db?.exec!=='function'||typeof db?.prepare!=='function'||
     typeof now!=='function')deny('invalid_adapter');
  // Tables only in a temporary QA SQLite instance; NOT Firestore or D1.
  db.exec("CREATE TABLE IF NOT EXISTS qa_retention_state ("+
    "uid TEXT PRIMARY KEY CHECK(uid='qa-delete-alice'),"+
    "generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0));"+
    "CREATE TABLE IF NOT EXISTS qa_retention_cases ("+
    "uid TEXT NOT NULL,case_id TEXT NOT NULL,status TEXT NOT NULL "+
    "CHECK(status IN ('hold','resolved')),"+
    "PRIMARY KEY(uid,case_id));"+
    "CREATE TABLE IF NOT EXISTS qa_retention_reviews ("+
    "uid TEXT PRIMARY KEY,request_at TEXT NOT NULL,"+
    "decision TEXT NOT NULL CHECK(decision IN ('clear','hold')),"+
    "generation INTEGER NOT NULL,reviewed_at TEXT NOT NULL,"+
    "expires_at TEXT NOT NULL,privacy TEXT NOT NULL,security TEXT NOT NULL);"+
    "INSERT OR IGNORE INTO qa_retention_state(uid) VALUES ('qa-delete-alice');");
  function generation(){
    const v=db.prepare('SELECT generation FROM qa_retention_state WHERE uid=?')
      .get(A)?.generation;
    if(!Number.isSafeInteger(v)||v<0)deny('invalid_generation');
    return v;
  }
  function time(){const t=now();if(!Number.isSafeInteger(t)||t<iso(REQUEST))deny('invalid_clock');return t;}
  return Object.freeze({
    hold(uid,caseId){
      guard();check(uid,REQUEST);
      if(!ID.test(caseId))deny('invalid_case');
      db.exec('BEGIN IMMEDIATE');
      try{
        db.prepare("INSERT INTO qa_retention_cases(uid,case_id,status) VALUES (?,?,'hold') "+
          "ON CONFLICT(uid,case_id) DO UPDATE SET status='hold'").run(uid,caseId);
        db.prepare('UPDATE qa_retention_state SET generation=generation+1 WHERE uid=?')
          .run(uid);
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
    },
    resolve(uid,caseId){
      guard();check(uid,REQUEST);
      if(!ID.test(caseId))deny('invalid_case');
      db.exec('BEGIN IMMEDIATE');
      try{
        const r=db.prepare("UPDATE qa_retention_cases SET status='resolved' "+
          "WHERE uid=? AND case_id=? AND status='hold'").run(uid,caseId);
        if(r.changes!==1)deny('not_active_hold');
        db.prepare('UPDATE qa_retention_state SET generation=generation+1 WHERE uid=?')
          .run(uid);
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
    },
    review({uid,requestAt,decision,approvals,reviewedAt,expiresAt}={}){
      guard();check(uid,requestAt);auth(approvals);
      if(!['clear','hold'].includes(decision))deny('invalid_decision');
      const start=iso(reviewedAt),until=iso(expiresAt),current=time();
      if(start>current||start<iso(REQUEST)||until<=current||
         until-start>MAX_LIFETIME||until-start<MINUTE)
        deny('invalid_review_window');
      const gen=generation();
      db.prepare("INSERT INTO qa_retention_reviews "+
        "(uid,request_at,decision,generation,reviewed_at,expires_at,privacy,security) "+
        "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET "+
        "request_at=excluded.request_at,decision=excluded.decision,"+
        "generation=excluded.generation,reviewed_at=excluded.reviewed_at,"+
        "expires_at=excluded.expires_at,privacy=excluded.privacy,"+
        "security=excluded.security").run(uid,requestAt,decision,gen,
          reviewedAt,expiresAt,approvals[0],approvals[1]);
      return true;
    },
    async verify(uid,requestAt){
      guard();check(uid,requestAt);
      const review=db.prepare('SELECT * FROM qa_retention_reviews WHERE uid=?')
        .get(uid);
      if(!review)deny('review_missing');
      if(review.request_at!==requestAt||review.decision!=='clear'||
         review.privacy!==PRIVACY||review.security!==SECURITY)
        deny('review_unapproved');
      const current=time();
      if(iso(review.reviewed_at)>current||iso(review.expires_at)<=current||
         iso(review.expires_at)-iso(review.reviewed_at)>MAX_LIFETIME)
        deny('review_expired');
      if(review.generation!==generation())deny('review_stale');
      const held=db.prepare("SELECT COUNT(*) AS n FROM qa_retention_cases "+
        "WHERE uid=? AND status='hold'").get(uid)?.n;
      if(!Number.isSafeInteger(held)||held>0)deny('active_hold');
      return true;
    }
  });
}
export const QA_RETENTION_READINESS=Object.freeze({
  productionIntegrated:false,
  reviewerIdentityReal:false,
  legalRetentionDecisionReal:false,
  signedEvidence:false
});
