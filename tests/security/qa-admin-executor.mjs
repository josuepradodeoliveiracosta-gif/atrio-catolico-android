/**
 * QA ONLY — administrative admission to the isolated deletion runner.
 *
 * This is a fixture-based workflow demonstration, NOT an identity or IAM
 * system. The two fixed reviewer IDs below are untrusted placeholders.
 * A real administrative service must independently authenticate reviewers,
 * authorize their roles, verify signed decisions, and audit retention.
 *
 * This module does not expose an HTTP endpoint and never connects to
 * production. Firebase Auth and Cloudinary remain in-memory test doubles.
 */
import {doc,getDoc} from 'firebase/firestore';
import {QaDeletionRunner} from './qa-deletion-executor.mjs';

const UID='qa-delete-alice';
const ID='qa-account-delete-alice-v1';
const APPROVERS=Object.freeze({
  privacy:'qa-privacy-reviewer',
  security:'qa-security-reviewer'
});
function guardEnv(){
  if(process.env.GCLOUD_PROJECT!=='demo-atrio-v11' ||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089' ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.CLOUDINARY_API_KEY ||
     process.env.ATRIO_PLAY_AAB_APPROVED ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    throw Error('qa_admin_environment_denied');
}
function validateOrder(order){
  if(!order || Object.getPrototypeOf(order)!==Object.prototype ||
     Object.keys(order).sort().join(',')!=='approvals,fixtureUid,id,retentionDecision' ||
     order.id!==ID || order.fixtureUid!==UID ||
     order.retentionDecision!=='qa_no_hold_reviewed' ||
     !Array.isArray(order.approvals) || order.approvals.length!==2)
    throw Error('qa_admin_approval_required');
  const found=new Set();
  for(const approval of order.approvals){
    if(!approval || Object.getPrototypeOf(approval)!==Object.prototype ||
       Object.keys(approval).sort().join(',')!=='approved,reviewer,role' ||
       approval.approved!==true ||
       !Object.hasOwn(APPROVERS,approval.role) ||
       APPROVERS[approval.role]!==approval.reviewer ||
       found.has(approval.role))
      throw Error('qa_admin_approval_required');
    found.add(approval.role);
  }
  if(found.size!==2)throw Error('qa_admin_approval_required');
}
export const QA_ADMIN_ORDER_TEMPLATE=Object.freeze({
  id:ID,fixtureUid:UID,retentionDecision:'qa_no_hold_reviewed',
  approvals:Object.freeze([
    Object.freeze({role:'privacy',reviewer:APPROVERS.privacy,approved:true}),
    Object.freeze({role:'security',reviewer:APPROVERS.security,approved:true})
  ])
});

export class QaAdministrativeDeletionExecutor {
  constructor({db,journal,media,auth,lease=null,external=null}={}){
    guardEnv();
    if(!db || typeof journal?.prepare!=='function' ||
       !(auth instanceof Set) || !(media instanceof Set))
      throw Error('qa_admin_invalid_adapters');
    this.db=db;
    this.executor=new QaDeletionRunner({
      db,journal,media,auth,lease,external
    });
  }
  async execute({order,failBeforeEffect=null,failAfterEffect=null}={}){
    guardEnv();
    validateOrder(order);
    // Fresh, account-bound request is mandatory even on a resumed QA journal.
    const record=await getDoc(doc(this.db,'account_deletion_requests/'+UID));
    if(!record.exists() || record.data()?.status!=='requested')
      throw Error('qa_admin_verified_request_missing');
    const result=await this.executor.run({
      approved:true,failBeforeEffect,failAfterEffect
    });
    return Object.freeze({
      status:'qa_fixture_admin_workflow_finished',
      completedPhases:result.completed.length,
      productionReady:false,
      publicAccountDeleted:false,
      reviewerIdentityReal:false,
      cloudinaryActuallyDeleted:false,
      firebaseAuthActuallyDeleted:false,
      authEmulatorFixtureExercised:this.executor.external!==null,
      cloudinaryHttpFixtureExercised:this.executor.external!==null
    });
  }
}
