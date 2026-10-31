/**
 * QA-ONLY source coverage contract for privileged Worker writes.
 *
 * Pinning Git blob hashes means changes to an existing Worker cannot silently
 * pass this review test. Updating a pin REQUIRES reviewing every route, cron,
 * queue, helper and external write. This does NOT install a protection into a
 * Worker and cannot prove runtime completeness; it only prevents unnoticed
 * code drift from previously reviewed sources.
 */
export const QA_WORKER_SOURCES=Object.freeze([
  {
    service:'avatar',
    file:'cloudflare/avatar-worker/src/index.js',
    gitBlob:'68b232b427da6e518fff4782c81e0cdafe9a7587',
    mustContain:[
      "if(pathname==='/avatar/upload')",
      "if(pathname==='/avatar/status')",
      "if(pathname==='/avatar/moderation/review')",
      "if(pathname==='/avatar/moderate')",
      "async function remove(env,uid)",
      "async function moderationReview(env,actor,request)",
      "async function status(env,uid)",
      "async function upload(env, uid, request)",
      "async function withAvatarLock(env,uid,action)",
      "await firestorePut(env,uid,id,publicUrl(env,promoted))",
      "await cloudSigned(env,'rename'"
    ]
  },
  {
    service:'guardian',
    file:'cloudflare/guardian-worker/src/index.js',
    gitBlob:'aa2af4b4410e66fde73f7689732e9b7cbc2e31cb',
    mustContain:[
      "export async function processDocument(",
      "export async function reviewCase(",
      "export async function resolveReviewCase(",
      "export async function scanOnce(",
      "async scheduled(event,env,ctx)",
      "'/admin/review'","'/admin/resolve'",
      "await db.commit(writes)"
    ]
  },
  {
    service:'push',
    file:'cloudflare/push-worker/src/index.js',
    gitBlob:'bf7a114d5f53606b93f2eaecb23768756b805698',
    mustContain:[
      "export async function writeThreadNotices(",
      "export async function cleanupInvalidDevice(",
      "export async function handleGuardiaoEvent(",
      "export async function handleGuardiaoReview(",
      "export async function handleBroadcast(",
      "export async function holdGuardiaoContent(",
      "async function send(token,device,uid,kind)",
      "async queue(batch,env)",
      "async fetch(request, env)",
      "ROOT+':batchWrite'",
      "ROOT+':commit'",
      "'https://fcm.googleapis.com/v1/projects/'"
    ]
  },
  {
    service:'guardian-firestore',
    file:'cloudflare/guardian-worker/src/firestore.js',
    gitBlob:'7a0082f706c1e8fc8d4003bb83f012c60f567083',
    mustContain:["async commit(","async get("]
  }
]);

/**
 * Actions are named by *entrypoint*, not only by an inner write helper.
 * Read-only routes are explicit; a mutating route not in this catalogue
 * must fail QA review and be added before anyone proposes integration.
 */
export const QA_MUTATION_ROUTES=Object.freeze([
  {service:'avatar',entry:'POST /avatar/upload',kind:'avatar_upload',scope:'ownerUid',state:'not_integrated'},
  {service:'avatar',entry:'POST /avatar/status',kind:'avatar_promote',scope:'ownerUid',state:'not_integrated'},
  {service:'avatar',entry:'DELETE /avatar',kind:'avatar_remove',scope:'ownerUid',state:'not_integrated'},
  {service:'avatar',entry:'POST /avatar/moderate',kind:'avatar_moderation',scope:'ownerUid,actorUid',state:'not_integrated'},
  {service:'avatar',entry:'POST /avatar/moderation/review',kind:'avatar_moderation',scope:'ownerUid,actorUid',state:'not_integrated'},
  {service:'guardian',entry:'POST /admin/review',kind:'guardian_review_write',scope:'ownerUid,actorUid',state:'not_integrated'},
  {service:'guardian',entry:'POST /admin/resolve',kind:'guardian_review_write',scope:'ownerUid,actorUid',state:'not_integrated'},
  {service:'guardian',entry:'scheduled scanner',kind:'guardian_content_write',scope:'ownerUid',state:'not_integrated'},
  {service:'push',entry:'POST /event thread notices',kind:'push_thread_notice',scope:'actorUid,recipientUid',state:'not_integrated'},
  {service:'push',entry:'POST /event FCM',kind:'push_fcm_send',scope:'recipientUid',state:'not_integrated'},
  {service:'push',entry:'POST /broadcast FCM',kind:'push_fcm_send',scope:'recipientUid',state:'not_integrated'},
  {service:'push',entry:'POST /moderation/event',kind:'guardian_content_write',scope:'ownerUid',state:'not_integrated'},
  {service:'push',entry:'POST /moderation/review',kind:'guardian_review_write',scope:'ownerUid,actorUid',state:'not_integrated'},
  {service:'push',entry:'queue QA bots',kind:'guardian_content_write',scope:'ownerUid',state:'not_integrated'},
  {service:'push',entry:'invalid FCM token cleanup',kind:'push_cleanup_device',scope:'ownerUid',state:'not_integrated'}
]);

export const QA_READ_ONLY_ROUTES=Object.freeze([
  'GET /avatar/moderation/pending',
  'GET /avatar/moderation/preview',
  'GET /health'
]);

// These paths are intentionally not declared protected; they have multi-
// resource/recipient behavior needing additional protocol design.
export const QA_OPEN_WRITE_GAPS=Object.freeze([
  'avatar internal rate limiter and mutex writes',
  'avatar rollback and exception cleanup in Cloudinary',
  'guardian configuration and privileged QA fixture route',
  'guardian legacy restoration and scheduled pagination retries',
  'push multi-recipient fanout and topic broadcast',
  'push D1 delivery/audit/throttle bookkeeping',
  'push guardian AI enrichment and moderation automation',
  'push QA queue and bot Firestore writes',
  'FCM send can succeed without a strong external confirmation',
  'workers with older deployed revisions and missing fence integration'
]);

export function qaCoverageSummary() {
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
