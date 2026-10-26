// Emissor FCM para Cloudflare Workers Free. Credenciais SOMENTE em Worker Secrets.
// Recebe eventos autenticados pelo Firebase, confere documentos no Firestore,
// limita destinatários e evita reenvios com Cloudflare D1.
const PROJECT = 'atrio-catolico';
const ROOT = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const MAX_ADMINS = 8;
const MAX_TOKENS = 3;
const MAX_AGE_MS = 5 * 60_000;
const MAX_SUBJECT = 128;

const stringField = (doc, key) => doc?.fields?.[key]?.stringValue ?? '';
const boolField = (doc, key) => doc?.fields?.[key]?.booleanValue === true;
const timeField = (doc, key) => Date.parse(doc?.fields?.[key]?.timestampValue || '') || 0;
const uidPart = value => typeof value === 'string' && value.length > 0
  && value.length <= MAX_SUBJECT && /^[A-Za-z0-9_-]+$/.test(value);
const recent = time => time > Date.now() - MAX_AGE_MS && time < Date.now() + 60_000;
const response = (status, message) => new Response(JSON.stringify({status:message}),
  {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const enc = raw => encodeURIComponent(raw);
function urlSafeBase64(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (const v of bytes) binary += String.fromCharCode(v);
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/g,'');
}

let cachedOAuth = null;
let cachedSigningKey = null;
async function oauth(env) {
  if (cachedOAuth && cachedOAuth.expiresAt > Date.now() + 60_000) return cachedOAuth.token;
  const service = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (service.project_id !== PROJECT || !service.client_email || !service.private_key)
    throw Error('Configuração de identidade inválida');
  const privateDer = Uint8Array.from(atob(service.private_key
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')), c=>c.charCodeAt(0));
  const privateKey = cachedSigningKey || await crypto.subtle.importKey('pkcs8', privateDer,
    {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'},false,['sign']);
  cachedSigningKey = privateKey;
  const issued = Math.floor(Date.now()/1000);
  const header = urlSafeBase64(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim = urlSafeBase64(JSON.stringify({
    iss:service.client_email,sub:service.client_email,
    scope:'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
    aud:'https://oauth2.googleapis.com/token',iat:issued,exp:issued+3000,
  }));
  const signed = new TextEncoder().encode(header+'.'+claim);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,signed);
  const jwt = header+'.'+claim+'.'+urlSafeBase64(signature);
  const token = await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}),
  });
  if (!token.ok) throw Error('Falha de autenticação de serviço');
  const payload = await token.json();
  if (!payload.access_token) throw Error('Token de serviço ausente');
  cachedOAuth = {token:payload.access_token,
    expiresAt:Date.now() + Math.min(50*60_000,Math.max(120_000,Number(payload.expires_in||3600)*1000-120_000))};
  return cachedOAuth.token;
}

async function verifyIdentity(req,env) {
  const auth = req.headers.get('Authorization') || '';
  const match = /^Bearer ([A-Za-z0-9._-]{100,5000})$/.exec(auth);
  if (!match) return null;
  const validated = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+
    enc(env.FIREBASE_WEB_API_KEY),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({idToken:match[1]}),
  });
  if (!validated.ok) return null;
  const data = await validated.json();
  const account = data.users?.[0];
  return account && !account.disabled && uidPart(account.localId) ? account.localId : null;
}

async function firestoreGet(token, path) {
  const res = await fetch(ROOT+'/'+path,{headers:{Authorization:'Bearer '+token}});
  if (res.status===404) return null;
  if (!res.ok) throw Error('Firestore indisponível');
  return res.json();
}
async function firestoreList(token, path, max) {
  const res = await fetch(ROOT+'/'+path+'?pageSize='+max,
    {headers:{Authorization:'Bearer '+token}});
  if (!res.ok) throw Error('Consulta Firestore indisponível');
  const data = await res.json();
  if (data.nextPageToken) throw Error('Limite de consulta excedido');
  return data.documents || [];
}
async function adminUids(token, origin) {
  const docs = await firestoreList(token,'admins',MAX_ADMINS+1);
  if (docs.length > MAX_ADMINS) throw Error('Limite administrativo excedido');
  return docs.filter(x=>boolField(x,'enabled')).map(x=>x.name.split('/').pop())
    .filter(uid=>uidPart(uid)&&uid!==origin);
}

