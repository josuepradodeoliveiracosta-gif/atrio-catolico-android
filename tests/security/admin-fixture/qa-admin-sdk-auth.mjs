/**
 * TEST ONLY: real Firebase Admin SDK against a disposable LOCAL Auth Emulator.
 * No credential discovery, service account, production host or deploy route.
 * DO NOT import from Android, cloud workers, main backend, or production.
 *
 * The Admin SDK permits exact UID creation and privileged deleteUser(uid).
 * This tests same-UID Auth/Firestore identity and retry after a delete effect,
 * not production IAM, credential validation or global data coverage.
 */
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';

const PROJECT='demo-atrio-v11';
const FIRESTORE_HOST='127.0.0.1:8089';
const AUTH_HOST='127.0.0.1:9099';
const ALICE='qa-delete-alice';
const BOB='qa-delete-bob';
const MAIL=Object.freeze({
  [ALICE]:'qa-delete-alice@example.invalid',
  [BOB]:'qa-delete-bob@example.invalid'
});
const APP='qa-atrio-admin-sdk-only';

function deny(reason){throw Error('qa_admin_sdk_'+reason);}
function guard(){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIRESTORE_EMULATOR_HOST!==FIRESTORE_HOST ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST!==AUTH_HOST ||
     process.env.FIREBASE_CONFIG ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.GOOGLE_CLOUD_PROJECT ||
     process.env.GCLOUD_PROJECT_ID ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.CLOUDINARY_API_KEY ||
     process.env.CLOUDINARY_CLOUD_NAME ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    deny('live_environment_forbidden');
}
function allowUid(uid){
  if(uid!==ALICE && uid!==BOB)deny('unrecognized_uid');
}
function missing(error){
  return error?.code==='auth/user-not-found';
}
export function createQaAdminSdkAuthAdapter(){
  guard();
  // initializeApp is deliberately local and credential-free. Both Firebase
  // emulators MUST be running before these methods are used.
  const app=initializeApp({projectId:PROJECT},APP);
  const auth=getAuth(app); // reads FIREBASE_AUTH_EMULATOR_HOST at construction
  let destroyed=false;
  const ready=()=>{
    guard();
    if(destroyed)deny('adapter_disposed');
  };
  return Object.freeze({
    async seed(uid){
      ready();
      allowUid(uid);
      const user=await auth.createUser({
        uid,email:MAIL[uid],emailVerified:true,disabled:false
      });
      ready();
      if(user.uid!==uid || user.email!==MAIL[uid])
        deny('created_uid_mismatch');
      return Object.freeze({uid:user.uid});
    },
    async exists(uid){
      ready();
      allowUid(uid);
      try{
        const user=await auth.getUser(uid);
        ready();
        if(user.uid!==uid || user.email!==MAIL[uid])
          deny('account_uid_mismatch');
        return true;
      }catch(error){
        if(missing(error)){
          ready();
          return false;
        }
        throw error;
      }
    },
    async remove(uid){
      ready();
      if(uid!==ALICE)deny('other_user_delete_forbidden');
      // Recheck before an administrative delete. Missing accounts are only
      // accepted after a fresh Auth Emulator lookup; this supports recovery
      // after an effect occurred but its SQLite checkpoint was not committed.
      if(await this.exists(uid)===false){
        if(await this.exists(uid)!==false)
          deny('ambiguous_missing_account');
        return;
      }
      ready();
      await auth.deleteUser(uid);
      ready();
      if(await this.exists(uid)!==false)
        deny('remote_delete_not_confirmed');
    },
    async close(){
      if(!destroyed){
        destroyed=true;
        await deleteApp(app);
      }
    }
  });
}
export const QA_ADMIN_SDK_UIDS=Object.freeze({alice:ALICE,bob:BOB});
