/**
 * QA ONLY: remove two narrowly scoped foreign references to a deleted
 * synthetic account in the LOCAL Firebase Firestore Emulator.
 *
 * 1. Recipient-side system notifications whose actorUid is exactly the
 *    deleted account, with strict schema and no user-authored payload.
 * 2. Foreign users' blockedMembers/{deletedUid} preferences.
 *
 * This must NOT delete moderation reports, third-party posts, replies,
 * unrelated notifications or any document outside these two paths.
 * The review flag is a QA fixture, NOT a production approval or identity.
 */
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';

const UID='qa-delete-alice', PROJECT='demo-atrio-v11';
const APP='qa-atrio-foreign-reference-cleanup-only';
const HOST='127.0.0.1:8089';
const SEGMENT=/^[A-Za-z0-9_-]{1,160}$/;
const MAX=2000;
const REQUIRED_NOTICE=['postId','replyId','actorUid','actorName','read','createdAt'];
const OPTIONAL_NOTICE=['replyToId','mentionUid','mentionReplyId'];
function deny(reason){throw Error('qa_foreign_reference_cleanup_'+reason);}
function guard(){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
    process.env.FIRESTORE_EMULATOR_HOST!==HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099' ||
    process.env.FIREBASE_CONFIG ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID ||
    process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_KEY ||
    process.env.CLOUDINARY_CLOUD_NAME ||
    process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    deny('live_environment_denied');
}
function foreignPath(ref,uid,collection){
  // QueryDocumentSnapshot holds its path in .ref; a reference in .path.
  const actualPath=typeof ref?.path==='string'?ref.path:ref?.ref?.path;
  const p=actualPath?.split('/');
  return !!(p && p.length===4 && p[0]==='users' &&
    p[1]!==uid && SEGMENT.test(p[1]) && p[2]===collection &&
    SEGMENT.test(p[3]));
}
function validNotice(ref,uid) {
  if(!foreignPath(ref,uid,'notifications'))return false;
  const data=ref.data?.();
  if(!data || data.actorUid!==uid ||
    !REQUIRED_NOTICE.every(x=>Object.hasOwn(data,x)) ||
    Object.keys(data).some(x=>!REQUIRED_NOTICE.includes(x) &&
      !OPTIONAL_NOTICE.includes(x)))return false;
  return SEGMENT.test(data.postId) && SEGMENT.test(data.replyId) &&
    typeof data.actorName==='string' && data.actorName.length<=100 &&
    typeof data.read==='boolean' &&
    !!data.createdAt && typeof data.createdAt.toDate==='function';
}
export function createQaAdminForeignReferenceCleanup(){
  guard();
  const app=initializeApp({projectId:PROJECT},APP);
  const db=getFirestore(app);
  let closed=false;
  const ready=()=>{guard();if(closed)deny('disposed');};
  async function inventory(uid) {
    ready();
    const notices=await db.collectionGroup('notifications')
      .where('actorUid','==',uid).limit(MAX+1).get();
    ready();
    if(!notices || notices.size>MAX || notices.size!==notices.docs.length)
      deny('unbounded_actor_notice_inventory');
    if(notices.docs.some(d=>!validNotice(d,uid)))
      deny('unreviewed_or_unexpected_notification');
    const allBlocks=await db.collectionGroup('blockedMembers')
      .limit(MAX+1).get();
    ready();
    if(!allBlocks || allBlocks.size>MAX || allBlocks.size!==allBlocks.docs.length)
      deny('unbounded_blocked_member_inventory');
    // Unknown paths do not grant deletion rights, even with an exact ID.
    if(allBlocks.docs.some(d=>!foreignPath(d.ref,uid,'blockedMembers')))
      deny('unreviewed_blocked_member_path');
    const blocks=allBlocks.docs.filter(d=>d.id===uid &&
      foreignPath(d.ref,uid,'blockedMembers'));
    if(blocks.length+notices.size>MAX)deny('unbounded_total');
    return {notices:notices.docs,blocks};
  }
  return Object.freeze({
    async purge(uid,{approvedQaReview=false,assertAuthorized,assertLease}={}){
      ready();
      if(uid!==UID)deny('other_account_denied');
      if(approvedQaReview!==true)deny('review_required');
      if(typeof assertAuthorized!=='function' || typeof assertLease!=='function')
        deny('authorization_and_lease_required');
      const fenced=async()=>{
        ready();
        if(await assertAuthorized()!==true)deny('authorization_lost');
        assertLease();
        ready();
      };
      await fenced();
      // Full bounded inventory before the first write. No moderation rows
      // or user-authored content are read or touched by this cleanup.
      const before=await inventory(uid);
      await fenced();
      for(const [group,allowed] of [
        [before.notices,ref=>validNotice(ref,uid)],
        [before.blocks,ref=>foreignPath(ref,uid,'blockedMembers') && ref.id===uid]
      ]) {
        for(const ref of group) {
          await fenced();
          if(!allowed(ref))deny('scope_changed');
          // Read again just before deleting to reject a changed/reused ID.
          const fresh=await ref.ref.get();
          await fenced();
          if(!fresh.exists)continue;
          if(!allowed(fresh))deny('record_changed');
          // The version read above is part of authorization. A competing
          // edit to a foreign user's data must make this delete FAIL rather
          // than silently erase the new version after our final check.
          if(!fresh.updateTime || !Number.isFinite(
            fresh.updateTime.toMillis?.()))
            deny('missing_document_version');
          try {
            await fresh.ref.delete({lastUpdateTime:fresh.updateTime});
          }catch(error){
            // gRPC FAILED_PRECONDITION (9) means the record changed between
            // the fresh snapshot and delete. Do not retry without a full
            // re-inventory and independent re-authorization.
            if(error?.code===9||error?.code==='failed-precondition'||
               /FAILED_PRECONDITION|precondition failed/i.test(
                 String(error?.message||'')))
              deny('concurrent_record_changed');
            throw error;
          }
          await fenced();
        }
      }
      const after=await inventory(uid);
      await fenced();
      if(after.notices.length || after.blocks.length)
        deny('residual_foreign_references');
      return Object.freeze({
        state:'qa_narrow_foreign_references_cleaned',
        removedActorNotices:before.notices.length,
        removedForeignBlocks:before.blocks.length,
        productionReady:false,
        moderationRetentionReviewed:false
      });
    },
    async close(){if(!closed){closed=true;await deleteApp(app);}}
  });
}
