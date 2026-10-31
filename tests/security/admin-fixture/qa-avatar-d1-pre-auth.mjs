/**
 * QA only: exhaust known Avatar D1 sources before fake Firebase Auth removal.
 * Uses the repository's existing read-only D1 inventory contract, not
 * guessed row IDs, and refuses schema changes until manually reviewed.
 *
 * NEVER import from a production Worker / app. This validates only
 * fixtures (two synthetic UIDs), not retention legality or real Cloudflare D1.
 */
import {createAvatarD1ReadAdapter}
  from '../../../cloudflare/account-deletion-audit/src/avatar-d1-read-adapter.js';
import {AVATAR_D1_SOURCES}
  from '../../../cloudflare/account-deletion-audit/src/avatar-media-inventory.js';

const ALICE='qa-delete-alice';
const PROJECT='demo-atrio-v11';
const EXPECTED=Object.freeze({
  avatar_pending:'uid,public_id,created_at',
  avatar_rate:'uid,next_at',
  avatar_mutex:'uid,nonce,expires_at',
  avatar_moderation:'id,actor_uid,target_uid,reason,created_at'
});
const COMBINATIONS='avatar_pending:uid,avatar_rate:uid,avatar_mutex:uid,'+
  'avatar_moderation:actor_uid,avatar_moderation:target_uid';
const error=code=>{throw Error('qa_avatar_d1_'+code);};
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
    error('nonlocal_environment');
}
function verifySchema(sqlite){
  const listed=sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'avatar_%' ORDER BY name"
  ).all().map(x=>x.name).join(',');
  if(listed!==Object.keys(EXPECTED).sort().join(','))
    error('unreviewed_tables');
  for(const [table,columns] of Object.entries(EXPECTED)){
    const found=sqlite.prepare('PRAGMA table_info('+table+')')
      .all().map(x=>x.name).join(',');
    if(found!==columns)error('unreviewed_columns');
  }
  if(AVATAR_D1_SOURCES.map(s=>s.table+':'+s.role).join(',')!==COMBINATIONS)
    error('unreviewed_inventory_sources');
}
export function createQaAvatarD1PreAuthAdapter(sqlite){
  guard();
  if(typeof sqlite?.prepare!=='function')error('invalid_sqlite');
  verifySchema(sqlite);
  // The read adapter is restricted to the five queries defined in its
  // immutable whitelist. No D1 mutation SQL is available through this proxy.
  const db={prepare(query){
    if(typeof query!=='string'||!query.startsWith('SELECT '))
      error('unreviewed_sql');
    return {bind(...values){return {
      async all(){
        guard();
        verifySchema(sqlite);
        return {results:sqlite.prepare(query).all(...values)};
      }
    };}};
  }};
  const inventory=createAvatarD1ReadAdapter(db,ALICE);
  return Object.freeze({
    async assertOwnerCleared(uid){
      guard();
      if(uid!==ALICE)error('other_account_denied');
      verifySchema(sqlite);
      for(const s of AVATAR_D1_SOURCES){
        // Even a single row is sufficient to block deletion. All source
        // types must respond successfully; a timeout/error cannot be empty.
        let page;
        try{page=await inventory.readPage(s.table,s.role,uid,null,1);}
        catch{error('inventory_unavailable');}
        if(!page||!Array.isArray(page.items)||page.items.length>1)
          error('incomplete_inventory');
        if(page.items.length!==0)error('owned_rows_remaining');
        if(page.nextCursor!==null)error('incomplete_inventory');
      }
      return true;
    }
  });
}
export const QA_AVATAR_D1_PREFLIGHT=Object.freeze({
  productionIntegrated:false,
  realLegalRetentionReviewed:false,
  sourceCount:5,
  knownSchemaOnly:true
});
