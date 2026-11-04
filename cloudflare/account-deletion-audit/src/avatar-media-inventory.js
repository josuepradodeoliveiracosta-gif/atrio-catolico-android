/**
 * Átrio: inventário de mídia SOMENTE-LEITURA. Nenhum endpoint expõe este módulo.
 * Usar apenas com adaptadores administrativos de leitura e contas de QA.
 * Não confundir ausência de referências conhecidas com autorização para apagar.
 */
import {validUid} from './plan.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_LIMIT=100;
const MAX_PAGES=60;
const MAX_ITEMS=6000;
const CURSOR=/^[A-Za-z0-9_+\/=-]{1,2048}$/;
const SOURCES=Object.freeze([
  {table:'avatar_pending',role:'uid'},
  {table:'avatar_rate',role:'uid'},
  {table:'avatar_mutex',role:'uid'},
  {table:'avatar_moderation',role:'actor_uid'},
  {table:'avatar_moderation',role:'target_uid'}
]);
const TYPES=Object.freeze(['upload','authenticated']);
export const AVATAR_D1_SOURCES=SOURCES;
export const AVATAR_CLOUDINARY_TYPES=TYPES;

export function validAvatarPublicId(uid,id) {
  return validUid(uid) && typeof id==='string' &&
    id.startsWith('atrio-avatares/'+uid+'/') &&
    UUID.test(id.slice(('atrio-avatares/'+uid+'/').length));
}

async function walkPage(fetchPage,validate,dedupKey) {
  const items=[];
  const keys=new Set();
  const cursors=new Set();
  let cursor=null;
  for(let page=0;page<MAX_PAGES;page++){
    const data=await fetchPage(cursor,SOURCE_LIMIT);
    if(!data || !Array.isArray(data.items) || data.items.length>SOURCE_LIMIT)
      throw Error('invalid_media_page');
    for(const item of data.items){
      if(!validate(item)) throw Error('invalid_media_record');
      const key=dedupKey(item);
      if(keys.has(key)) throw Error('repeated_media_record');
      keys.add(key);
      items.push(item);
      if(items.length>MAX_ITEMS) throw Error('media_limit_exceeded');
    }
    if(data.nextCursor===null || data.nextCursor===undefined || data.nextCursor==='')
      return items;
    const next=data.nextCursor;
    if(typeof next!=='string' || !CURSOR.test(next) || cursors.has(next))
      throw Error('invalid_media_cursor');
    cursors.add(next);
    cursor=next;
  }
  throw Error('incomplete_media_pagination');
}
function validD1Row(uid,source,row){
  if(!row || typeof row!=='object' || Array.isArray(row)) return false;
  if(row[source.role]!==uid) return false;
  if(source.table==='avatar_pending')
    return validAvatarPublicId(uid,row.public_id) &&
      Object.keys(row).every(k=>['uid','public_id'].includes(k));
  if(source.table==='avatar_rate')
    return Number.isSafeInteger(row.next_at) &&
      Object.keys(row).every(k=>['uid','next_at'].includes(k));
  if(source.table==='avatar_mutex')
    return Number.isSafeInteger(row.expires_at) &&
      Object.keys(row).every(k=>['uid','expires_at'].includes(k));
  return Number.isSafeInteger(row.id) && row.id>0 &&
    typeof row.actor_uid==='string' && validUid(row.actor_uid) &&
    typeof row.target_uid==='string' && validUid(row.target_uid) &&
    Object.keys(row).every(k=>['id','actor_uid','target_uid'].includes(k));
}
function validCloudAsset(uid,type,item) {
  return item && typeof item==='object' && !Array.isArray(item) &&
    item.type===type && validAvatarPublicId(uid,item.public_id) &&
    Object.keys(item).every(k=>['type','public_id'].includes(k));
}
/**
 * Read-only contract:
 * d1.readPage(table,role,uid,cursor,limit) => {items,nextCursor}
 * cloud.readPage(uid,type,cursor,limit) => {items,nextCursor}
 * photo.getPublicId(uid) => string|null (reads Firestore profile_photos/{uid})
 */
