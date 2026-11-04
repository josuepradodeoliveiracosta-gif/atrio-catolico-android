/** QA ONLY: pinned source review of all three active Worker codebases.
 * This tests for code drift, NOT end-to-end write fencing. No live I/O.
 * Any change to pinned source must explicitly review every route, queue,
 * cron, external write, recipient scope and rollback before updating a pin.
 */
export const QA_WORKER_SOURCES=Object.freeze([
  {
    "service": "avatar",
    "file": "cloudflare/avatar-worker/src/index.js",
    "gitBlob": "bf8a0aac259cee5fa6ab77e3784c4330f80ee1e3",
    "mustContain": [
      "if(pathname==='/avatar/upload')",
      "if(pathname==='/avatar/status')",
      "if(pathname==='/avatar/moderation/review')",
      "if(pathname==='/avatar/moderate')",
      "async function remove(env,uid)",
      "async function moderationReview(env,actor,request)",
      "async function status(env,uid)",
      "async function upload(env, uid, request)",
      "async function withAvatarLock(env,uid,action)",
      "export async function avatarDeletionFrozen(token,uid)",
      "if(await avatarWriteDenied(env,uid)) return json(409,'account_deletion_in_progress');",
      "await firestorePut(env,uid,id,publicUrl(env,promoted))",
      "await cloudSigned(env,'rename'"
    ]
  },
  {
    "service": "guardian",
    "file": "cloudflare/guardian-worker/src/index.js",
    "gitBlob": "6389f4e5d3bf830a5517b0167ba38af6cfc66d4c",
    "mustContain": [
      "export async function processDocument(",
      "export async function guardianAccountFrozen(db, uids)",
      "export function guardianFreezeVerifies(db,uids)",
      "writes.push(...guardianFreezeVerifies(db,[item.owner]));",
      "...guardianFreezeVerifies(db,[uid,owner])",
      "if(await guardianAccountFrozen(db,[item.owner]))return 'frozen';",
      "if(await guardianAccountFrozen(db,[uid,owner]))throw denial(409,'account_deletion_in_progress');",
      "export async function reviewCase(",
      "export async function resolveReviewCase(",
      "export async function scanOnce(",
      "async scheduled(event,env,ctx)",
      "'/admin/review'",
      "'/admin/resolve'",
      "await db.commit(writes)"
    ]
  },
  {
    "service": "push",
    "file": "cloudflare/push-worker/src/index.js",
    "gitBlob": "6551e28d10131158702c9349b8d57155cb276c24",
    "mustContain": [
      "export async function writeThreadNotices(",
      "export async function cleanupInvalidDevice(",
      "export async function handleGuardiaoEvent(",
      "export async function handleGuardiaoReview(",
      "if(await pushAccountFrozen(service,admin))continue;",
      "export async function handleBroadcast(",
      "return response(503,'broadcast_privacy_coordinator_required');",
      "export async function holdGuardiaoContent(",
      "export async function pushAccountFrozen(token, uid)",
      "if(await pushAccountFrozen(service,actor))",
      "if(await pushAccountFrozen(service,ownerUid))",
      "async function send(token,device,uid,kind)",
      "async queue(batch,env)",
      "async fetch(request, env)",
      "blockSafeThreadRecipients(token,uid,event.recipients)",
      "const blockSafeMode = event.kind==='reply';",
      "const deliveryRecipients=blockSafeMode && recipients.length",
      "for(const recipient of deliveryRecipients) {",
      "const [actorNowFrozen,recipientNowFrozen]=await Promise.all([",
      "if(actorNowFrozen||recipientNowFrozen) continue;",
      "recheckThreadRecipientPresence(token,uid,recipients)",
      "ROOT+':batchGet'",
      "'account_deletion_freeze/'+enc(actorUid)",
      "'account_deletion_freeze/'+enc(uid)",
      "ROOT+':batchWrite'",
      "return response(503,'fanout_failed');",
      "result.status.length!==writes.length",
      "ROOT+':commit'",
      "'https://fcm.googleapis.com/v1/projects/'"
    ]
  },
  {
    "service": "guardian-firestore",
    "file": "cloudflare/guardian-worker/src/firestore.js",
    "gitBlob": "a9db481b9820c641154b50aadb92e4c765f88465",
    "mustContain": [
      "async commit(writes){",
      "export async function parseFirestoreBatchGetStream(response)",
      "if(path===':batchGet')return parseFirestoreBatchGetStream(r);",
      "this.send(':batchGet','POST'",
      "newTransaction:{readWrite:{}}",
      "return await this.send(':commit','POST',{writes:updates,transaction})",
      "get(path){"
    ]
  }
]);