export async function resolveEvent(event, actor, token) {
  if (!event || typeof event!=='object' || Array.isArray(event)) return null;
  const type = event.type;
  if (type==='reply') {
    if (!uidPart(event.postId)||!uidPart(event.replyId)) return null;
    const post = await firestoreGet(token,'posts/'+enc(event.postId));
    const reply = await firestoreGet(token,'posts/'+enc(event.postId)+'/replies/'+enc(event.replyId));
    if (!post||!reply||stringField(reply,'uid')!==actor||!recent(timeField(reply,'createdAt'))) return null;
    const owner=stringField(post,'uid');
    if(!uidPart(owner)||owner===actor) return null;
    const notice=await firestoreGet(token,'users/'+enc(owner)+'/notifications/'+enc(event.replyId));
    if(!notice||stringField(notice,'actorUid')!==actor
      ||stringField(notice,'postId')!==event.postId
      ||stringField(notice,'replyId')!==event.replyId
      ||boolField(notice,'read')) return null;
    return {key:'reply:'+event.postId+':'+event.replyId,kind:'reply',recipients:[owner]};
  }
  if (type==='badge_request') {
    const request=await firestoreGet(token,'badge_requests/'+enc(actor));
    if (!request||stringField(request,'status')!=='pending'
      ||!recent(timeField(request,'createdAt'))) return null;
    return {key:'request:'+actor+':'+timeField(request,'createdAt'),
      kind:'admin',recipients:await adminUids(token,actor)};
  }
  if (type==='badge_result') {
    if(!uidPart(event.targetUid)||event.targetUid===actor) return null;
    const [admin,request] = await Promise.all([
      firestoreGet(token,'admins/'+enc(actor)),
      firestoreGet(token,'badge_requests/'+enc(event.targetUid)),
    ]);
    if(!admin||!boolField(admin,'enabled')||!request
      ||!['approved','rejected'].includes(stringField(request,'status'))
      ||stringField(request,'reviewedBy')!==actor
      ||!recent(timeField(request,'reviewedAt'))) return null;
    return {key:'review:'+event.targetUid+':'+timeField(request,'reviewedAt'),
      kind:'review',recipients:[event.targetUid]};
  }
  if(type==='report'){
    if(!uidPart(event.reportId)) return null;
    const doc=await firestoreGet(token,'reports/'+enc(event.reportId));
    if(!doc||stringField(doc,'reporterUid')!==actor
      ||!recent(timeField(doc,'createdAt'))
      ||(stringField(doc,'status') && stringField(doc,'status')!=='pending')) return null;
    return {key:'report:'+event.reportId,kind:'admin',recipients:await adminUids(token,actor)};
  }
  return null;
}

async function devices(token,uid) {
  const docs=await firestoreList(token,'users/'+enc(uid)+'/pushDevices',MAX_TOKENS+1);
  if(docs.length>MAX_TOKENS) throw Error('Limite de dispositivos excedido');
  return docs.map(x=>({token:stringField(x,'token'),time:timeField(x,'updatedAt')}))
    .filter(x=>x.token.length>=20&&x.token.length<=4096
      &&x.time>Date.now()-60*86400_000&&x.time<=Date.now()+60_000);
}

async function send(token,device,uid,kind) {
  return fetch('https://fcm.googleapis.com/v1/projects/'+PROJECT+'/messages:send',{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({message:{
      token:device, data:{uid,kind},
      android:{priority:'HIGH',ttl:'3600s'},
    }}),
  });
}

export default {
  async fetch(request, env) {
    if(request.method!=='POST'||new URL(request.url).pathname!=='/event')
      return response(404,'not_found');
    if(!env.PUSH_DB||!env.FIREBASE_WEB_API_KEY||!env.FIREBASE_SERVICE_ACCOUNT_JSON)
      return response(503,'not_configured');
    if(Number(request.headers.get('content-length')||'0')>512)
      return response(413,'too_large');
    try {
      const uid=await verifyIdentity(request,env);
      if(!uid) return response(401,'unauthorized');
      const raw=await request.text();
      if(raw.length>512) return response(413,'too_large');
      const data=JSON.parse(raw);
      const token=await oauth(env);
      const event=await resolveEvent(data,uid,token);
      if(!event) return response(202,'ignored');
      if(event.recipients.length>MAX_ADMINS) return response(503,'capacity_limit');
      let attempted=0;
      for(const recipient of event.recipients) {
        if(!uidPart(recipient)||recipient===uid) continue;
        const list=await devices(token,recipient);
        if(!list.length) continue;
        // At most once: a network fault may lose a push, not duplicate or spam it.
        const marker=event.key+':'+recipient;
        const record=await env.PUSH_DB.prepare(
          'INSERT OR IGNORE INTO delivered (event_key,created_at) VALUES (?,?)'
        ).bind(marker,Date.now()).run();
        if(!record.meta?.changes) continue;
        for(const target of list) {
          const result=await send(token,target.token,recipient,event.kind);
          attempted++;
          if(!result.ok && result.status>=500) break;
        }
      }
      return response(202,attempted ? 'queued' : 'no_devices_or_duplicate');
    } catch {
      // Não registrar ID tokens, chaves, UID, FCM tokens nem payloads em logs.
      return response(503,'unavailable');
    }
  },
};
