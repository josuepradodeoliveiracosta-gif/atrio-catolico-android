/**
 * STAGING-ONLY HMAC protocol for an internal Cloudflare Service Binding.
 * No tokens or private keys committed to git.
 */
export const STAGE_HOST='https://privacy-freeze-stage.internal';
export const STAGE_ID='demo-atrio-v11';
export const STAGE_ROLES=Object.freeze({
  avatar:'STAGE_AVATAR_HMAC',
  guardian:'STAGE_GUARDIAN_HMAC',
  push:'STAGE_PUSH_HMAC',
  admin:'STAGE_ADMIN_HMAC',
  reconciler:'STAGE_RECONCILER_HMAC'
});
const encoder=new TextEncoder();
const bytes=v=>encoder.encode(v);
export function strictStageKey(secret){
  return typeof secret==='string'&&secret.length>=32&&secret.length<=256&&
    /^[\x21-\x7e]+$/.test(secret);
}
export async function stageSignature(secret,{role,timestamp,nonce,path,body}){
  if(!strictStageKey(secret)||!Object.hasOwn(STAGE_ROLES,role)||
    typeof path!=='string'||!path.startsWith('/v1/')||
    typeof body!=='string'||typeof nonce!=='string'||
    !/^\d{13}$/.test(String(timestamp)))throw Error('qa_stage_invalid_signature_input');
  const key=await crypto.subtle.importKey('raw',bytes(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const plain=[STAGE_ID,role,String(timestamp),nonce,path,body].join('\n');
  const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes(plain)));
  return [...mac].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function stageNonceOk(value){
  return typeof value==='string'&&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}
export function stageFixtureUid(value){
  return value==='qa-freeze-alice'||value==='qa-freeze-bob';
}
