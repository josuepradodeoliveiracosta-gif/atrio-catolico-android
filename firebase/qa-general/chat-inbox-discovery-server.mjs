/**
 * #355: descoberta confiavel de inbox, SEM endpoint remoto / deploy.
 * Somente backend com Admin SDK e verifyIdToken da identidade Firebase QA.
 * O cliente nunca consulta /chats via Rules: essa listagem continua negada.
 */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {
  INBOX_AGE_COLLECTIONS,INBOX_DISCOVERY_CONTROL,INBOX_WRITE_BOUNDARY,LEGACY_INBOX_AGE_PAIR,
  inboxAgeGrant,inboxDiscoveryCollection,inboxOwnerPath,inboxProjectionReady,
  peerInboxEntries,readInboxDiscoveryEntries,
  reconcilePeerInbox,syncInboxDiscoveryEntries
} from './chat-inbox-peer-index.mjs';

const UID=/^[A-Za-z0-9_-]{1,128}$/;
const CHAT=/^[A-Za-z0-9_-]{1,260}$/;
const MAX_LIMIT=20;
const TTL_MS=10*60*1000;
export class InboxAccessDenied extends Error {
  constructor() {super('inbox_access_denied');}
}
const deny=()=>{throw new InboxAccessDenied();};
class InboxUnavailable extends Error {
  constructor() {super('inbox_unavailable');}
}
class InboxRestartRequired extends Error {
  constructor() {super('inbox_restart_required');}
}
const has=(s)=>s && typeof s.exists==='function' ? s.exists() : !!s?.exists;

export function validInboxAge(data,acceptedPairs=[LEGACY_INBOX_AGE_PAIR],now=Date.now()) {
  const grant=inboxAgeGrant(data);
  return grant!==null && acceptedPairs.includes(grant.pair) && grant.expiresAtMs>now;
}
export function inboxConfigValid(c) {
  return c?.enabled===true && c?.minorPolicyApproved===true &&
    c?.safetyReviewVersion==='2026-11-safety-v1' &&
    c?.version==='2026-11-v1';
}
export async function authenticateInboxCaller(verifyIdToken,idToken) {
  if(typeof idToken!=='string'||idToken.length<1||idToken.length>8192)deny();
  let claims;
  try{claims=await verifyIdToken(idToken,true);}
  catch{deny();}
  const uid=claims?.uid;
  if(typeof uid!=='string'||!UID.test(uid)||claims.email_verified!==true)deny();
  return uid;
}
function keyValid(k) {return Buffer.isBuffer(k) && k.length===32;}
function seal(key,uid,{chatId,expiresAtMs,revision},now) {
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,nonce);
  const payload=Buffer.from(JSON.stringify({v:3,uid,chatId,expiresAtMs,revision,until:now+TTL_MS}),'utf8');
  const bytes=Buffer.concat([cipher.update(payload),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),bytes]).toString('base64url');
}
function unseal(key,uid,opaque,now) {
  if(typeof opaque!=='string' || opaque.length<48 || opaque.length>2048 ||
     !/^[A-Za-z0-9_-]+$/.test(opaque))deny();
  try{
    const raw=Buffer.from(opaque,'base64url');
    if(raw.toString('base64url')!==opaque)deny();
    const decipher=createDecipheriv('aes-256-gcm',key,raw.subarray(0,12));
    decipher.setAuthTag(raw.subarray(12,28));
    const obj=JSON.parse(Buffer.concat([
      decipher.update(raw.subarray(28)),decipher.final()
    ]).toString('utf8'));
    if(obj.v!==3 || obj.uid!==uid || !CHAT.test(obj.chatId||'') ||
       !Number.isFinite(obj.expiresAtMs) ||
       typeof obj.revision!=='string' || obj.revision.length>240 ||
       !Number.isSafeInteger(obj.until) || obj.until<=now ||
       obj.until>now+TTL_MS)deny();
    return {chatId:obj.chatId,expiresAtMs:obj.expiresAtMs,revision:obj.revision};
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
      updatedAtMs:data.updatedAt.toMillis(),
      unreadCount: uid===data.requesterUid ? data.unreadRequester : data.unreadRecipient,
      lastSenderUid:data.lastSenderUid
    };
    if(!Number.isInteger(fields.unreadCount)||fields.unreadCount<0)fields.unreadCount=0;
    if(typeof fields.lastSenderUid!=='string')fields.lastSenderUid='';
    return fields;
  }catch{return null;}
}

function comparePosition(a,b) {
  if(a.expiresAtMs!==b.expiresAtMs)return a.expiresAtMs-b.expiresAtMs;
  if(a.chatId<b.chatId)return -1;
  return a.chatId===b.chatId?0:1;
}

