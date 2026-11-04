/** REVIEW ONLY: schema-change alarms for personal data deletion coverage.
 * This file must NOT grant automatic deletion, bypass retention or flip any
 * Play release gate. Every Firestore match path must be classified explicitly.
 * The order matches firestore.rules to catch rewrites as well as additions.
 */
export const RULES_SCHEMA_CONTRACT=Object.freeze([
  {
    "path": "/databases/{database}/documents",
    "classification": "scope_container"
  },
  {
    "path": "/account_deletion_freeze/{uid}",
    "classification": "freeze_marker_manual"
  },
  {
    "path": "/app_config/opening_video",
    "classification": "system_config"
  },
  {
    "path": "/app_config/founder",
    "classification": "system_config"
  },
  {
    "path": "/app_config/engagement",
    "classification": "system_config"
  },
  {
    "path": "/app_config/community_terms",
    "classification": "system_config"
  },
  {
    "path": "/admins/{uid}",
    "classification": "owned"
  },
  {
    "path": "/badges/{uid}",
    "classification": "owned"
  },
  {
    "path": "/badge_requests/{uid}",
    "classification": "owned"
  },
  {
    "path": "/profiles/{uid}",
    "classification": "owned"
  },
  {
    "path": "/profile_photos/{uid}",
    "classification": "owned"
  },
  {
    "path": "/public_profiles/{uid}",
    "classification": "owned"
  },
  {
    "path": "/posts/{postId}",
    "classification": "relational"
  },
  {
    "path": "/replies/{replyId}",
    "classification": "relational_nested"
  },
  {
    "path": "/reactions/{uid}",
    "classification": "relational_nested"
  },
  {
    "path": "/users/{uid}/blockedMembers/{memberUid}",
    "classification": "owned_nested"
  },
  {
    "path": "/users/{uid}/acceptedTerms/{version}",
    "classification": "owned_nested"
  },
  {
    "path": "/users/{uid}/likedPosts/{postId}",
    "classification": "owned_nested"
  },
  {
    "path": "/users/{uid}/savedPosts/{postId}",
    "classification": "owned_nested"
  },
  {
    "path": "/users/{uid}/followedPosts/{postId}",
    "classification": "owned_nested"
  },
  {
    "path": "/users/{uid}/pushDevices/{deviceId}",
    "classification": "owned_nested"
  },
  {
    "path": "/users/{recipientUid}/notifications/{notificationId}",
    "classification": "relational_foreign_user"
  },
  {
    "path": "/guardiao_quarantine/{caseId}",
    "classification": "relational_moderation"
  },
  {
    "path": "/user_reports/{reportId}",
    "classification": "relational_moderation"
  },
  {
    "path": "/reports/{reportId}",
    "classification": "relational_moderation"
  },
  {
    "path": "/guardian_config/{configId}",
    "classification": "system_config"
  },
  {
    "path": "/guardian_cases/{caseId}",
    "classification": "relational_moderation"
  },
  {
    "path": "/guardian_audit/{auditId}",
    "classification": "relational_moderation"
  },
  {
    "path": "/guardian_notices/{uid}",
    "classification": "owned"
  },
  {
    "path": "/items/{noticeId}",
    "classification": "owned_nested"
  },
  {
    "path": "/guardian_runtime/{id}",
    "classification": "manual_review_unknown_ownership"
  },
  {
    "path": "/account_deletion_requests/{uid}",
    "classification": "retention_request_review"
  },
  {
    "path": "/{document=**}",
    "classification": "catch_all_deny"
  }
]);

export const EXPLICIT_UNRESOLVED_SCOPES=Object.freeze([
  'account_deletion_freeze/{uid} — privileged freeze marker lifecycle',
  'account_deletion_requests/{uid} — retention of request receipt and status',
  'guardian_runtime/{id} — runtime markers may contain user references',
  'app_config/founder — owner identifier requires lawful retention review',
  'user and post cross-references via unindexed IDs',
  'orphaned nested subcollections and unknown future collections'
]);

export const qaSchemaClassificationSummary=()=>Object.freeze({
  productionReady:false,
  deletionComplete:false,
  reviewedRules: RULES_SCHEMA_CONTRACT.length,
  unresolvedScopes: EXPLICIT_UNRESOLVED_SCOPES.length,
  uncategorized: RULES_SCHEMA_CONTRACT.filter(x=>!x.classification).length
});
