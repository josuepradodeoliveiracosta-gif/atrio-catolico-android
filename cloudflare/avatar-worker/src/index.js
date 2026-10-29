// Átrio Católico 0.19.7 — Worker isolado. NÃO implantar sem autorização.
// Uploads começam autenticados (não entregáveis), são moderados manualmente,
// e só se tornam públicos após aprovação + promoção pelo backend.
const PROJECT = 'atrio-catolico';
const ROOT = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const LIMIT = 5 * 1024 * 1024;
const uidOk = uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
const json = (status, state) => new Response(JSON.stringify({status:state}), {
  status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'}
});
const encode = encodeURIComponent;
const credential = env => 'Basic ' + btoa(env.CLOUDINARY_API_KEY + ':' + env.CLOUDINARY_API_SECRET);
function requireEnv(env) {
  if (!/^[A-Za-z0-9_-]+$/.test(env.CLOUDINARY_CLOUD_NAME || '') ||
      !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET ||
      !env.FIREBASE_WEB_API_KEY || !env.FIREBASE_SERVICE_ACCOUNT_JSON || !env.AVATAR_DB)
    throw Error('missing_configuration');
}
async function verify(request, env) {
  const match = /^Bearer ([A-Za-z0-9._-]{100,5000})$/.exec(request.headers.get('Authorization') || '');
  if (!match) return null;
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' +
    encode(env.FIREBASE_WEB_API_KEY), {method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:match[1]})});
  if (!res.ok) return null;
  const user = (await res.json()).users?.[0];
  return user && !user.disabled && uidOk(user.localId) ? user.localId : null;
}
function base64url(bytes) {
  let result = '';
  for(const item of bytes) result += String.fromCharCode(item);
  return btoa(result).replaceAll('+','-').replaceAll('/','_').replace(/=+$/g,'');
}
let oauthCache;
async function firestoreToken(env) {
  if(oauthCache && oauthCache.expires > Date.now()+120000) return oauthCache.value;
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if(account.project_id !== PROJECT || !account.client_email || !account.private_key)
    throw Error('invalid_service_account');
  const der = Uint8Array.from(atob(account.private_key
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')), x => x.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8',der,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const now = Math.floor(Date.now()/1000);
  const head = base64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const claims = base64url(new TextEncoder().encode(JSON.stringify({
    iss:account.client_email,sub:account.client_email,
    aud:'https://oauth2.googleapis.com/token',
    scope:'https://www.googleapis.com/auth/datastore',iat:now,exp:now+3000
  })));
  const token = head + '.' + claims;
  const sig = base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,
    new TextEncoder().encode(token))));
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:token+'.'+sig})});
  if(!r.ok) throw Error('oauth_failed');
  const data = await r.json();
  if(!data.access_token) throw Error('oauth_missing');
  oauthCache = {value:data.access_token,expires:Date.now()+Math.min(2700000,(data.expires_in||3600)*1000)};
  return oauthCache.value;
}
async function firestoreGet(env, uid) {
  const r = await fetch(ROOT+'/profile_photos/'+encode(uid),{
    headers:{Authorization:'Bearer '+await firestoreToken(env)}});
  if(r.status===404) return null;
  if(!r.ok) throw Error('firestore_read_failed');
  const d = await r.json();
  return {photoPublicId:d.fields?.photoPublicId?.stringValue || '',
    photoUrl:d.fields?.photoUrl?.stringValue || ''};
}
async function firestorePut(env, uid, id, url) {
  const r = await fetch(ROOT+'/profile_photos/'+encode(uid),{method:'PATCH',
    headers:{Authorization:'Bearer '+await firestoreToken(env),
      'Content-Type':'application/json'},
    body:JSON.stringify({fields:{
      photoUrl:{stringValue:url},
      photoPublicId:{stringValue:id},
      photoUpdatedAt:{timestampValue:new Date().toISOString()}
    }})});
  if(!r.ok) throw Error('firestore_write_failed');
}
async function firestoreDelete(env, uid) {
  const r=await fetch(ROOT+'/profile_photos/'+encode(uid),{method:'DELETE',
    headers:{Authorization:'Bearer '+await firestoreToken(env)}});
  if(!r.ok && r.status!==404) throw Error('firestore_delete_failed');
}
async function cloudSigned(env, endpoint, parameters, bytes, kind) {
  const data = {...parameters,timestamp:String(Math.floor(Date.now()/1000))};
  const signatureSource=Object.entries(data).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,value])=>key+'='+value).join('&') + env.CLOUDINARY_API_SECRET;
  const digest = await crypto.subtle.digest('SHA-1',new TextEncoder().encode(signatureSource));
  const signature=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const form = new FormData();
  for(const [key,value] of Object.entries(data)) form.append(key,value);
  form.append('api_key',env.CLOUDINARY_API_KEY);
  form.append('signature',signature);
  if(bytes) form.append('file',new Blob([bytes],{type:'image/jpeg'}),'avatar.jpg');
  const response = await fetch('https://api.cloudinary.com/v1_1/'+
    env.CLOUDINARY_CLOUD_NAME+'/image/'+endpoint,{method:'POST',body:form});
  if(!response.ok) throw Error('cloudinary_'+kind+'_failed');
  return response.json();
}
async function cloudGet(env, id, type='authenticated') {
  const url='https://api.cloudinary.com/v1_1/'+env.CLOUDINARY_CLOUD_NAME+
    '/resources/image/'+type+'/'+id.split('/').map(encode).join('/');
  const r=await fetch(url,{headers:{Authorization:credential(env)}});
  if(r.status===404) return null;
  if(!r.ok) throw Error('cloudinary_check_failed');
  return r.json();
}
async function destroy(env, id, type) {
  if(!id || !/^atrio-avatares\/[A-Za-z0-9_-]{1,128}\/[0-9a-f-]{36}$/.test(id)) return;
  await cloudSigned(env,'destroy',{public_id:id,type,invalidate:'true'},null,'destroy');
}
async function boundedBytes(request) {
  const length=Number(request.headers.get('Content-Length')||'0');
  if(length > LIMIT || request.headers.get('Content-Type')?.split(';')[0] !== 'image/jpeg')
    throw Error('invalid_image');
  const reader=request.body?.getReader();
  if(!reader) throw Error('invalid_image');
  const chunks=[];let count=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();
      if(done) break;
      count+=value.byteLength;
      if(count>LIMIT) {await reader.cancel();throw Error('invalid_image');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const output=new Uint8Array(count);let off=0;
  for(const c of chunks){output.set(c,off);off+=c.length;}
  if(count<100 || output[0]!==0xff || output[1]!==0xd8 ||
    output[count-2]!==0xff || output[count-1]!==0xd9) throw Error('invalid_image');
  return output;
}
async function quota(env, uid) {
  // Janela de 60 s por UID; UPDATE condicional atômico impede uploads paralelos.
  const now=Date.now();
  const r=await env.AVATAR_DB.prepare(
    'INSERT INTO avatar_rate (uid,next_at) VALUES (?,?) ON CONFLICT(uid) DO UPDATE SET next_at=excluded.next_at WHERE avatar_rate.next_at <= ?'
  ).bind(uid,now+60000,now).run();
  return r.meta?.changes === 1;
}
function publicUrl(env, result) {
  // Não confiar no endereço fornecido pelo cliente; compor URL do recurso do backend.
  if(!Number.isSafeInteger(result.version) || !/^atrio-avatares\/[A-Za-z0-9_-]{1,128}\/[0-9a-f-]{36}$/.test(result.public_id))
    throw Error('cloudinary_invalid_response');
  return 'https://res.cloudinary.com/'+env.CLOUDINARY_CLOUD_NAME+
    '/image/upload/c_fill,w_400,h_400,q_auto,f_auto/v'+result.version+
    '/'+result.public_id+'.jpg';
}
async function upload(env, uid, request) {
  if(!(await quota(env,uid))) return json(429,'rate_limited');
  const bytes=await boundedBytes(request);
  const id='atrio-avatares/'+uid+'/'+crypto.randomUUID();
  // Armazenamento authenticated: nem original nem derivados são acessíveis sem assinatura.
  const result=await cloudSigned(env,'authenticated',{public_id:id,
    overwrite:'false',moderation:'manual'},bytes,'upload');
  if(result.public_id!==id || result.type!=='authenticated') throw Error('cloudinary_identity_mismatch');
  const previous=await env.AVATAR_DB.prepare('SELECT public_id FROM avatar_pending WHERE uid=?').bind(uid).first();
  await env.AVATAR_DB.prepare('INSERT INTO avatar_pending (uid,public_id,created_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET public_id=excluded.public_id, created_at=excluded.created_at')
    .bind(uid,id,Date.now()).run();
  if(previous?.public_id && previous.public_id!==id) {
    try {await destroy(env,previous.public_id,'authenticated');} catch {}
  }
  return json(202,'pending_moderation');
}
async function status(env,uid) {
  const pending=await env.AVATAR_DB.prepare('SELECT public_id FROM avatar_pending WHERE uid=?').bind(uid).first();
  if(!pending) return json(200,'no_pending');
  const id=pending.public_id;
  if(!id.startsWith('atrio-avatares/'+uid+'/')) return json(500,'invalid_pending');
  const item=await cloudGet(env,id);
  if(!item) return json(410,'missing');
  const moderate=item.moderation?.find(x=>x.kind==='manual');
  if(moderate?.status==='rejected') return json(200,'rejected');
  if(moderate?.status!=='approved') return json(200,'pending_moderation');
  // Aprovação verificável no Cloudinary, jamais pelo cliente.
  const promoted=await cloudSigned(env,'rename',{from_public_id:id,to_public_id:id,
    type:'authenticated',to_type:'upload',overwrite:'false'},null,'promote');
  if(promoted.type!=='upload'||promoted.public_id!==id) throw Error('promotion_failed');
  const before=await firestoreGet(env,uid);
  try {
    await firestorePut(env,uid,id,publicUrl(env,promoted));
  } catch(error) {
    // Evita referência pública a uma imagem cuja gravação falhou.
    try{await destroy(env,id,'upload');}catch{}
    throw error;
  }
  await env.AVATAR_DB.prepare('DELETE FROM avatar_pending WHERE uid=? AND public_id=?').bind(uid,id).run();
  if(before?.photoPublicId && before.photoPublicId!==id) {
    try {await destroy(env,before.photoPublicId,'upload');} catch {}
  }
  return json(200,'published');
}
async function remove(env,uid) {
  const before=await firestoreGet(env,uid);
  const pending=await env.AVATAR_DB.prepare('SELECT public_id FROM avatar_pending WHERE uid=?').bind(uid).first();
  await firestoreDelete(env,uid);
  await env.AVATAR_DB.prepare('DELETE FROM avatar_pending WHERE uid=?').bind(uid).run();
  if(before?.photoPublicId) {try{await destroy(env,before.photoPublicId,'upload');}catch{}}
  if(pending?.public_id) {try{await destroy(env,pending.public_id,'authenticated');}catch{}}
  return json(200,'removed');
}
export default {
  async fetch(request,env) {
    const pathname=new URL(request.url).pathname;
    if(!['/avatar/upload','/avatar/status','/avatar'].includes(pathname))
      return json(404,'not_found');
    if((pathname==='/avatar/upload' && request.method!=='POST') ||
      (pathname==='/avatar/status' && request.method!=='GET') ||
      (pathname==='/avatar' && request.method!=='DELETE'))
      return json(405,'method_not_allowed');
    try{
      requireEnv(env);
      const uid=await verify(request,env);
      if(!uid) return json(401,'unauthorized');
      if(pathname==='/avatar/upload') return await upload(env,uid,request);
      if(pathname==='/avatar/status') return await status(env,uid);
      return await remove(env,uid);
    } catch (error) {
      if(error.message==='invalid_image') return json(413,'invalid_image');
      return json(503,'temporarily_unavailable');
    }
  }
};
