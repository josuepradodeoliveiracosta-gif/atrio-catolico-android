/**
 * Offline preflight: connect the per-case moderation worksheet to the
 * existing non-destructive deletion plan. Does not certify evidence, run
 * administrative steps, contact providers, write, delete or approve release.
 */
import {buildDeletionPlan} from './deletion-orchestrator.js';
import {auditModerationCaseDossier} from './qa-moderation-case-review.js';

const REVIEW_MISSING='moderation_dossier_missing_or_invalid';
const REVIEW_PENDING='moderation_case_proposal_incomplete';
const INDEPENDENT='moderation_independent_legal_resolution_required';

/**
 * Never return UID, document paths, raw inventory, evidence URLs, reviewers
 * or the worksheet. Treat all summary counts as claims from the supplied
 * inventory, not as real-world verified coverage.
 */
export function inspectDeletionModerationPreflight({
  uid,requestRecord,inventory,approvals,dossier,now=new Date()
}={}){
  // Invalid UID remains a hard error. No staged action exists to continue.
  const plan=buildDeletionPlan(uid,requestRecord,inventory,approvals);
  let review=null,invalid=false;
  try{
    review=auditModerationCaseDossier(uid,inventory,dossier,{now});
  }catch{
    invalid=true;
  }
  const blockers=new Set(plan.blockers);
  if(invalid){
    blockers.add(REVIEW_MISSING);
  }else{
    if(!review.structurallyComplete)blockers.add(REVIEW_PENDING);
    // Even structurally complete legal suggestions cannot overrule the
    // irreversible deletion fence for reports/Guardian evidence.
    if(review.moderationCases>0)blockers.add(INDEPENDENT);
  }
  return Object.freeze({
    state:'blocked_review_only',
    moderation:Object.freeze({
      cases:review?.moderationCases??null,
      pending:review?.pending??null,
      incomplete:review?.incomplete??null,
      readyForIndependentVerification:
        review?.readyForIndependentVerification??null,
      structurallyComplete:review?.structurallyComplete??false,
      dossierValid:!invalid,
      independentDecisionVerified:false
    }),
    blockers:Object.freeze([...blockers].sort()),
    // The planner always fails closed even if it has no blockers and every
    // worksheet contains proposed decisions.
    planSimulatedOnly:plan.simulatedOnly===true,
    reviewOnly:true,
    liveInventoryVerified:false,
    moderatorIdentityVerified:false,
    retentionDecisionApproved:false,
    destructiveOperationsEnabled:false,
    accountDeletionAuthorized:false,
    googlePlayReleaseAuthorized:false
  });
}
