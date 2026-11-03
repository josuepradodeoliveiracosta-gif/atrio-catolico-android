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

const PROJECT='demo-atrio-v11', UID='qa-delete-alice';
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
function residual(db){
  return count(db,'SELECT COUNT(*) AS n FROM avatar_pending WHERE uid=?',UID)+
    count(db,'SELECT COUNT(*) AS n FROM avatar_rate WHERE uid=?',UID)+
    count(db,'SELECT COUNT(*) AS n FROM avatar_mutex WHERE uid=?',UID)+
    count(db,'SELECT COUNT(*) AS n FROM avatar_moderation WHERE actor_uid=?',UID)+
    count(db,'SELECT COUNT(*) AS n FROM avatar_moderation WHERE target_uid=?',UID);
}
export async function scrubQaAvatarD1({
  db,uid,assertAuthorized,assertFrozen,verifyCloudinaryGone
}={}){
  environment();
  if(uid!==UID)deny('non_fixture_uid');
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
  if(count(db,'SELECT COUNT(*) AS n FROM avatar_mutex WHERE uid=?',UID)!==0)
    deny('avatar_operation_inflight');
  if(count(db,'SELECT COUNT(*) AS n FROM avatar_moderation WHERE actor_uid=?',UID)+
     count(db,'SELECT COUNT(*) AS n FROM avatar_moderation WHERE target_uid=?',UID)>0)
    deny('moderation_retention_unresolved');
  const pending=db.prepare(
    'SELECT public_id FROM avatar_pending WHERE uid=?'
  ).all(UID);
  if(pending.length>1)deny('unexpected_pending_cardinality');
  if(pending.length){
    const id=pending[0].public_id;
    if(!validAvatarPublicId(uid,id))deny('untrusted_media_ownership');
    await ready();
    if(await verifyCloudinaryGone(uid,id)!==true)
      deny('cloudinary_residual_or_unknown');
    await ready();
    // CAS: a concurrently changed upload must not be deleted under an old
    // Cloudinary proof for a different public_id.
    const removed=db.prepare(
      'DELETE FROM avatar_pending WHERE uid=? AND public_id=?'
    ).run(UID,id);
    if(removed.changes!==1)deny('pending_changed_during_cleanup');
    await ready();
  }
  await ready();
  db.prepare('DELETE FROM avatar_rate WHERE uid=?').run(UID);
  await ready();
  if(residual(db)!==0)deny('residual_or_raced_d1_records');
  return Object.freeze({
    status:'qa_in_memory_avatar_d1_cleaned',
    productionReady:false,cloudinaryLiveDeletionVerified:false,
    thirdPartyRetentionApproved:false,
    erasedPendingFixture:pending.length
  });
}
