import {validUid, buildAuditPlan} from './plan.js';

const PROJECT = 'atrio-catolico';
const ROOT = 'https://firestore.googleapis.com/v1/projects/' +
  PROJECT + '/databases/(default)/documents';
const json = (code, data) => new Response(JSON.stringify(data), {
  status: code,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  }
});
const base64url = bytes => {
  let value = '';
  for(const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
};

/** Google OAuth service-account JWT; use a read-only IAM principal for audit. */
async function firestoreAccessToken(env, fetcher = fetch) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw Error('service_not_configured');
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (account.project_id !== PROJECT || typeof account.client_email !== 'string' ||
      !account.client_email.endsWith('.gserviceaccount.com') ||
      !account.private_key?.startsWith('-----BEGIN PRIVATE KEY-----')) {
    throw Error('invalid_service_account');
  }
  const der = Uint8Array.from(atob(account.private_key
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '')),
    char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
  const now = Math.floor(Date.now()/1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss:account.client_email, sub:account.client_email,
    aud:'https://oauth2.googleapis.com/token',
    scope:'https://www.googleapis.com/auth/datastore',
    iat:now, exp:now+1800
  })));
  const signature = base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    key, new TextEncoder().encode(header+'.'+payload))));
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:header+'.'+payload+'.'+signature
    })
  });
  if (!response.ok) throw Error('oauth_unavailable');
  const token = (await response.json()).access_token;
  if (typeof token !== 'string' || !token) throw Error('oauth_unavailable');
  return token;
}

async function loadRequest(env, uid, fetcher = fetch) {
  const token = await firestoreAccessToken(env, fetcher);
  const response = await fetcher(ROOT+'/account_deletion_requests/'+encodeURIComponent(uid), {
    method:'GET',
    headers:{Authorization:'Bearer '+token,Accept:'application/json'}
  });
  if(response.status === 404) return null;
  if(!response.ok) throw Error('firestore_read_unavailable');
  return response.json();
}

/** Compare SHA-256 digests without early-exit string comparison. */
async function authorized(req, env) {
  const token = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.get('Authorization') || '');
  const secret = env.ACCOUNT_DELETION_AUDIT_SECRET;
  if (!token || typeof secret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) return false;
  const digest = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const [a,b] = await Promise.all([digest(token[1]),digest(secret)]);
  const aBytes = new Uint8Array(a);
  const bBytes = new Uint8Array(b);
  let mismatch = 0;
  for(let i=0;i<aBytes.length;i++) mismatch |= aBytes[i] ^ bBytes[i];
  return mismatch === 0;
}

/**
 * Admin-only audit. Disabled by default. No user-facing or deletion route.
 * deps injected in tests to avoid reaching Firebase and service credentials.
 */
export async function handleRequest(request, env, deps = {}) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    return json(200, {status:'staging',deletionEnabled:false});
  }
  if (url.pathname !== '/admin/audit' || request.method !== 'POST')
    return json(404, {error:'not_found'});
  if (env.ACCOUNT_DELETION_AUDIT_ENABLED !== 'true')
    return json(503, {error:'audit_not_enabled'});
  if (!(await authorized(request,env))) return json(401, {error:'unauthorized'});
  if (Number(request.headers.get('Content-Length') || 0) > 512)
    return json(413, {error:'invalid_payload'});
  let input;
  try {
    const text = await request.text();
    if (text.length > 512) return json(413,{error:'invalid_payload'});
    input = JSON.parse(text);
  } catch (_) { return json(400,{error:'invalid_payload'}); }
  if (typeof input !== 'object' || Array.isArray(input) || !validUid(input.uid) ||
      Object.keys(input).length !== 1) {
    return json(400,{error:'invalid_payload'});
  }
  try {
    const record = await (deps.loadRequest || loadRequest)(env,input.uid);
    return json(200, buildAuditPlan(input.uid, record));
  } catch (_) {
    // Never log or expose UID, email, tokens, credentials or Firestore response.
    return json(503,{error:'audit_unavailable'});
  }
}

export default {
  fetch(request,env) { return handleRequest(request,env); }
};
