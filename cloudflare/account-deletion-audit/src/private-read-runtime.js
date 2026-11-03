/**
 * PRIVATE CLOUD RUN READ-ONLY candidate, NOT a deployed service / route.
 * Binds a real Firebase Admin app to the existing founder authorization
 * gate and read-only Firestore REST preflight.
 *
 * No HTTP listener, no service-account key, no credential discovery,
 * no writes, no deletion or release authorization. A separately reviewed
 * Cloud Run IAM Invoker policy, runtime service identity, and two viewer
 * roles are required before any operational deployment.
 */
import {createFounderDeletionReadGate}
  from './founder-admin-read-gate.js';
import {inspectOperationalDeletionReadSources}
  from './operational-read-preflight.js';
import {validUid} from './plan.js';

const PROJECT='atrio-catolico';
const SERVICE='atrio-privacy-review-internal';
// Proposed identity; its existence and IAM roles are NOT verified by code.
const READER='atrio-privacy-reader@'+PROJECT+'.iam.gserviceaccount.com';
const METADATA_URL='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email';
const KEY=/^[a-zA-Z0-9-]{1,128}$/;
const fail=reason=>{throw Error('private_read_runtime_'+reason);};

function allowedRuntime(env){
  return env && env.K_SERVICE===SERVICE &&
    KEY.test(env.K_REVISION||'') &&
    env.GOOGLE_CLOUD_PROJECT===PROJECT &&
    !env.FIREBASE_AUTH_EMULATOR_HOST &&
    !env.FIRESTORE_EMULATOR_HOST &&
    !env.FIREBASE_SERVICE_ACCOUNT_JSON &&
    !env.GOOGLE_APPLICATION_CREDENTIALS &&
    !env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED;
}
function tiedSdk(app,auth,db){
  return app?.options?.projectId===PROJECT &&
    auth?.app===app && db?.app===app &&
    typeof auth?.verifyIdToken==='function' &&
    typeof auth?.getUser==='function' &&
    typeof db?.collection==='function' &&
    typeof app?.options?.credential?.getAccessToken==='function';
}
async function assertReaderIdentity(metadataFetch){
  let response;
  try{
    response=await metadataFetch(METADATA_URL,{
      method:'GET',redirect:'error',
      headers:{'Metadata-Flavor':'Google'},
      signal:AbortSignal.timeout(1800)
    });
  }catch{fail('runtime_identity_unavailable');}
  if(response?.status!==200 ||
    response.headers?.get?.('Metadata-Flavor')!=='Google')
    fail('runtime_identity_unavailable');
  const length=response.headers.get('Content-Length');
  if(length!==null && (!/^[0-9]{1,3}$/.test(length) ||
     Number(length)>256))fail('runtime_identity_invalid');
  let identity;
  try{identity=await response.text();}catch{
    fail('runtime_identity_unavailable');
  }
  if(typeof identity!=='string' || identity.length>256 ||
     identity.trim()!==READER)
    fail('runtime_identity_mismatch');
}
async function readScopedToken(app){
  let result;
  try{result=await app.options.credential.getAccessToken();}
  catch{fail('backend_oauth_unavailable');}
  const token=result?.access_token;
  if(typeof token!=='string' || token.length<20 ||token.length>4096 ||
    /[\s\x00-\x1f]/.test(token) ||
    !Number.isFinite(result?.expires_in) ||
    result.expires_in<120)
    fail('backend_oauth_invalid');
  return token;
}

/**
 * Construct inside the PRIVATE server process, never an Android app.
 * httpFetch is only used by existing allowlisted Firestore READ transports.
 * The metadata service identity is checked BEFORE the caller is admitted.
 * Authorization is checked again around every Firestore RPC.
 */
export function createPrivateDeletionReadRuntime({
  env=process.env,app,auth,db,
  httpFetch=fetch,metadataFetch=fetch,clock=Date.now
}={}){
  if(!allowedRuntime(env))fail('untrusted_cloud_run_environment');
  if(!tiedSdk(app,auth,db))fail('admin_app_binding_required');
  if(typeof httpFetch!=='function' ||
     typeof metadataFetch!=='function' ||
     typeof clock!=='function')fail('missing_backend_transport');
  return Object.freeze({
    async inspect(request){
      if(!request || Object.getPrototypeOf(request)!==Object.prototype ||
         Object.keys(request).sort().join(',')!=='idToken,uid' ||
         !validUid(request.uid))
        fail('invalid_private_request');
      if(!allowedRuntime(env)||!tiedSdk(app,auth,db))
        fail('runtime_changed');
      await assertReaderIdentity(metadataFetch);
      const authorize=createFounderDeletionReadGate({
        idToken:request.idToken,auth,db,clock
      });
      // Authenticate the founder *before* minting/accessing Google OAuth.
      if(await authorize()!==true)fail('founder_authorization_required');
      const oauthToken=await readScopedToken(app);
      const result=await inspectOperationalDeletionReadSources({
        uid:request.uid,oauthToken,fetcher:httpFetch,
        now:new Date(clock()),assertAuthorizedRead:authorize
      });
      if(await authorize()!==true)fail('founder_authorization_lost');
      // Metadata identity does not prove IAM role bindings. Even when the
      // dry-run completes, the actual production IAM policy, other services,
      // retention and release remain unverified.
      return Object.freeze({
        ...result,privateBackendCodePrepared:true,
        runtimeServiceAccountNameMatched:true,
        cloudRunInvokerIamReviewed:false,
        readOnlyIamRolesIndependentlyVerified:false,
        deletionExecutionEnabled:false,
        accountDeletionAuthorized:false,
        googlePlayReleaseAuthorized:false
      });
    }
  });
}
