/**
 * QA-ONLY integration harness for real, exported Worker code paths.
 *
 * It is NOT imported by any active Worker, endpoint, cron or Android app.
 * Only fixed fictional identities and a mock fetch transport are permitted.
 * NEVER use this in production, even under a feature flag.
 */
import avatarWorker from '../../avatar-worker/src/index.js';
import {reviewCase} from '../../guardian-worker/src/index.js';
import {writeThreadNotices} from '../../push-worker/src/index.js';
import {runQaPrivilegedOperation} from './qa-privileged-write-barrier.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const CASE='guard_'+'a'.repeat(32);
const ROOT='projects/atrio-catolico/databases/(default)/documents';
const PATHS=Object.freeze({
  avatar_status:Object.freeze({kind:'avatar_promote',scope:Object.freeze({ownerUid:A})}),
  guardian_review:Object.freeze({kind:'guardian_review_write',
    scope:Object.freeze({ownerUid:A,actorUid:B})}),
  push_thread_notice:Object.freeze({kind:'push_thread_notice',
    scope:Object.freeze({actorUid:B,recipientUid:A})})
});
const fixtureToken='qa_mock_firebase_id_token_'+'a'.repeat(110);
export const QA_ACTUAL_WORKER_PATHS=Object.freeze(Object.keys(PATHS));
const fakeRequest=()=>new Request('https://qa.invalid/avatar/status',{
  method:'POST',headers:{Authorization:'Bearer '+fixtureToken}
});
const fakeNotice=Object.freeze({
  topic:'atrio_thread_qa',
  recipients:Object.freeze([A]),
  notice:Object.freeze({
    postId:'qa_post',replyId:'qa_reply',
    actorUid:B,actorName:'QA Bruno',createdAt:'2026-10-31T00:00:00Z'
  })
});
const review=Object.freeze({caseId:CASE,action:'confirm',note:'Revisão fictícia sem publicação.'});

function qaGuard(adapter){
  if(process.env.ATRIO_PRIVILEGED_QA_ONLY!=='true'||
     process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    throw Error('qa_worker_harness_environment_denied');
  if(!adapter||typeof adapter!=='object'||Array.isArray(adapter)||
     typeof adapter.fetchMock!=='function'||typeof adapter.verify!=='function')
    throw Error('qa_worker_harness_missing_fake_dependencies');
  if(typeof adapter.db!=='object'||!adapter.db)
    throw Error('qa_worker_harness_missing_fake_db');
}
async function withFakeFetch(mock,action){
  const prior=globalThis.fetch;
  globalThis.fetch=async (...args)=>{
    const url=String(args[0]);
    // Absolutely forbid localhost / unknown origins and outbound requests:
    // only these *literal* official service domains can be stubbed.
    if(![
      'https://identitytoolkit.googleapis.com/',
      'https://firestore.googleapis.com/'
    ].some(prefix=>url.startsWith(prefix)))
      throw Error('qa_unexpected_external_destination');
    return mock(...args);
  };
  try{return await action();}
  finally{globalThis.fetch=prior;}
}

/**
 * The caller cannot specify any UID, kind, target path or arbitrary operation.
 * It selects exactly one existing Worker function using immutable QA fixtures.
 * The barrier is checked BEFORE the real function is invoked. Verifier
 * operates on mock effects only. Unknown outcomes keep pending tickets open.
 */
export async function runQaActualWorkerPath(barrier,path,adapter){
  const selection=PATHS[path];
  if(!selection)throw Error('qa_unknown_worker_path');
  qaGuard(adapter);
  let outcome;
  await runQaPrivilegedOperation(barrier,selection.kind,selection.scope,{
    effect:async()=>{
      outcome=await withFakeFetch(adapter.fetchMock,async()=>{
        if(path==='avatar_status'){
          if(typeof adapter.db.prepare!=='function')
            throw Error('qa_invalid_avatar_db');
          const env={
            CLOUDINARY_CLOUD_NAME:'fakeqa',
            CLOUDINARY_API_KEY:'qa-key',
            CLOUDINARY_API_SECRET:'qa-secret',
            FIREBASE_WEB_API_KEY:'qa-firebase-key',
            FIREBASE_SERVICE_ACCOUNT_JSON:'{}',
            AVATAR_DB:adapter.db
          };
          const result=await avatarWorker.fetch(fakeRequest(),env);
          if(result.status!==200 || (await result.json()).status!=='no_pending')
            throw Error('qa_avatar_actual_path_unexpected');
          return {status:'no_pending'};
        }
        if(path==='guardian_review'){
          if(typeof adapter.db.get!=='function'||
             typeof adapter.db.commit!=='function')
            throw Error('qa_invalid_guardian_db');
          const result=await reviewCase(adapter.db,B,review);
          if(result!=='confirmed')throw Error('qa_guardian_actual_path_unexpected');
          return {status:'confirmed'};
        }
        if(path==='push_thread_notice'){
          await writeThreadNotices('qa_only_mock_token',fakeNotice);
          return {status:'submitted_to_fake_firestore'};
        }
        throw Error('qa_unknown_worker_path');
      });
    },
    verify:async()=>(await adapter.verify(outcome))===true
  });
  return Object.freeze({status:'qa_actual_worker_path_verified',
    kind:selection.kind,productionReady:false});
}
