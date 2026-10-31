/**
 * QA ONLY: durable SAME-UID privileged-Worker admission and drain fixture.
 *
 * Local temporary SQLite only. NOT wired into the real Cloudflare Workers.
 * The separate Firestore freeze remains required for deletion. Unknown
 * external effects leave tickets open and prohibit Auth deletion.
 */
const ALICE='qa-delete-alice',BOB='qa-delete-bob';
const KINDS=new Set(['avatar_upload','guardian_commit','push_fanout']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function deny(code){throw Error('qa_worker_drain_'+code);}
function guard(){
  if(process.env.GCLOUD_PROJECT!=='demo-atrio-v11' ||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089' ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099' ||
     process.env.FIREBASE_CONFIG ||
     process.env.GOOGLE_CLOUD_PROJECT ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.CLOUDINARY_API_KEY ||
     process.env.CLOUDINARY_CLOUD_NAME ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    deny('nonlocal_environment');
}
function checkUid(uid){if(uid!==ALICE&&uid!==BOB)deny('unlisted_uid');}
function validTicket(t){
  return t && Object.getPrototypeOf(t)===Object.prototype &&
    Object.keys(t).sort().join(',')==='id,kind,uid' &&
    typeof t.id==='string' && UUID.test(t.id) &&
    KINDS.has(t.kind) && (t.uid===ALICE||t.uid===BOB);
}
function allSubjects(actor,recipients){
  checkUid(actor);
  if(!Array.isArray(recipients)||recipients.length<1||
     recipients.length>2||new Set(recipients).size!==recipients.length)
    deny('invalid_fanout');
  for(const uid of recipients)checkUid(uid);
  return [...new Set([actor,...recipients])].sort();
}
function validFanoutTicket(ticket){
  if(!ticket||Object.getPrototypeOf(ticket)!==Object.prototype||
     Object.keys(ticket).sort().join(',')!=='id,kind,recipients,uid'||
     ticket.kind!=='push_fanout'||!UUID.test(ticket.id))return false;
  try{allSubjects(ticket.uid,ticket.recipients);return true;}
  catch{return false;}
}
function transact(db,run){
  db.exec('BEGIN IMMEDIATE');
  try{
    const result=run();db.exec('COMMIT');return result;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function createQaWorkerDrainAdapter(db){
  guard();
  if(typeof db?.prepare!=='function'||typeof db?.exec!=='function')
    deny('invalid_sqlite');
  db.exec("CREATE TABLE IF NOT EXISTS qa_worker_drain_accounts("+
    "uid TEXT PRIMARY KEY CHECK(uid IN ('qa-delete-alice','qa-delete-bob')),"+
    "state TEXT NOT NULL DEFAULT 'active' "+
    "CHECK(state IN ('active','draining','frozen')));"+
    "CREATE TABLE IF NOT EXISTS qa_worker_drain_effects("+
    "id TEXT PRIMARY KEY,uid TEXT NOT NULL,kind TEXT NOT NULL,"+
    "subjects TEXT NOT NULL CHECK(json_valid(subjects)) "+
    "CHECK(json_type(subjects)='array') "+
    "CHECK(json_array_length(subjects) BETWEEN 1 AND 2),"+
    "FOREIGN KEY(uid) REFERENCES qa_worker_drain_accounts(uid),"+
    "CHECK(uid IN ('qa-delete-alice','qa-delete-bob')),"+
    "CHECK(kind IN ('avatar_upload','guardian_commit','push_fanout')));"+
    "CREATE INDEX IF NOT EXISTS qa_worker_drain_effects_uid "+
    "ON qa_worker_drain_effects(uid);"+
    "INSERT OR IGNORE INTO qa_worker_drain_accounts(uid) VALUES "+
    "('qa-delete-alice'),('qa-delete-bob');");
  db.exec('PRAGMA busy_timeout=1000');
  // An old one-UID ledger is NOT silently upgraded: its unfinished
  // operations could omit recipients. Review/reconcile it separately.
  const cols=db.prepare('PRAGMA table_info(qa_worker_drain_effects)')
    .all().map(x=>x.name);
  if(!cols.includes('subjects'))deny('legacy_schema_requires_review');
  const pending=(uid)=>db.prepare(
    'SELECT COUNT(*) AS n FROM qa_worker_drain_effects e '+
    'WHERE EXISTS(SELECT 1 FROM json_each(e.subjects) s WHERE s.value=?)'
  ).get(uid).n;
  const status=uid=>{
    guard();checkUid(uid);
    const row=db.prepare('SELECT state FROM qa_worker_drain_accounts WHERE uid=?')
      .get(uid);
    const total=pending(uid);
    if(!row || !['active','draining','frozen'].includes(row.state) ||
       !Number.isSafeInteger(total)||total<0)
      deny('bad_sqlite_status');
    return Object.freeze({state:row.state,pending:total});
  };
  return Object.freeze({
    status,
    begin(uid,kind){
      guard();checkUid(uid);
      if(!KINDS.has(kind))deny('unlisted_sink');
      const id=crypto.randomUUID();
      const inserted=db.prepare("INSERT INTO qa_worker_drain_effects(id,uid,kind,subjects) "+
        "SELECT ?,a.uid,?,? FROM qa_worker_drain_accounts a "+
        "WHERE a.uid=? AND a.state='active' RETURNING id")
        .get(id,kind,JSON.stringify([uid]),uid);
      if(!inserted)deny('privileged_effect_blocked');
      return Object.freeze({id,kind,uid});
    },
    async complete(ticket,{verify}={}){
      guard();
      if(!validTicket(ticket)||typeof verify!=='function')
        deny('invalid_completion');
      // The independent simulated sink must confirm the effect. Never
      // infer successful delivery from a timeout or the initial HTTP status.
      if(await verify(ticket)!==true)deny('effect_not_reconciled');
      const deleted=db.prepare("DELETE FROM qa_worker_drain_effects "+
        "WHERE id=? AND uid=? AND kind=? AND subjects=? RETURNING id"
      ).get(ticket.id,ticket.uid,ticket.kind,JSON.stringify([ticket.uid]));
      if(!deleted)deny('already_completed_or_forged');
      return true;
    },
    // Atomic *cross-account* admission: one actor and every recipient must
    // be ACTIVE in the very same SQLite statement. A frozen recipient
    // cannot be skipped by the actor's active status.
    beginFanout(actorUid,recipientUids){
      guard();
      const subjects=allSubjects(actorUid,recipientUids);
      const id=crypto.randomUUID(),slots=subjects.map(()=>'?').join(',');
      const inserted=db.prepare(
        'INSERT INTO qa_worker_drain_effects(id,uid,kind,subjects) '+
        'SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM qa_worker_drain_accounts '+
        'WHERE uid IN ('+slots+") AND state='active')=? RETURNING id"
      ).get(id,actorUid,'push_fanout',JSON.stringify(subjects),
        ...subjects,subjects.length);
      if(!inserted)deny('privileged_effect_blocked');
      return Object.freeze({id,uid:actorUid,kind:'push_fanout',
        recipients:Object.freeze([...recipientUids])});
    },
    async completeFanout(ticket,{verify}={}){
      guard();
      if(!validFanoutTicket(ticket)||typeof verify!=='function')
        deny('invalid_fanout_completion');
      if(await verify(ticket)!==true)deny('effect_not_reconciled');
      const subjects=allSubjects(ticket.uid,ticket.recipients);
      const removed=db.prepare('DELETE FROM qa_worker_drain_effects '+
        'WHERE id=? AND uid=? AND kind=? AND subjects=? RETURNING id')
        .get(ticket.id,ticket.uid,'push_fanout',JSON.stringify(subjects));
      if(!removed)deny('already_completed_or_forged');
      return true;
    },
    seal(uid){
      guard();
      if(uid!==ALICE)deny('only_alice_delete_fixture');
      db.prepare("UPDATE qa_worker_drain_accounts SET state='draining' "+
        "WHERE uid=? AND state='active'").run(uid);
      const state=status(uid);
      if(state.pending!==0)deny('pending_privileged_effect');
      if(state.state==='draining'){
        const done=db.prepare("UPDATE qa_worker_drain_accounts "+
          "SET state='frozen' WHERE uid=? AND state='draining' "+
          "AND NOT EXISTS(SELECT 1 FROM qa_worker_drain_effects e "+
          "WHERE EXISTS(SELECT 1 FROM json_each(e.subjects) s "+
          "WHERE s.value=?)) RETURNING uid").get(uid,uid);
        if(!done)deny('concurrent_effect_or_state_change');
      }
      return this.verify(uid);
    },
    verify(uid){
      guard();
      if(uid!==ALICE)deny('only_alice_delete_fixture');
      const state=status(uid);
      if(state.state!=='frozen'||state.pending!==0)deny('not_quiescent');
      return true;
    }
  });
}
export const QA_WORKER_DRAIN_UIDS=Object.freeze({alice:ALICE,bob:BOB});
