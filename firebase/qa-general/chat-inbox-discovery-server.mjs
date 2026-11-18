/**
 * #355: descoberta confiavel de inbox, SEM endpoint remoto / deploy.
 * Somente backend com Admin SDK e verifyIdToken da identidade Firebase QA.
 * O cliente nunca consulta /chats via Rules: essa listagem continua negada.
 */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {peerInboxEntries,reconcilePeerInbox} from './chat-inbox-peer-index.mjs';

const UID=/^[A-Za-z0-9_-]{1,128}$/;
const CHAT=/^[A-Za-z0-9_-]{1,260}$/;
const LEGACY_PAIR='eligible|2026-11-18plus-qa-v1';
const MAX_SCAN=40;
const MAX_LIMIT=20;
const TTL_MS=10*60*1000;
const deny=()=>{throw Error('inbox_access_denied');};
const has=(s)=>s && typeof s.exists==='function' ? s.exists() : !!s?.exists;
const ms=v=>v && typeof v.toMillis==='function' ? v.toMillis() : NaN;

export function validInboxAge(data,acceptedPairs=[LEGACY_PAIR],now=Date.now()) {
  if(!data || typeof data!=='object' || Array.isArray(data) ||
     Object.keys(data).sort().join('|')!=='minimumAge|policyVersion|reviewExpiresAt|status' ||
     data.minimumAge!==18 || !Number.isFinite(ms(data.reviewExpiresAt)) ||
     ms(data.reviewExpiresAt)<=now) return false;
  return acceptedPairs.includes(data.status+'|'+data.policyVersion);
}
function configValid(c) {
  return c?.enabled===true && c?.minorPolicyApproved===true &&
    c?.safetyReviewVersion==='2026-11-safety-v1' &&
    c?.version==='2026-11-v1';
}
function keyValid(k) {return Buffer.isBuffer(k) && k.length===32;}
function seal(key,uid,id,now) {
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,nonce);
  const payload=Buffer.from(JSON.stringify({v:1,uid,id,until:now+TTL_MS}),'utf8');
  const bytes=Buffer.concat([cipher.update(payload),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),bytes]).toString('base64url');
}
function unseal(key,uid,opaque,now) {
  if(typeof opaque!=='string' || opaque.length<48 || opaque.length>2048 ||
     !/^[A-Za-z0-9_-]+$/.test(opaque))deny();
  try{
    const raw=Buffer.from(opaque,'base64url');
    const decipher=createDecipheriv('aes-256-gcm',key,raw.subarray(0,12));
    decipher.setAuthTag(raw.subarray(12,28));
    const obj=JSON.parse(Buffer.concat([
      decipher.update(raw.subarray(28)),decipher.final()
    ]).toString('utf8'));
    if(obj.v!==1 || obj.uid!==uid || !CHAT.test(obj.id||'') ||
       !Number.isSafeInteger(obj.until) || obj.until<=now ||
       obj.until>now+TTL_MS)deny();
    return obj.id;
  }catch{deny();}
}
function normalizeChat(uid,chatId,data) {
  if(!CHAT.test(chatId||''))return null;
  try {
    const views=peerInboxEntries(chatId,data);
    const own=views.find(v=>v.data.ownerUid===uid);
    if(!own)return null;
    const peer=own.data.peerUid;
    const fields={
      chatId,peerUid:peer,status:data.status,lastPreview:data.lastPreview,
      updatedAtMs:ms(data.updatedAt),
      unreadCount: uid===data.requesterUid ? data.unreadRequester : data.unreadRecipient,
      lastSenderUid:data.lastSenderUid
    };
    if(!Number.isFinite(fields.updatedAtMs))return null;
    if(!Number.isInteger(fields.unreadCount)||fields.unreadCount<0)fields.unreadCount=0;
    if(typeof fields.lastSenderUid!=='string')fields.lastSenderUid='';
    return fields;
  }catch{return null;}
}

/**
 * Adapter para Admin SDK: nao usa bibliotecas de cliente nem caminhos de producao.
 * Todas as provas de bloqueio, idade e estado da conversa ocorrem em transacao
 * de leitura, independentemente da materializacao e do cache.
 */
