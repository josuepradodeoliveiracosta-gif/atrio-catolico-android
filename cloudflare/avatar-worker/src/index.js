import {qaSharedMode,qaSharedWorkerRequest,qaSharedResponse}
  from '../../privacy-shared-qa/src/worker-entry.js';
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
export async function cloudSigned(env, endpoint, parameters, bytes, kind) {
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
  if(!response.ok) {
    // Diagnóstico seguro: NÃO retornar resposta bruta do fornecedor, tokens,
    // UID ou assinatura. Permite identificar falha de configuração no app.
    const details=await response.json().catch(()=>({}));
    const message=(String(details?.error?.message||'')+' '+String(response.headers.get('X-Cld-Error')||'')).toLowerCase();
    let code='cloudinary_error_'+response.status;
    if(message.includes('cloud name') || message.includes('cloud_name') || message.includes('cloud not found')) code='cloudinary_environment_not_found';
    else if(message.includes('signature')) code='cloudinary_signature_invalid';
    else if(message.includes('api key') || message.includes('api_key') ||
            message.includes('authorization')) code='cloudinary_credentials_invalid';
    else if(message.includes('moderation')) code='cloudinary_moderation_error';
    else if(message.includes('not found') && response.status===404) code='cloudinary_not_found';
    else if(message.includes('upload preset')) code='cloudinary_preset_error';
    else if(message.includes('file') || message.includes('format')) code='cloudinary_file_error';
    // Não registrar conteúdos privados da resposta do Cloudinary.
    console.warn('atrio_avatar_cloudinary_failure',kind,code);
    const err=new Error('cloudinary_request_failed');
    err.safeCode=code;
    throw err;
  }
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
export async function boundedBytes(request) {
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
// Trava por UID evita que uma remoção concorra com a promoção da mesma foto.
// Não depende de memória local, portanto funciona entre instâncias do Worker.
async function withAvatarLock(env,uid,action) {
  const nonce=crypto.randomUUID();
  const now=Date.now();
  const acquired=await env.AVATAR_DB.prepare(
    'INSERT INTO avatar_mutex (uid,nonce,expires_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET nonce=excluded.nonce,expires_at=excluded.expires_at WHERE avatar_mutex.expires_at < ?'
  ).bind(uid,nonce,now+120000,now).run();
  if(acquired.meta?.changes!==1) return json(409,'avatar_busy');
  try { return await action(); }
  finally {
    await env.AVATAR_DB.prepare('DELETE FROM avatar_mutex WHERE uid=? AND nonce=?')
      .bind(uid,nonce).run();
  }
}

async function quota(env, uid) {
  // Janela de 60 s por UID; UPDATE condicional atômico impede uploads paralelos.
  const now=Date.now();
  const r=await env.AVATAR_DB.prepare(
    'INSERT INTO avatar_rate (uid,next_at) VALUES (?,?) ON CONFLICT(uid) DO UPDATE SET next_at=excluded.next_at WHERE avatar_rate.next_at <= ?'
  ).bind(uid,now+60000,now).run();
  return r.meta?.changes === 1;
}
export function publicUrl(env, result) {
  // Não confiar no endereço fornecido pelo cliente; compor URL do recurso do backend.
  if(!Number.isSafeInteger(result.version) || !/^atrio-avatares\/[A-Za-z0-9_-]{1,128}\/[0-9a-f-]{36}$/.test(result.public_id))
    throw Error('cloudinary_invalid_response');
  return 'https://res.cloudinary.com/'+env.CLOUDINARY_CLOUD_NAME+
    '/image/upload/c_fill,w_400,h_400,q_auto,f_auto/v'+result.version+
    '/'+result.public_id+'.jpg';
}
/**
 * Compatibilidade de endpoints do Cloudinary: algumas configurações rejeitam
 * /image/authenticated com 404. Alternativa POST /image/upload com delivery
 * type=authenticated assinado; NUNCA aceitar/publicar resposta type=upload.
 */
export async function uploadProtected(env,id,bytes) {
  const opts={public_id:id,overwrite:'false',moderation:'manual'};
  let result;
  try {
    result=await cloudSigned(env,'authenticated',opts,bytes,'upload');
  } catch(error) {
    if(!['cloudinary_error_404','cloudinary_not_found'].includes(error.safeCode)) throw error;
    // Envio alternativo assinado; o tipo de entrega faz parte da assinatura.
    result=await cloudSigned(env,'upload',{...opts,type:'authenticated'},bytes,'upload');
  }
  if(result?.public_id!==id || result?.type!=='authenticated' ||
      !result.moderation?.some(m=>m.kind==='manual' && m.status==='pending')) {
    // Falhar fechado. Se o fornecedor ignorar o tipo de entrega, excluir
    // imediatamente o recurso criado antes de qualquer publicação.
    const returnedId=result?.public_id;
    if(returnedId===id && ['upload','authenticated'].includes(result?.type)) {
      try {await destroy(env,id,result.type);}catch{}
    }
    const safetyError=new Error('cloudinary_protection_failed');
    safetyError.safeCode='cloudinary_protection_failed';
    throw safetyError;
  }
  return result;
}
async function upload(env, uid, request) {
  if(!(await quota(env,uid))) return json(429,'rate_limited');
  const bytes=await boundedBytes(request);
  const id='atrio-avatares/'+uid+'/'+crypto.randomUUID();
  const result=await uploadProtected(env,id,bytes);
  const previous=await env.AVATAR_DB.prepare('SELECT public_id FROM avatar_pending WHERE uid=?').bind(uid).first();
  try {
    await env.AVATAR_DB.prepare('INSERT INTO avatar_pending (uid,public_id,created_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET public_id=excluded.public_id, created_at=excluded.created_at')
      .bind(uid,id,Date.now()).run();
  } catch(error) {
    // Evitar um upload órfão quando o registro D1 falhar.
    try { await destroy(env,id,'authenticated'); } catch {}
    throw error;
  }
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
async function isModerator(env,uid) {
  const r=await fetch(ROOT+'/admins/'+encode(uid),{
    headers:{Authorization:'Bearer '+await firestoreToken(env)}});
  if(r.status===404) return false;
  if(!r.ok) throw Error('admin_lookup_failed');
  return (await r.json()).fields?.enabled?.booleanValue === true;
}
// Moderação administrativa de avatares: o cliente nunca recebe segredos Cloudinary
// ou URL assinada da imagem protegida. Cada endpoint revalida o Firebase e admins/{uid}.
async function moderationQueue(env, actor) {
  if(!(await isModerator(env,actor))) return json(403,'forbidden');
  const records=await env.AVATAR_DB.prepare(
    'SELECT uid,public_id,created_at FROM avatar_pending ORDER BY created_at DESC LIMIT 40'
  ).all();
  const photos=[];
  for(const row of records.results||[]) {
    if(!uidOk(row.uid) || !validPendingId(row.uid,row.public_id)) continue;
    const image=await cloudGet(env,row.public_id);
    if(!image || image.type!=='authenticated') continue;
    const state=image.moderation?.find(m=>m.kind==='manual')?.status;
    if(state!=='pending' && state!=='approved') continue;
    photos.push({uid:row.uid,createdAt:Number(row.created_at)||0,
      revision:row.public_id.split('/').at(-1),status:state});
  }
  return new Response(JSON.stringify({photos}),{status:200,headers:{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'}});
}
function validPendingId(uid,id) {
  return uidOk(uid) && typeof id==='string' &&
    new RegExp('^atrio-avatares/'+uid+'/[0-9a-f-]{36}$').test(id);
}
// A revisão não autoriza a leitura; impede decisões sobre fotos trocadas.
function validAvatarRevision(revision) {
  return typeof revision==='string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(revision);
}
function matchesRevision(uid,id,revision) {
  return validPendingId(uid,id) && validAvatarRevision(revision) &&
    id.endsWith('/'+revision);
}
async function moderationPreview(env,actor,request) {
  if(!(await isModerator(env,actor))) return json(403,'forbidden');
  const params=new URL(request.url).searchParams;
  const uid=params.get('uid')||'';
  const revision=params.get('revision')||'';
  if(!uidOk(uid) || !validAvatarRevision(revision)) return json(400,'invalid_request');
  const record=await env.AVATAR_DB.prepare(
    'SELECT public_id FROM avatar_pending WHERE uid=?'
  ).bind(uid).first();
  if(!record || !matchesRevision(uid,record.public_id,revision)) return json(409,'review_conflict');
  const image=await cloudGet(env,record.public_id);
  if(!image || image.type!=='authenticated' ||
    image.moderation?.find(m=>m.kind==='manual')?.status!=='pending') return json(404,'not_found');
  // URL assinada fornecida pela própria Admin API; nunca devolvê-la ao aplicativo.
  const signed=String(image.secure_url||'');
  const u=new URL(signed);
  if(u.protocol!=='https:' || u.hostname!=='res.cloudinary.com' ||
    !u.pathname.startsWith('/'+env.CLOUDINARY_CLOUD_NAME+'/image/authenticated/s--') ||
    !u.pathname.includes('/'+record.public_id+'.') || u.search) return json(503,'preview_unavailable');
  const response=await fetch(signed,{redirect:'manual',headers:{Accept:'image/jpeg'}});
  if(response.status!==200 || !response.headers.get('content-type')?.startsWith('image/') ||
     Number(response.headers.get('content-length')||0)>350000) return json(503,'preview_unavailable');
  const data=await response.arrayBuffer();
  if(data.byteLength<100 || data.byteLength>350000) return json(503,'preview_unavailable');
  return new Response(data,{headers:{
    'Content-Type':'image/jpeg','Cache-Control':'private, no-store, max-age=0',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
async function moderationReview(env,actor,request) {
  if(!(await isModerator(env,actor))) return json(403,'forbidden');
  if(Number(request.headers.get('content-length')||0)>384) return json(413,'invalid_request');
  const raw=await request.text();
  if(raw.length>384) return json(413,'invalid_request');
  let payload;
  try {payload=JSON.parse(raw);} catch {return json(400,'invalid_request');}
  const uid=payload?.uid;
  const revision=payload?.revision;
  const action=payload?.action;
  const reason=payload?.reason;
  if(!uidOk(uid) || !validAvatarRevision(revision) ||
    !['approved','rejected'].includes(action) ||
    typeof reason!=='string' || reason.trim().length<5 || reason.length>100)
    return json(400,'invalid_request');
  return withAvatarLock(env,uid,async()=>{
    const record=await env.AVATAR_DB.prepare(
      'SELECT public_id FROM avatar_pending WHERE uid=?'
    ).bind(uid).first();
    if(!record || !matchesRevision(uid,record.public_id,revision))
      return json(409,'review_conflict');
    const image=await cloudGet(env,record.public_id);
    if(!image || image.type!=='authenticated' || image.public_id!==record.public_id)
      return json(409,'review_conflict');
    const current=image.moderation?.find(m=>m.kind==='manual')?.status;
    if(current!== 'pending' && !(current==='approved' && action==='approved'))
      return json(409,'review_conflict');
    if(current==='pending') {
      const url='https://api.cloudinary.com/v1_1/'+env.CLOUDINARY_CLOUD_NAME+
        '/resources/image/authenticated/'+record.public_id.split('/').map(encode).join('/');
      const result=await fetch(url,{method:'POST',headers:{
        Authorization:credential(env),'Content-Type':'application/x-www-form-urlencoded'
      },body:new URLSearchParams({moderation_status:action})});
      if(!result.ok) throw Error('cloudinary_review_failed');
      const updated=await result.json();
      if(updated.public_id!==record.public_id ||
        updated.moderation?.find(m=>m.kind==='manual')?.status!==action)
        throw Error('cloudinary_review_unconfirmed');
      await env.AVATAR_DB.prepare(
        'INSERT INTO avatar_moderation (actor_uid,target_uid,reason,created_at) VALUES (?,?,?,?)'
      ).bind(actor,uid,(action==='approved'?'Aprovação: ':'Rejeição: ')+reason.trim(),Date.now()).run();
    }
    if(action==='approved') {
      // A moderação conclui também a publicação, sem precisar do aparelho do dono.
      return status(env,uid);
    }
    return json(200,'rejected');
  });
}

async function moderateRemove(env,actor,request) {
  if(!(await isModerator(env,actor))) return json(403,'forbidden');
  const length=Number(request.headers.get('content-length')||0);
  if(length>256) return json(413,'invalid_request');
  let payload;
  try {
    const raw=await request.text();
    if(raw.length>256) return json(413,'invalid_request');
    payload=JSON.parse(raw);
  } catch {return json(400,'invalid_request');}
  if(!uidOk(payload?.uid) || typeof payload.reason !== 'string' ||
    payload.reason.trim().length < 5 || payload.reason.length>100)
    return json(400,'invalid_request');
  return withAvatarLock(env,payload.uid,async()=>{
    await remove(env,payload.uid);
    await env.AVATAR_DB.prepare(
      'INSERT INTO avatar_moderation (actor_uid,target_uid,reason,created_at) VALUES (?,?,?,?)'
    ).bind(actor,payload.uid,payload.reason.trim(),Date.now()).run();
    return json(200,'moderated');
  });
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
    // Strictly offline shared SQLite fixture; no credentialled avatar paths.
    if(qaSharedMode(env)){
      try{
        const result=await qaSharedWorkerRequest(request,env,'avatar');
        return qaSharedResponse(200,result.status,result.operationId);
      }catch{return qaSharedResponse(503,'qa_shared_worker_denied');}
    }
    const pathname=new URL(request.url).pathname;
    if(!['/avatar/upload','/avatar/status','/avatar','/avatar/moderate',
      '/avatar/moderation/pending','/avatar/moderation/preview','/avatar/moderation/review'].includes(pathname))
      return json(404,'not_found');
    if((pathname==='/avatar/upload' && request.method!=='POST') ||
      (pathname==='/avatar/status' && request.method!=='POST') ||
      (pathname==='/avatar/moderate' && request.method!=='POST') ||
      (pathname==='/avatar/moderation/pending' && request.method!=='GET') ||
      (pathname==='/avatar/moderation/preview' && request.method!=='GET') ||
      (pathname==='/avatar/moderation/review' && request.method!=='POST') ||
      (pathname==='/avatar' && request.method!=='DELETE'))
      return json(405,'method_not_allowed');
    try{
      requireEnv(env);
      const uid=await verify(request,env);
      if(!uid) return json(401,'unauthorized');
      if(pathname==='/avatar/upload') return await withAvatarLock(env,uid,()=>upload(env,uid,request));
      if(pathname==='/avatar/status') return await withAvatarLock(env,uid,()=>status(env,uid));
      if(pathname==='/avatar/moderation/pending') return await moderationQueue(env,uid);
      if(pathname==='/avatar/moderation/preview') return await moderationPreview(env,uid,request);
      if(pathname==='/avatar/moderation/review') return await moderationReview(env,uid,request);
      if(pathname==='/avatar/moderate') return await moderateRemove(env,uid,request);
      return await withAvatarLock(env,uid,()=>remove(env,uid));
    } catch (error) {
      if(error.message==='invalid_image') return json(413,'invalid_image');
      if(typeof error.safeCode==='string' &&
          /^cloudinary_(protection_failed|environment_not_found|not_found|signature_invalid|credentials_invalid|moderation_error|preset_error|file_error|error_[0-9]{3})$/.test(error.safeCode)) {
        return json(502,error.safeCode);
      }
      return json(503,'temporarily_unavailable');
    }
  }
};
