/**
 * QA-only, loopback-only external adapters. NOT a production administrator.
 *
 * Authentication: real Firebase Authentication Emulator, using its REST
 * email/password session and SELF-DELETE endpoints. This tests remote
 * lifecycle/failure/reconciliation but DOES NOT test Admin SDK privileges.
 * Cloudinary: a local Node HTTP fixture pretending to destroy images.
 *
 * NEVER accept client-supplied UID, URL, credentials, project or paths.
 * Never import this module into any deployed Worker, Android code or app.
 */
const UID='qa-delete-alice';
const BOB='qa-delete-bob';
const PROJECT='demo-atrio-v11';
const AUTH_HOST='127.0.0.1:9099';
const FIRESTORE_HOST='127.0.0.1:8089';
const AUTH_ORIGIN='http://'+AUTH_HOST;
const IDENTITY=AUTH_ORIGIN+'/identitytoolkit.googleapis.com/v1/';
const KEY='qa-emulator-only';
const PASSWORD='qa-only-password-12587';
const CLOUD_PATH='/v1_1/qa-atrio-only/image/destroy';
const PHOTO='atrio-avatares/qa-delete-alice/123e4567-e89b-42d3-a456-426614174001';
const BOB_PHOTO='atrio-avatares/qa-delete-bob/123e4567-e89b-42d3-a456-426614174002';
const EMAIL=Object.freeze({
  [UID]:'qa-delete-alice@example.invalid',
  [BOB]:'qa-delete-bob@example.invalid'
});
function fail(code){throw Error('qa_external_'+code);}
function guard(){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIRESTORE_EMULATOR_HOST!==FIRESTORE_HOST ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST!==AUTH_HOST ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.CLOUDINARY_API_KEY ||
     process.env.CLOUDINARY_CLOUD_NAME ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    fail('non_demo_environment');
}
function checkUid(uid){
  if(uid!==UID && uid!==BOB)fail('unrecognized_uid');
}
function checkResponse(r) {
  if(!r || typeof r.status!=='number' || typeof r.json!=='function')
    fail('invalid_http_response');
}
async function authPost(fetcher,path,payload){
  guard();
  const url=IDENTITY+path+'?key='+KEY; // hard-coded HTTP loopback only.
  const response=await fetcher(url,{
    method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(5000)
  });
  checkResponse(response);
  const raw=await response.text();
  if(raw.length>12000)fail('oversized_auth_response');
  let body;
  try{body=JSON.parse(raw);}catch{fail('invalid_auth_response');}
  return {status:response.status,body};
}
function validSession(data,uid) {
  return data.status===200 && data.body?.localId===uid &&
    typeof data.body.idToken==='string' &&
    data.body.idToken.length>30;
}
function errorIs(data,code){
  return data.status===400 && data.body?.error?.message===code;
}
/**
 * The QA emulated user is created with a fixed localId. Emulator may reject
 * that in some versions; this intentionally FAILS, never maps another UID.
 */
export function createQaAuthEmulatorAdapter(fetcher=fetch){
  if(typeof fetcher!=='function')fail('invalid_transport');
  guard();
  return Object.freeze({
    async seed(uid){
      guard();checkUid(uid);
      const r=await authPost(fetcher,'accounts:signUp',{
        email:EMAIL[uid],password:PASSWORD,localId:uid,returnSecureToken:true
      });
      if(!validSession(r,uid))fail('auth_seed_uid_mismatch');
    },
    async exists(uid){
      guard();checkUid(uid);
      const r=await authPost(fetcher,'accounts:signInWithPassword',{
        email:EMAIL[uid],password:PASSWORD,returnSecureToken:true
      });
      if(validSession(r,uid))return true;
      if(errorIs(r,'EMAIL_NOT_FOUND') || errorIs(r,'INVALID_LOGIN_CREDENTIALS'))
        return false;
      fail('auth_unknown_read_result');
    },
    async remove(uid){
      guard();
      if(uid!==UID)fail('auth_other_user_delete_denied');
      const session=await authPost(fetcher,'accounts:signInWithPassword',{
        email:EMAIL[uid],password:PASSWORD,returnSecureToken:true
      });
      if(errorIs(session,'EMAIL_NOT_FOUND') ||
         errorIs(session,'INVALID_LOGIN_CREDENTIALS')) {
        // Ambiguous missing account: reconcile it explicitly in fresh read.
        if(await this.exists(uid)===false)return;
        fail('auth_ambiguous_missing');
      }
      if(!validSession(session,uid))fail('auth_before_delete_unverified');
      const deletion=await authPost(fetcher,'accounts:delete',{
        idToken:session.body.idToken
      });
      if(deletion.status!==200 || deletion.body?.error)
        fail('auth_delete_unconfirmed');
      if(await this.exists(uid)!==false)fail('auth_absence_unverified');
    }
  });
}
function validateBase(base){
  if(typeof base!=='string')fail('invalid_media_base');
  let url;
  try{url=new URL(base);}catch{fail('invalid_media_base');}
  if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' ||
     !/^[1-9][0-9]{1,4}$/.test(url.port) ||
     Number(url.port)>65535 || url.pathname!=='/' ||
     url.username || url.password || url.search || url.hash)
    fail('nonlocal_media_endpoint');
  if(Number(url.port)===9099 || Number(url.port)===8089)
    fail('reserved_emulator_port');
  return url.origin;
}
export function createQaCloudinaryHttpAdapter(baseUrl,fetcher=fetch){
  guard();
  if(typeof fetcher!=='function')fail('invalid_transport');
  const base=validateBase(baseUrl);
  async function request(method,uid,id){
    guard();
    if(uid!==UID)fail('media_other_user_denied');
    if(id!==PHOTO)fail('media_unapproved_asset');
    const url=method==='POST'?base+CLOUD_PATH:
      base+'/qa-assets/'+encodeURIComponent(id);
    const response=await fetcher(url,{
      method,redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{Accept:'application/json','Content-Type':'application/json'},
      ...(method==='POST'?{body:JSON.stringify({
        public_id:id,invalidate:true,fixtureUid:uid
      })}:{})
    });
    checkResponse(response);
    if(response.status!==200)fail('media_http_failure');
    const raw=await response.text();
    if(raw.length>2000)fail('media_response_too_large');
    let data;
    try{data=JSON.parse(raw);}catch{fail('invalid_media_response');}
    return data;
  }
  return Object.freeze({
    async exists(uid=UID,id=PHOTO){
      const data=await request('GET',uid,id);
      if(data?.public_id!==id || typeof data.exists!=='boolean')
        fail('media_unknown_read_result');
      return data.exists;
    },
    async remove(uid=UID,id=PHOTO){
      const data=await request('POST',uid,id);
      if(data?.public_id!==id ||
         !['deleted','not_found'].includes(data.result))
        fail('media_unverified_destroy');
      if(await this.exists(uid,id)!==false)
        fail('media_still_present');
    }
  });
}
export const QA_EXTERNAL_UID=UID;
export const QA_EXTERNAL_BOB=BOB;
export const QA_EXTERNAL_PHOTO=PHOTO;
export const QA_EXTERNAL_BOB_PHOTO=BOB_PHOTO;
export const QA_EXTERNAL_MEDIA_PATH=CLOUD_PATH;
