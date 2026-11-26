// Structural rejection ONLY. Google authenticates the identical token.
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
const positive=x=>Number.isSafeInteger(x)&&x>0;
function decode(part){
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(
 atob(part.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-part.length%4)%4)),c=>c.charCodeAt(0))));
}
export function parseD1NoticeClaims(request){
 const token=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get('Authorization')||'')?.[1];
 if(!token||token.length<100||token.length>5000)return null;
 try{
  const [h,p]=token.split('.'),header=decode(h),c=decode(p),now=Math.floor(Date.now()/1000);
  if(header?.alg!=='RS256'||c?.aud!==identity.projectId||c.iss!=='https://securetoken.google.com/'+identity.projectId||
     !Object.hasOwn(identity.accounts,c.sub)||c.email!==identity.accounts[c.sub]||c.email_verified!==true||
     !positive(c.auth_time)||!positive(c.iat)||!positive(c.exp)||c.auth_time>c.iat||c.iat>now||
     c.exp<=now||c.exp<=c.iat||c.firebase?.sign_in_provider!=='password')return null;
  return {token,uid:c.sub,authTime:c.auth_time};
 }catch{return null}
}
