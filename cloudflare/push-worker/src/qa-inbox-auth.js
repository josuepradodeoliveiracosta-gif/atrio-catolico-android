// QA-only end-user authentication. No client-provided principal or cached account state.
import {conversationPushIdentity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';

const {projectId,accounts}=conversationPushIdentity;
const safeInt=value=>Number.isSafeInteger(value)&&value>0;

function claimsFrom(token) {
  try {
    const [header,payload,signature,...extra]=token.split('.');
    if(!header||!payload||!signature||extra.length)return null;
    const parse=part=>JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));
    const metadata=parse(header),claims=parse(payload);
    const now=Math.floor(Date.now()/1000);
    if(metadata.alg!=='RS256'||claims.aud!==projectId||
       claims.iss!=='https://securetoken.google.com/'+projectId||
       typeof claims.sub!=='string'||!Object.hasOwn(accounts,claims.sub)||
       claims.email!==accounts[claims.sub]||claims.email_verified!==true||
       !safeInt(claims.auth_time)||!safeInt(claims.iat)||!safeInt(claims.exp)||
       claims.auth_time>claims.iat||claims.iat>now||claims.exp<=now||
       claims.exp<=claims.iat||claims.firebase?.sign_in_provider==='anonymous')return null;
    return claims;
  }catch{return null;}
}

export async function verifyQaInboxIdentity(request,env) {
  const token=/^Bearer ([A-Za-z0-9._-]{100,5000})$/.exec(request.headers.get('authorization')||'')?.[1];
  if(!token)return null;
  const claims=claimsFrom(token);
  if(!claims)return null;
  if(typeof env.FIREBASE_WEB_API_KEY!=='string'||!env.FIREBASE_WEB_API_KEY)throw Error('qa_auth_unavailable');
  // Identity Toolkit validates the exact signed ID token. Never trust decoded claims alone.
  const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+
    encodeURIComponent(env.FIREBASE_WEB_API_KEY),{
    method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
    body:JSON.stringify({idToken:token})
  });
  if(response.status===400||response.status===401||response.status===403)return null;
  if(!response.ok)throw Error('qa_auth_unavailable');
  const body=await response.json();
  if(!Array.isArray(body.users)||body.users.length!==1)return null;
  const account=body.users[0];
  if(!account||account.disabled===true||account.localId!==claims.sub||
     account.emailVerified!==true||account.email!==accounts[claims.sub]||
     typeof account.validSince!=='string'||!/^\d{1,16}$/.test(account.validSince))return null;
  const validSince=Number(account.validSince);
  // auth_time is the original sign-in, not token refresh (iat).
  // Missing/malformed revocation evidence must fail closed.
  if(!Number.isSafeInteger(validSince)||validSince<0||claims.auth_time<validSince)return null;
  return claims.sub;
}