/**
 * A projeção privada deve refletir a autorização atual. O escritor confiável
 * fecha a descoberta durante o backfill ou quando a atualização não é atômica.
 * Revalide os itens da página e a continuação no mesmo snapshot do servidor.
 */
export function createAdminInboxStore(db) {
  if(!db || typeof db.doc!=='function' || typeof db.collection!=='function' ||
     typeof db.runTransaction!=='function')throw Error('inbox_admin_required');
  const ref=path=>db.doc(path);
  const ageRef=uid=>ref('users/'+uid+'/chatAgeEligibility/current');
  return {
    async authorizedPage(uid,after,limit,requestedAt,acceptedPairs) {
      return db.runTransaction(async tx=>{
        const [cfg,viewer,control,owner,boundary]=await tx.getAll(
          ref('app_config/conversations'),ageRef(uid),ref(INBOX_DISCOVERY_CONTROL),
          ref(inboxOwnerPath(uid)),ref(INBOX_WRITE_BOUNDARY)
        );
        const now=Math.max(requestedAt,cfg.readTime.toMillis());
        if(!inboxConfigValid(cfg.data())||!validInboxAge(viewer.data(),acceptedPairs,now))deny();
        if(!inboxProjectionReady(control.data(),boundary.data()))throw new InboxUnavailable();
        const revision=acceptedPairs.map(pair=>{
          const bucket=INBOX_AGE_COLLECTIONS[pair];
          return bucket+':'+(owner.data()?.revisions?.[bucket]??'');
        }).join('|');
        if(after&&(after.revision!==revision||after.expiresAtMs<=now))
          throw new InboxRestartRequired();

        const pages=await Promise.all(acceptedPairs.map(async pair=>{
          let query=db.collection(inboxDiscoveryCollection(uid,pair))
            .where('peerExpiresAtMs','>',now)
            .orderBy('peerExpiresAtMs').orderBy('__name__').limit(limit+1);
          if(after)query=query.startAfter(after.expiresAtMs,after.chatId);
          const snapshot=await tx.get(query);
          return snapshot.docs.map(doc=>({
            chatId:doc.id,expiresAtMs:doc.data().peerExpiresAtMs,pair
          }));
        }));
        const indexed=pages.flat();
        if(indexed.length===0)return {rows:[],revision};
        if(indexed.some(row=>!CHAT.test(row.chatId)||!Number.isFinite(row.expiresAtMs))||
           new Set(indexed.map(row=>row.chatId)).size!==indexed.length)
          throw new InboxUnavailable();
        const page=indexed.sort(comparePosition).slice(0,limit+1);

        const chats=await tx.getAll(...page.map(row=>ref('chats/'+row.chatId)));
        const items=chats.map((chat,i)=>normalizeChat(uid,page[i].chatId,chat.data()));
        if(items.some(item=>item===null))throw new InboxUnavailable();

        // Reutilize as mesmas provas quando a página contém mais de um chat do par.
        const paths=new Set();
        for(const {peerUid:peer} of items){
          paths.add(ageRef(peer).path);
          paths.add('users/'+uid+'/blockedMembers/'+peer);
          paths.add('users/'+peer+'/blockedMembers/'+uid);
        }
        const proofs=await tx.getAll(...Array.from(paths,ref));
        const byPath=new Map(proofs.map(proof=>[proof.ref.path,proof]));
        const rows=items.map((item,i)=>{
          const peer=item.peerUid;
          const grant=inboxAgeGrant(byPath.get(ageRef(peer).path).data());
          if(grant?.pair!==page[i].pair || grant.expiresAtMs!==page[i].expiresAtMs ||
             has(byPath.get('users/'+uid+'/blockedMembers/'+peer)) ||
             has(byPath.get('users/'+peer+'/blockedMembers/'+uid)))
            throw new InboxUnavailable();
          return {item,expiresAtMs:page[i].expiresAtMs};
        });
        return {rows,revision};
      },{readOnly:true});
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
  acceptedPairs=[LEGACY_INBOX_AGE_PAIR]
}) {
  if(typeof verifyIdToken!=='function' || !store ||
     typeof store.authorizedPage!=='function' ||
     !keyValid(cursorKey))throw Error('inbox_service_not_configured');
  if(!Array.isArray(acceptedPairs)||!acceptedPairs.length||
     acceptedPairs.some(pair=>typeof pair!=='string'||!Object.hasOwn(INBOX_AGE_COLLECTIONS,pair)))
    throw Error('inbox_invalid_eligibility_config');
  const policyPairs=[...new Set(acceptedPairs)].sort();
  return {
    async list({idToken,limit=MAX_LIMIT,cursor=null}={}) {
      if(!Number.isInteger(limit)||limit<1||limit>MAX_LIMIT)deny();
      const uid=await authenticateInboxCaller(verifyIdToken,idToken);
      const now=clock();
      if(!Number.isSafeInteger(now))deny();
      const after=cursor===null?null:unseal(cursorKey,uid,cursor,now);
      const {rows,revision}=await store.authorizedPage(uid,after,limit,now,policyPairs);
      const items=rows.slice(0,limit).map(row=>row.item);
      const last=rows[limit-1];
      return {
        items,
        nextCursor:rows.length>limit
          ? seal(cursorKey,uid,{chatId:last.item.chatId,expiresAtMs:last.expiresAtMs,revision},now)
          : null
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
  const candidates=[...new Set([a+'__'+b,b+'__'+a])];
  let synced=0,staleRemoved=0;
  for(const id of candidates){
    const parent=adminDb.doc('chats/'+id);
    const snap=await parent.get();
    if(has(snap)){
      // O reconciliador relê conversa e bloqueios em transação; um evento
      // anterior não pode restaurar índices usando payload desatualizado.
      await reconcilePeerInbox(adminDb,id);
      synced++;
    }else{
      // Reexecuções de eventos, exclusões e índice órfão: sempre confirme
      // a ausência da conversa DENTRO da transação antes de limpar a vista.
      staleRemoved+=await adminDb.runTransaction(async tx=>{
        if(has(await tx.get(parent)))return 0;
        const refs=[
          adminDb.doc('users/'+a+'/chatInboxByPeer/'+b+'/entries/'+id),
          adminDb.doc('users/'+b+'/chatInboxByPeer/'+a+'/entries/'+id)
        ];
        // Eventos frequentes nao devem gerar escritas cobradas em
        // documentos inexistentes. Todas as leituras precedem os deletes.
        const [snaps,discoveryA,discoveryB]=await Promise.all([
          Promise.all(refs.map(ref=>tx.get(ref))),
          readInboxDiscoveryEntries(adminDb,tx,a,id),
          readInboxDiscoveryEntries(adminDb,tx,b,id)
        ]);
        syncInboxDiscoveryEntries(adminDb,tx,discoveryA);
        syncInboxDiscoveryEntries(adminDb,tx,discoveryB);
        let count=0;
        for(let i=0;i<refs.length;i++){
          if(has(snaps[i])){tx.delete(refs[i]);count++;}
        }
        return count;
      });
    }
  }
  return {synced,staleRemoved};
}
export async function backfillInboxBatch(adminDb,ownerUid,{after=null,limit=20}={}) {
  if(!UID.test(ownerUid||'')||!Number.isInteger(limit)||limit<1||
     limit>40||(after!==null&&!CHAT.test(after)))deny();
  let query=adminDb.collection('chats').where('participants','array-contains',ownerUid)
    .orderBy('__name__').limit(limit);
  if(after)query=query.startAfter(after);
  const ids=(await query.get()).docs.map(doc=>doc.id);
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
    }catch(error){
      if(error instanceof InboxAccessDenied)return response(403,{error:'forbidden'});
      if(error instanceof InboxRestartRequired)return response(409,{error:'inbox_restart_required'});
      return response(503,{error:'inbox_unavailable'});
    }
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
    // A prova dos participantes vem do snapshot ANTERIOR confiável do
    // gatilho Admin, nunca de um request do cliente.
    const views=peerInboxEntries(event.chatId,event.previousChat);
    return adminDb.runTransaction(async tx=>{
      // Gatilhos chegam fora de ordem: se a conversa reapareceu, a exclusão
      // antiga NÃO pode apagar a vista da conversa ativa.
      if(has(await tx.get(adminDb.doc('chats/'+event.chatId))))
        return {deleted:0,staleEvent:true};
      const refs=views.map(view=>adminDb.doc(view.path));
      const [snaps,discovery]=await Promise.all([
        Promise.all(refs.map(ref=>tx.get(ref))),
        Promise.all(views.map(view=>
          readInboxDiscoveryEntries(adminDb,tx,view.data.ownerUid,event.chatId)))
      ]);
      for(const entries of discovery)syncInboxDiscoveryEntries(adminDb,tx,entries);
      let deleted=0;
      for(let i=0;i<refs.length;i++){
        if(has(snaps[i])){tx.delete(refs[i]);deleted++;}
      }
      return {deleted,staleEvent:false};
    });
  }
  deny();
}
