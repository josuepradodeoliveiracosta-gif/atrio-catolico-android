// Laboratory contract only: not imported by the deployed Worker generator.
// The trusted key resolver must eventually obtain Google signing keys via a
// fixed, reviewed JWKS source; no URLs or keys supplied by the caller.
export const AUTO_AUDIENCE='https://atrio-push-qa-general.atrio-catolico.workers.dev/internal/qa/automatic-event';
const ISSUER='https://accounts.google.com';
const MAX_TOKEN_AGE=300;
const MAX_TOKEN_LIFETIME=3600;
const keyPattern=/^[a-f0-9]{64}$/;
const enc=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const denied=()=>({status:'unauthorized'});
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function decode(segment){
  if(!/^[A-Za-z0-9_-]+$/.test(segment)||segment.length%4===1) throw Error('invalid_encoding');
  const raw=atob(segment.replace(/-/g,'+').replace(/_/g,'/'));
  if(btoa(raw).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')!==segment)
    throw Error('invalid_encoding');
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
const json=s=>JSON.parse(decoder.decode(decode(s)));
const exact=(x,fields)=>isObject(x)&&Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));

// Configured identity is server-only and comes from the reviewed QA runtime
// registration, not the request. The lab supplies synthetic keys and subject.
export function createAutomaticServiceContract({enabled=false,subject,email,resolveKey,now=()=>Date.now()}={}){
  if(enabled!==true) return Object.freeze({async authorize(){return {status:'disabled'}}});
  if(typeof subject!=='string'||!/^\d{6,30}$/.test(subject)||
      typeof email!=='string'||!/^[-a-z0-9]+@atrio-catolico-qa-general\.iam\.gserviceaccount\.com$/.test(email)||
      typeof resolveKey!=='function'||typeof now!=='function')throw Error('invalid_service_configuration');
  return Object.freeze({async authorize({authorization,body}={}){
    try{
      if(!exact(body,['eventKey'])||typeof body.eventKey!=='string'||!keyPattern.test(body.eventKey)||
          typeof authorization!=='string'||authorization.length>8192||
          !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization))return denied();
      const [h,p,s]=authorization.slice(7).split('.');
      const header=json(h);
      if(!isObject(header)||header.alg!=='RS256'||typeof header.kid!=='string'||
          !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)||
          Object.keys(header).some(k=>!['alg','kid','typ'].includes(k))||
          (header.typ!==undefined&&header.typ!=='JWT'))return denied();
      const jwk=await resolveKey(header.kid);
      if(!isObject(jwk)||jwk.kty!=='RSA'||jwk.kid!==header.kid||
          (jwk.alg!==undefined&&jwk.alg!=='RS256')||
          (jwk.use!==undefined&&jwk.use!=='sig')||Object.hasOwn(jwk,'d'))return denied();
      const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
      if(key.algorithm.modulusLength<2048||
          !await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(s),enc.encode(h+'.'+p)))return denied();
      const c=json(p),t=Math.floor(now()/1000);
      if(!isObject(c)||!Number.isSafeInteger(t)||t<=0||
          c.iss!==ISSUER||c.aud!==AUTO_AUDIENCE||c.sub!==subject||
          c.email!==email||c.email_verified!==true||
          !Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)||
          c.iat<=0||c.iat>t||t-c.iat>MAX_TOKEN_AGE||c.exp<=t||
          c.exp<=c.iat||c.exp-c.iat>MAX_TOKEN_LIFETIME||
          (c.nbf!==undefined&&(!Number.isSafeInteger(c.nbf)||c.nbf>t))||
          (c.azp!==undefined&&c.azp!==subject))return denied();
      // A verified bearer is NOT an authorization to send. Replay control
      // belongs to the transactional outbox claim and existing D1 reservation.
      return {status:'authenticated_lab',eventKey:body.eventKey};
    }catch{return denied()}
  }});
}
