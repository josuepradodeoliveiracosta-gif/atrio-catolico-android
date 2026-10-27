/**
 * Identidades Firebase Auth reais dos três bots. Nada é exposto por HTTP,
 * Android ou painel do fundador; os JWTs vivem apenas na memória do Worker.
 * A emissão é acionada somente pela fila manual autorizada por conversa.
 */
const PROJECT='atrio-catolico';
const AUDIENCE='https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const IDENTITY_URL='https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=';
const LOOKUP_URL='https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=';

function toBase64url(raw) {
  const input=typeof raw==='string'?new TextEncoder().encode(raw):new Uint8Array(raw);
  let binary='';
  for(const byte of input)binary+=String.fromCharCode(byte);
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/g,'');
}
function requireService(env) {
  const service=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON||'null');
  if(service?.project_id!==PROJECT||
     !/^[^@]+@atrio-catolico\.iam\.gserviceaccount\.com$/.test(service?.client_email||'')||
     !service.private_key?.includes('BEGIN PRIVATE KEY'))throw Error('qa_invalid_service_identity');
  if(!env.FIREBASE_WEB_API_KEY||typeof env.FIREBASE_WEB_API_KEY!=='string')
    throw Error('qa_no_api_key');
  return service;
}
export async function createBotCustomToken(env,uid,at=Date.now()) {
  if(!/^qa_(clara|miguel|lucia)_v19$/.test(uid))
    throw Error('qa_invalid_uid');
  const service=requireService(env);
  const body=service.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const raw=Uint8Array.from(atob(body),c=>c.charCodeAt(0));
  const privateKey=await crypto.subtle.importKey('pkcs8',raw,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const issued=Math.floor(at/1000);
  const header=toBase64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claims=toBase64url(JSON.stringify({
    iss:service.client_email,sub:service.client_email,aud:AUDIENCE,
    iat:issued,exp:issued+3000,uid,claims:{qa_test_account:true},
  }));
  const message=header+'.'+claims;
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    privateKey,new TextEncoder().encode(message));
  return message+'.'+toBase64url(sig);
}
export async function signInQaBot(env,uid) {
  const customToken=await createBotCustomToken(env,uid);
  const url=IDENTITY_URL+encodeURIComponent(env.FIREBASE_WEB_API_KEY);
  const response=await fetch(url,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token:customToken,returnSecureToken:true}),
  });
  if(!response.ok)throw Error('qa_firebase_auth_signin_http_'+response.status);
  const result=await response.json();
  // signInWithCustomToken não inclui localId na resposta REST oficial.
  // A identidade é confirmada abaixo via accounts:lookup com o ID token.
  if(typeof result.idToken!=='string'||result.idToken.length<100)
    throw Error('qa_firebase_auth_missing_id_token');
  // Garante que o usuário foi registrado e não está desativado.
  const validate=await fetch(LOOKUP_URL+encodeURIComponent(env.FIREBASE_WEB_API_KEY),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({idToken:result.idToken}),
  });
  if(!validate.ok)throw Error('qa_firebase_auth_lookup_http_'+validate.status);
  const account=(await validate.json()).users?.[0];
  if(account?.localId!==uid||account.disabled===true)
    throw Error('qa_firebase_auth_disabled_or_mismatch');
  // Nunca registrar, retornar ao cliente ou persistir o ID token.
  return result.idToken;
}