export async function inventoryAvatarMedia(uid,{d1,cloud,photo}={}) {
  if(!validUid(uid)) throw Error('invalid_uid');
  if(typeof d1?.readPage!=='function' || typeof cloud?.readPage!=='function' ||
     typeof photo?.getPublicId!=='function') throw Error('missing_read_only_adapter');
  const d1Rows={};
  for(const source of SOURCES){
    const label=source.table+':'+source.role;
    d1Rows[label]=await walkPage(
      (cursor,limit)=>d1.readPage(source.table,source.role,uid,cursor,limit),
      row=>validD1Row(uid,source,row),
      row=>source.table==='avatar_moderation'?String(row.id):row.uid
    );
  }
  const cloudRows={};
  for(const type of TYPES){
    cloudRows[type]=await walkPage(
      (cursor,limit)=>cloud.readPage(uid,type,cursor,limit),
      row=>validCloudAsset(uid,type,row),
      row=>row.public_id
    );
  }
  const firestoreId=await photo.getPublicId(uid);
  if(firestoreId!==null && !validAvatarPublicId(uid,firestoreId))
    throw Error('unexpected_firestore_photo');
  const pending=d1Rows['avatar_pending:uid'].map(x=>x.public_id);
  const upload=new Set(cloudRows.upload.map(x=>x.public_id));
  const authenticated=new Set(cloudRows.authenticated.map(x=>x.public_id));
  const known=new Set([...pending, ...(firestoreId?[firestoreId]:[])]);
  const all=new Set([...upload,...authenticated]);
  const unreferenced=[...all].filter(x=>!known.has(x));
  const conflicts=[...upload].filter(x=>authenticated.has(x));
  const missingPending=pending.filter(x=>!authenticated.has(x));
  const missingPublished=firestoreId!==null&&!upload.has(firestoreId);
  const pendingPublic=pending.filter(x=>upload.has(x));
  const publishedProtected=firestoreId!==null&&authenticated.has(firestoreId);
  const moderation=d1Rows['avatar_moderation:actor_uid'].concat(
    d1Rows['avatar_moderation:target_uid']);
  const uniqueModeration=new Set(moderation.map(x=>x.id));
  const blockers=[];
  if(unreferenced.length)blockers.push('unreferenced_cloudinary_assets');
  if(conflicts.length)blockers.push('same_public_id_in_multiple_delivery_types');
  if(missingPending.length)blockers.push('pending_d1_asset_not_found');
  if(missingPublished)blockers.push('published_firestore_asset_not_found');
  if(pendingPublic.length)blockers.push('pending_asset_exposed_as_upload');
  if(publishedProtected)blockers.push('published_asset_still_authenticated');
  if(d1Rows['avatar_mutex:uid'].length)blockers.push('avatar_operation_mutex_present');
  if(uniqueModeration.size)blockers.push('moderation_retention_review');
  return {
    uid,
    // IDs and details are private, backend-only; never return through public routes.
    internalReferences:Object.freeze({
      firestorePhoto:firestoreId,
      pending:pending.slice(),
      upload:[...upload],
      authenticated:[...authenticated],
      unreferenced,
      moderationCaseIds:[...uniqueModeration]
    }),
    summary:Object.freeze({
      pending:d1Rows['avatar_pending:uid'].length,
      publishedFirestore:firestoreId?1:0,
      cloudinaryPublic:upload.size,
      cloudinaryProtected:authenticated.size,
      unreferenced:unreferenced.length,
      missingPending:missingPending.length,
      missingPublished:missingPublished?1:0,
      conflicts:conflicts.length,
      rateRecords:d1Rows['avatar_rate:uid'].length,
      mutexRecords:d1Rows['avatar_mutex:uid'].length,
      moderationRecords:uniqueModeration.size
    }),
    blockers:[...new Set(blockers)].sort(),
    knownSourcesAudited:true,
    globalMediaCoverageComplete:false,
    safeToExecute:false,
    unverified:['legacy_assets_outside_avatar_prefix','other_upload_types',
      'cloudinary_derived_media_and_backups','unlisted_d1_tables',
      'device_local_profile_photos','other_firestore_media_references']
  };
}
export function summarizeAvatarMedia(audit) {
  if(!audit||audit.safeToExecute!==false ||
    audit.globalMediaCoverageComplete!==false ||
    audit.knownSourcesAudited!==true ||
    !audit.summary||!Array.isArray(audit.blockers) ||
    !Array.isArray(audit.unverified))
    throw Error('invalid_media_audit');
  const keys=['pending','publishedFirestore','cloudinaryPublic',
    'cloudinaryProtected','unreferenced','missingPending','missingPublished',
    'conflicts','rateRecords','mutexRecords','moderationRecords'];
  const counts={};
  for(const key of keys){
    const value=audit.summary[key];
    if(!Number.isSafeInteger(value)||value<0) throw Error('invalid_media_audit');
    counts[key]=value;
  }
  return {status:'review_required',safeToExecute:false,
    counts,blockers:[...audit.blockers],unverifiedScopeCount:audit.unverified.length};
}