export function createAdminInboxStore(db) {
  if(!db || typeof db.doc!=='function' || typeof db.collection!=='function' ||
     typeof db.runTransaction!=='function')throw Error('inbox_admin_required');
  const ref=path=>db.doc(path);
  return {
    async viewerGate(uid,now,acceptedPairs) {
      const [cfg,age]=await Promise.all([
        ref('app_config/conversations').get(),
        ref('users/'+uid+'/chatAgeEligibility/current').get()
      ]);
      return has(cfg)&&has(age)&&configValid(cfg.data())&&
        validInboxAge(age.data(),acceptedPairs,now);
    },
    async candidateIds(uid,after,limitCount) {
      let q=db.collection('chats').where('participants','array-contains',uid)
        .orderBy('__name__').limit(limitCount);
      if(after)q=q.startAfter(after);
      const docs=await q.get();
      return docs.docs.map(x=>x.id);
    },
    async permittedChat(uid,chatId,now,acceptedPairs) {
      return db.runTransaction(async tx=>{
        const chatSnap=await tx.get(ref('chats/'+chatId));
        if(!has(chatSnap))return null;
        const item=normalizeChat(uid,chatId,chatSnap.data());
        if(!item)return null;
        const peer=item.peerUid;
        const refs=[
          ref('app_config/conversations'),
          ref('users/'+uid+'/chatAgeEligibility/current'),
          ref('users/'+peer+'/chatAgeEligibility/current'),
          ref('users/'+uid+'/blockedMembers/'+peer),
          ref('users/'+peer+'/blockedMembers/'+uid)
        ];
        const [cfg,a,b,blockedA,blockedB]=await Promise.all(refs.map(x=>tx.get(x)));
        if(!has(cfg)||!configValid(cfg.data())||
           !has(a)||!validInboxAge(a.data(),acceptedPairs,now)||
           !has(b)||!validInboxAge(b.data(),acceptedPairs,now)||
           has(blockedA)||has(blockedB))return null;
        return item;
      });
    }
  };
}

/**
 * Cadastro de rotas e segredo de cursor pertence ao backend (NUNCA ao APK).
 * verifyIdToken deve vir do Firebase Admin Auth, com revogacao revalidada
 * conforme a politica do servidor; aqui nao se fabrica nem valida JWT localmente.
 */
export function createAuthorizedInboxService({
  verifyIdToken,store,cursorKey,clock=()=>Date.now(),
  acceptedPairs=[LEGACY_PAIR]
}) {
  if(typeof verifyIdToken!=='function' || !store ||
     typeof store.viewerGate!=='function' ||
     typeof store.candidateIds!=='function' ||
     typeof store.permittedChat!=='function' ||
     !keyValid(cursorKey))throw Error('inbox_service_not_configured');
  if(!Array.isArray(acceptedPairs)||!acceptedPairs.length||
     acceptedPairs.some(p=>p!==LEGACY_PAIR &&
       p!=='declared_18_plus|2026-11-selfdecl-qa-v1'))
    throw Error('inbox_invalid_eligibility_config');
  return {
    async list({idToken,limit=MAX_LIMIT,cursor=null}={}) {
      if(typeof idToken!=='string'||idToken.length<1||idToken.length>8192)deny();
      if(!Number.isInteger(limit)||limit<1||limit>MAX_LIMIT)deny();
      const claims=await verifyIdToken(idToken,true).catch(deny);
      const uid=claims?.uid;
      if(!UID.test(uid||'')||claims.email_verified!==true)deny();
      const now=clock();
      if(!Number.isFinite(now)||
         !await store.viewerGate(uid,now,acceptedPairs))deny();
      const after=cursor===null?null:unseal(cursorKey,uid,cursor,now);
      const candidates=await store.candidateIds(uid,after,MAX_SCAN);
      if(!Array.isArray(candidates)||candidates.length>MAX_SCAN)deny();
      const items=[];
      let scanned=0;
      for(const id of candidates) {
        if(!CHAT.test(id||''))deny();
        const item=await store.permittedChat(uid,id,now,acceptedPairs);
        scanned++;
        if(item)items.push(item);
        if(items.length===limit)break;
      }
      const hasMore=scanned<candidates.length || candidates.length===MAX_SCAN;
      const last=scanned?candidates[scanned-1]:null;
      return {
        items,
        nextCursor:hasMore&&last?seal(cursorKey,uid,last,now):null
      };
    }
  };
}

