/**
 * QA ONLY. Last-mile permission boundary for the fake Firebase Auth Set.
 * The preflight is asynchronous. Therefore the SQLite fencing lease must be
 * verified AGAIN after it resolves, immediately before the irreversible effect.
 * Never import in Android, deployed Workers or any production executor.
 *
 * Only a fixed fixture UID in the local disposable Firestore Emulator can pass.
 * There is deliberately no Firebase Admin SDK or live Auth API in this module.
 */
import {assertQaReconciled} from './qa-deletion-reconciliation.mjs';

const UID='qa-delete-alice';
const HOST='127.0.0.1:8089';
const PROJECT='demo-atrio-v11';
const EXPECTED='qa_reconciled_known_scopes_only';

function guard({uid,db,auth,media,context,assertLease,reconcile}) {
  if(process.env.FIRESTORE_EMULATOR_HOST!==HOST ||
     process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST &&
       process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')
    throw Error('qa_auth_live_environment_denied');
  if(uid!==UID || !db || !(auth instanceof Set) || !(media instanceof Set) ||
     context?.writesFrozen!==true || typeof assertLease!=='function' ||
     typeof reconcile!=='function')
    throw Error('qa_auth_invalid_fixture_context');
}

/**
 * Reconcile is injected for deterministic timeout tests ONLY. The actual
 * executor always uses assertQaReconciled, which queries the real Firestore
 * Emulator and rejects residual known data.
 */
export async function removeQaAuthAfterReconciliation({
  uid,db,auth,media,context,assertLease,
  reconcile=assertQaReconciled
}={}) {
  guard({uid,db,auth,media,context,assertLease,reconcile});
  assertLease();
  const report=await reconcile({uid,db,auth,media,context,expectedAuth:'either'});
  if(report?.state!==EXPECTED || report.productionReady!==false ||
     report.globalCoverageComplete!==false ||
     report.firebaseAuthActuallyChecked!==false ||
     report.cloudinaryActuallyChecked!==false)
    throw Error('qa_auth_reconciliation_not_confirmed');
  // Important: the earlier lease may have expired WHILE awaiting Firestore.
  // A stale runner must NEVER erase even the fake identity after takeover.
  assertLease();
  auth.delete(uid);
  assertLease();
  return Object.freeze({state:'qa_fake_auth_removed_only',productionReady:false});
}
