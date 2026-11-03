/**
 * Admission gate for the existing read-only account-deletion preflight.
 * It uses a Firebase Admin Auth verifier and Firestore Admin reads injected
 * by a PRIVATE trusted backend. It never initializes credentials, deploys
 * an endpoint, changes Firestore, or performs account deletion.
 *
 * The Firebase ID token comes from an authenticated founder session; an
 * independent backend must still enforce least-privilege IAM, transport,
 * replay protection, access logs and a real operator approval procedure.
 */
import {validUid} from './plan.js';
import {inspectOperationalDeletionReadSources}
  from './operational-read-preflight.js';

const PROJECT='atrio-catolico';
const ISSUER='https://securetoken.google.com/'+PROJECT;
const ROLE='admins';
const FOUNDER='app_config';
const FREEZE='account_deletion_freeze';
const deny=reason=>{throw Error('founder_read_gate_'+reason);};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const boundedToken=token=>typeof token==='string' &&
  token.length>=100&&token.length<=8192&&
  /^[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+$/.test(token);

function adminSDKReady(auth,db){
  return typeof auth?.verifyIdToken==='function' &&
    typeof auth?.getUser==='function' &&
    typeof db?.collection==='function' &&
    auth.app?.options?.projectId===PROJECT &&
    db.app?.options?.projectId===PROJECT;
}
function validClaims(claims,now){
  const uid=claims?.uid;
  if(!plain(claims)||!validUid(uid)||uid!==claims.sub ||
    claims.aud!==PROJECT||claims.iss!==ISSUER ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    !Number.isSafeInteger(claims.auth_time) ||
    claims.iat>Math.floor(now/1000)+300 ||
    claims.auth_time>Math.floor(now/1000)+300 ||
    claims.exp<=Math.floor(now/1000) ||
    claims.exp<=claims.iat)
    deny('invalid_verified_identity');
  return uid;
}
async function snapshot(db,collection,id){
  try{
    return await db.collection(collection).doc(id).get();
  }catch{deny('access_state_unavailable');}
}

/** Return only a boolean authorization callback, never personal metadata. */
export function createFounderDeletionReadGate({
  idToken,auth,db,clock=Date.now
}={}){
  if(!boundedToken(idToken))deny('invalid_identity_token');
  if(!adminSDKReady(auth,db) || typeof clock!=='function')
    deny('trusted_admin_sdk_required');
  return async function assertAuthorizedRead(){
    if(!adminSDKReady(auth,db))deny('backend_project_changed');
    const start=clock();
    if(!Number.isSafeInteger(start)||start<0)
      deny('invalid_clock');
    let claims;
    try{
      // Admin SDK validates Firebase JWT signature and account revocation.
      // checkRevoked=true must never silently fall back to basic decoding.
      claims=await auth.verifyIdToken(idToken,true);
    }catch{deny('firebase_identity_not_verified');}
    const uid=validClaims(claims,start);
    let user;
    try{user=await auth.getUser(uid);}catch{
      deny('user_state_unavailable');
    }
    if(!user||user.uid!==uid||user.disabled!==false)
      deny('user_disabled_or_changed');
    // Admin SDK bypasses Firestore Rules. The private backend therefore
    // verifies both the active admin role AND founder config explicitly,
    // and refuses an operator whose account has entered deletion freeze.
    const [admin,founder,freeze]=await Promise.all([
      snapshot(db,ROLE,uid),
      snapshot(db,FOUNDER,'founder'),
      snapshot(db,FREEZE,uid)
    ]);
    if(admin?.exists!==true||founder?.exists!==true||
      freeze?.exists!==false||
      admin.data?.()?.enabled!==true ||
      founder.data?.()?.uid!==uid)
      deny('founder_role_or_freeze_denied');
    // No positive answer if identity expires while Admin reads are in flight.
    const end=clock();
    if(!Number.isSafeInteger(end)||end<start||
      claims.exp<=Math.floor(end/1000))
      deny('expired_during_authorization');
    return true;
  };
}

/** Safe composition: the gate is rechecked before/after every remote RPC. */
export async function inspectFounderDeletionReadSources({
  idToken,auth,db,clock=Date.now,
  uid,oauthToken,fetcher,now=new Date()
}={}){
  const assertAuthorizedRead=createFounderDeletionReadGate({
    idToken,auth,db,clock
  });
  return inspectOperationalDeletionReadSources({
    uid,oauthToken,fetcher,now,assertAuthorizedRead
  });
}