/** No mutating route is considered integrated with production fencing. */
export const QA_MUTATION_ROUTES=Object.freeze([
  {
    "service": "avatar",
    "entry": "POST /avatar/upload",
    "kind": "avatar_upload",
    "scope": "ownerUid",
    "state": "not_integrated"
  },
  {
    "service": "avatar",
    "entry": "POST /avatar/status",
    "kind": "avatar_promote",
    "scope": "ownerUid",
    "state": "not_integrated"
  },
  {
    "service": "avatar",
    "entry": "DELETE /avatar",
    "kind": "avatar_remove",
    "scope": "ownerUid",
    "state": "not_integrated"
  },
  {
    "service": "avatar",
    "entry": "POST /avatar/moderate",
    "kind": "avatar_moderation",
    "scope": "ownerUid,actorUid",
    "state": "not_integrated"
  },
  {
    "service": "avatar",
    "entry": "POST /avatar/moderation/review",
    "kind": "avatar_moderation",
    "scope": "ownerUid,actorUid",
    "state": "not_integrated"
  },
  {
    "service": "guardian",
    "entry": "POST /admin/review",
    "kind": "guardian_review_write",
    "scope": "ownerUid,actorUid",
    "state": "not_integrated"
  },
  {
    "service": "guardian",
    "entry": "POST /admin/resolve",
    "kind": "guardian_review_write",
    "scope": "ownerUid,actorUid",
    "state": "not_integrated"
  },
  {
    "service": "guardian",
    "entry": "scheduled scanner",
    "kind": "guardian_content_write",
    "scope": "ownerUid",
    "state": "not_integrated"
  },
  {
    "service": "push",
    "entry": "POST /event thread notices",
    "kind": "push_thread_notice",
    "scope": "actorUid,recipientUid",
    "state": "not_integrated"
  },
  {
    "service": "push",
    "entry": "POST /event FCM",
    "kind": "push_fcm_send",
    "scope": "recipientUid",
    "state": "not_integrated"
  },
  {
    "service": "push",
    "entry": "POST /broadcast FCM",
    "kind": "push_fcm_send",
    "scope": "recipientUid",
    "state": "not_integrated"
  },
  {
    "service": "push",
    "entry": "POST /moderation/event",
    "kind": "guardian_content_write",
    "scope": "ownerUid",
    "state": "not_integrated"
  },
  {
    "service": "push",
    "entry": "POST /moderation/review",
    "kind": "guardian_review_write",
    "scope": "ownerUid,actorUid",
    "state": "not_integrated"
  },
  {
    "service": "push",
    "entry": "queue QA bots",
    "kind": "guardian_content_write",
    "scope": "ownerUid",
    "state": "not_integrated"
  },
  {
    "service": "push",
    "entry": "invalid FCM token cleanup",
    "kind": "push_cleanup_device",
    "scope": "ownerUid",
    "state": "not_integrated"
  }
]);

export const QA_READ_ONLY_ROUTES=Object.freeze([
  "GET /avatar/moderation/pending",
  "GET /avatar/moderation/preview",
  "GET /health"
]);
export const QA_OPEN_WRITE_GAPS=Object.freeze([
  "avatar internal rate limiter and mutex writes",
  "avatar rollback and exception cleanup in Cloudinary",
  "guardian configuration and privileged QA fixture route",
  "guardian legacy restoration and scheduled pagination retries",
  "push multi-recipient fanout and topic broadcast",
  "push D1 delivery/audit/throttle bookkeeping",
  "push guardian AI enrichment and moderation automation",
  "push QA queue and bot Firestore writes",
  "FCM send can succeed without a strong external confirmation",
  "workers with older deployed revisions and missing fence integration"
]);

export function qaCoverageSummary(){
 return Object.freeze({
   productionIntegrated:false,
   safeToExecuteDeletion:false,
   frozenAccountsProtectedInProduction:false,
   namedWriteEntries:QA_MUTATION_ROUTES.length,
   unprotectedWriteEntries:QA_MUTATION_ROUTES.filter(x=>x.state!=='integrated').length,
   openGaps:QA_OPEN_WRITE_GAPS.length,
   sourcePins:QA_WORKER_SOURCES.length
 });
}