/**
 * Backend admin: chamada por evento de chat/bloqueio (nao registrado aqui).
 * Os dois IDs possiveis tornam o handler independente da ordem do chat.
 * Materializador anterior continua sendo a unica rotina que escreve visoes.
 */
export async function syncBlockedPair(adminDb,a,b) {
  if(!UID.test(a||'')||!UID.test(b||'')||a===b)deny();
  const candidates=[a+'__'+b,b+'__'+a];
  let synced=0;
  for(const id of candidates){
    const snap=await adminDb.doc('chats/'+id).get();
    if(has(snap)){
      await reconcilePeerInbox(adminDb,id);
      synced++;
    }
  }
  return {synced};
}
export async function backfillInboxBatch(adminDb,ownerUid,{after=null,limit=20}={}) {
  if(!UID.test(ownerUid||'')||!Number.isInteger(limit)||limit<1||
     limit>40||(after!==null&&!CHAT.test(after)))deny();
  const store=createAdminInboxStore(adminDb);
  const ids=await store.candidateIds(ownerUid,after,limit);
  for(const id of ids)await reconcilePeerInbox(adminDb,id);
  return {processed:ids.length,nextAfter:ids.length===limit?ids.at(-1):null};
}

/**
 * Adaptador HTTP para Chat 3, NAO montado em Worker remoto.
 * Gate operacional fechado por padrao. Nunca confia em uid vindo da URL.
 * A implantacao requer Firebase Admin Auth e endpoint de QA revisado.
 */
export function createInboxHttpHandler(service,{enabled=false}={}) {
  if(!service||typeof service.list!=='function')
    throw Error('inbox_http_service_required');
  const headers={'Cache-Control':'private, no-store, max-age=0',
    'Pragma':'no-cache','Content-Type':'application/json; charset=utf-8'};
  const response=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  return async request=>{
    if(!enabled)return response(503,{error:'inbox_closed'});
    if(request?.method!=='GET')return response(405,{error:'method_not_allowed'});
    let url;
    try{url=new URL(request.url);}catch{return response(400,{error:'invalid_request'});}
    if(url.pathname!=='/v1/qa/conversations/inbox' ||
       url.searchParams.has('uid') ||
       [...url.searchParams.keys()].some(k=>k!=='limit'&&k!=='cursor') ||
       [...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))
      return response(400,{error:'invalid_request'});
    const auth=request.headers?.get('authorization')||'';
    if(!/^Bearer \S{1,8192}$/.test(auth))return response(403,{error:'forbidden'});
    const rawLimit=url.searchParams.get('limit');
    if(rawLimit!==null&&!/^(?:[1-9]|1\d|20)$/.test(rawLimit))
      return response(400,{error:'invalid_request'});
    try{
      const result=await service.list({
        idToken:auth.slice(7),
        limit:rawLimit===null?20:Number(rawLimit),
        cursor:url.searchParams.get('cursor')
      });
      return response(200,result);
    }catch{return response(403,{error:'forbidden'});}
  };
}

/**
 * Ponto de integracao de eventos ADMIN: criar/atualizar chat,
 * atualizar/remover bloqueio e remover chat. Nao registra trigger nem
 * executa rede remotamente. O operador conecta o handler autorizado.
 */
export async function applyTrustedInboxEvent(adminDb,event) {
  if(!event||typeof event!=='object'||Array.isArray(event))deny();
  if(event.kind==='chat_written'){
    if(!CHAT.test(event.chatId||''))deny();
    return reconcilePeerInbox(adminDb,event.chatId);
  }
  if(event.kind==='block_changed'){
    return syncBlockedPair(adminDb,event.ownerUid,event.peerUid);
  }
  if(event.kind==='chat_deleted'){
    if(!CHAT.test(event.chatId||''))deny();
    const views=peerInboxEntries(event.chatId,event.previousChat);
    await adminDb.runTransaction(async tx=>{
      for(const view of views)tx.delete(adminDb.doc(view.path));
    });
    return {deleted:views.length};
  }
  deny();
}
