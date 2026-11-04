/**
 * QA-only avatar D1 cleanup using Node's in-memory SQLite engine.
 * This is destructive to SYNTHETIC IN-MEMORY DATA ONLY. It cannot accept
 * a Cloudflare D1 binding, remote database, filesystem database, live UID,
 * Firebase credentials or Cloudinary credentials.
 *
 * Tests the actual conditional SQL semantics needed for future D1 adapters.
 * This is not a production deletion endpoint, release authorization, legal
 * retention policy or Cloudinary effect proof.
 */
import {DatabaseSync} from 'node:sqlite';
import {validAvatarPublicId}
  from '../../account-deletion-audit/src/avatar-media-inventory.js';

const PROJECT='demo-atrio-v11';
const ALLOWED_UIDS=new Set(['qa-delete-alice','qa-delete-candidate']);
const SCHEMA=Object.freeze({
  avatar_pending:'uid,public_id,created_at',
  avatar_rate:'uid,next_at',
  avatar_mutex:'uid,nonce,expires_at',
  avatar_moderation:'id,actor_uid,target_uid,reason,created_at'
});
const TABLES=Object.keys(SCHEMA).sort().join(',');
function deny(why){throw Error('qa_avatar_d1_cleanup_denied:'+why);}
function environment(){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089' ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099' ||
     process.env.FIREBASE_CONFIG ||
     process.env.GOOGLE_CLOUD_PROJECT ||
     process.env.GCLOUD_PROJECT_ID ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.CLOUDINARY_API_KEY ||
     process.env.CLOUDINARY_CLOUD_NAME ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    deny('untrusted_environment');
}
function localDb(db){
  if(!(db instanceof DatabaseSync))deny('not_node_sqlite');
  // A filename, attached database or writable file must not be accepted.
  const files=db.prepare('PRAGMA database_list').all();
  if(files.length!==1||files[0].name!=='main' ||
     files[0].file!=='')deny('not_in_memory');
  const names=db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' "+
    "AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(x=>x.name);
  if(names.join(',')!==TABLES)deny('unknown_table');
  for(const [table,cols] of Object.entries(SCHEMA)){
    const names=db.prepare('PRAGMA table_info('+table+')')
      .all().map(x=>x.name).join(',');
    if(names!==cols)deny('unknown_schema');
  }
}
function count(db,sql,uid){
  const row=db.prepare(sql).get(uid);
  if(!row||!Number.isSafeInteger(row.n)||row.n<0)deny('untrusted_count');
  return row.n;
}
function residual(db,uid){
  return count(db,'SELECT COUNT(*) AS n FROM avatar_pending WHERE uid=?',uid)+
    count(db,'SELECT COUNT(*) AS n FROM avatar_rate WHERE uid=?',uid)+
    count(db,'SELECT COUNT(*) AS n FROM avatar_mutex WHERE uid=?',uid)+
    count(db,'SELECT COUNT(*) AS n FROM avatar_moderation WHERE actor_uid=?',uid)+
    count(db,'SELECT COUNT(*) AS n FROM avatar_moderation WHERE target_uid=?',uid);
}
export async function scrubQaAvatarD1({
  db,uid,assertAuthorized,assertFrozen,verifyCloudinaryGone
}={}){
  environment();
  if(!ALLOWED_UIDS.has(uid))deny('non_fixture_uid');
  if(typeof assertAuthorized!=='function'||typeof assertFrozen!=='function'||
     typeof verifyCloudinaryGone!=='function')deny('missing_safety_probes');
  localDb(db);
  const ready=async()=>{
    environment();
    localDb(db);
    if(await assertAuthorized(uid)!==true)deny('approval_revoked');
    if(await assertFrozen(uid)!==true)deny('freeze_unverified');
    environment(); // approvals may have awaited external I/O
    localDb(db);
  };
  await ready();
  // Neither an in-flight mutex nor evidence concerning third parties may be
  // silently erased or interpreted as a completed deletion.
  if(count(db,'SELECT COUNT(*) AS n FROM avatar_mutex WHERE uid=?',uid)!==0)
    deny('avatar_operation_inflight');
  if(count(db,'SELECT COUNT(*) AS n FROM avatar_moderation WHERE actor_uid=?',uid)+
     count(db,'SELECT COUNT(*) AS n FROM avatar_moderation WHERE target_uid=?',uid)>0)
    deny('moderation_retention_unresolved');
  const pending=db.prepare(
    'SELECT public_id,created_at FROM avatar_pending WHERE uid=?'
  ).all(uid);
  if(pending.length>1)deny('unexpected_pending_cardinality');
  if(pending.length&&(!Number.isSafeInteger(pending[0].created_at)||
     pending[0].created_at<0))deny('untrusted_pending_version');
  // Capture rate before the awaited Cloudinary proof, not after it.
  const rate=db.prepare('SELECT next_at FROM avatar_rate WHERE uid=?').all(uid);
  if(rate.length>1)deny('unexpected_rate_cardinality');
  if(rate.length&&(!Number.isSafeInteger(rate[0].next_at)||
     rate[0].next_at<0))deny('untrusted_rate_version');
  const rateAt=rate.length?rate[0].next_at:0;
  const rateUnchanged=()=>{
    const newer=db.prepare('SELECT next_at FROM avatar_rate WHERE uid=?')
      .all(uid);
    return newer.length===rate.length&&
      (newer.length===0||newer[0].next_at===rateAt);
  };
  const fenceClear=()=>(
    count(db,'SELECT COUNT(*) AS n FROM avatar_mutex WHERE uid=?',uid)===0&&
    count(db,'SELECT COUNT(*) AS n FROM avatar_moderation WHERE actor_uid=?',uid)+
      count(db,'SELECT COUNT(*) AS n FROM avatar_moderation WHERE target_uid=?',uid)===0
  );
  if(pending.length){
    const id=pending[0].public_id;
    if(!validAvatarPublicId(uid,id))deny('untrusted_media_ownership');
    await ready();
    if(await verifyCloudinaryGone(uid,id)!==true)
      deny('cloudinary_residual_or_unknown');
    await ready();
    // A stale public ID can refer to a newer upload with a different
    // created_at. Prevent deletion under an earlier media readback.
    if(!rateUnchanged())deny('rate_changed_during_cleanup');
    if(!fenceClear())deny('fence_or_retention_changed');
    const removed=db.prepare(
      'DELETE FROM avatar_pending WHERE uid=? AND public_id=? '+
      'AND created_at=? AND NOT EXISTS '+
      '(SELECT 1 FROM avatar_mutex WHERE uid=?) AND NOT EXISTS '+
      '(SELECT 1 FROM avatar_moderation WHERE actor_uid=? OR target_uid=?)'
    ).run(uid,id,pending[0].created_at,uid,uid,uid);
    if(removed.changes!==1)deny('pending_changed_during_cleanup');
    await ready();
  }
  await ready();
  if(!rateUnchanged())deny('rate_changed_during_cleanup');
  if(!fenceClear())deny('fence_or_retention_changed');
  if(rate.length){
    const removed=db.prepare(
      'DELETE FROM avatar_rate WHERE uid=? AND next_at=? '+
      'AND NOT EXISTS (SELECT 1 FROM avatar_mutex WHERE uid=?) '+
      'AND NOT EXISTS (SELECT 1 FROM avatar_moderation '+
      'WHERE actor_uid=? OR target_uid=?)'
    ).run(uid,rateAt,uid,uid,uid);
    if(removed.changes!==1)deny('rate_changed_during_cleanup');
  }
  await ready();
  if(residual(db,uid)!==0)deny('residual_or_raced_d1_records');
  return Object.freeze({
    status:'qa_in_memory_avatar_d1_cleaned',
    productionReady:false,cloudinaryLiveDeletionVerified:false,
    thirdPartyRetentionApproved:false,
    erasedPendingFixture:pending.length
  });
}
