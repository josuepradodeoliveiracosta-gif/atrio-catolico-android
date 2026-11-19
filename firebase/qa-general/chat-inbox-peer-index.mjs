/**
 * #355 - materializacao confiavel (NUNCA executa sozinho).
 * A API recebe uma instancia Firestore ADMIN previamente autenticada, apenas
 * do backend. Nao importe em Android/Web, nao publique Rules nem credenciais.
 * As Rules negam qualquer escrita destas visoes por clientes.
 */
import {randomUUID} from 'node:crypto';

const VALID_UID=/^[A-Za-z0-9_-]{1,128}$/;
const VALID_CHAT=/^[A-Za-z0-9_-]{1,260}$/;
const MAX_PREVIEW=1500;
export const LEGACY_INBOX_AGE_PAIR='eligible|2026-11-18plus-qa-v1';
export const INBOX_AGE_COLLECTIONS=Object.freeze({
  [LEGACY_INBOX_AGE_PAIR]:'legacy',
  'declared_18_plus|2026-11-selfdecl-qa-v1':'selfDeclared'
});
export const INBOX_DISCOVERY_CONTROL='serverInboxControl/pagination';
export const INBOX_WRITE_BOUNDARY='serverInboxControl/writeBoundary';
export const INBOX_WRITE_POLICY='coordinated-v1';
export const INBOX_DISCOVERY_SCHEMA=3;
export const inboxOwnerPath=uid=>'serverInboxOwners/'+uid;
export const inboxAgePath=uid=>'users/'+uid+'/chatAgeEligibility/current';
export const inboxBlockPath=(owner,peer)=>'users/'+owner+'/blockedMembers/'+peer;

export function inboxBoundaryEpoch(boundary) {
  return boundary?.policy===INBOX_WRITE_POLICY &&
    typeof boundary.epoch==='string' && boundary.epoch.length>0 ? boundary.epoch : null;
}

export function inboxProjectionReady(control,boundary) {
  const epoch=inboxBoundaryEpoch(boundary);
  return control?.ready===true && control.schema===INBOX_DISCOVERY_SCHEMA &&
    epoch!==null && control.certificate?.boundaryEpoch===epoch &&
    typeof control.certificate?.operationId==='string' &&
    Number.isFinite(control.certificate.cutAtMs) && !control.job;
}

export function inboxAgeGrant(data) {
  if(!data || typeof data!=='object' || Array.isArray(data) ||
     Object.keys(data).sort().join('|')!=='minimumAge|policyVersion|reviewExpiresAt|status' ||
     data.minimumAge!==18 || typeof data.status!=='string' ||
     typeof data.policyVersion!=='string' || typeof data.reviewExpiresAt?.toMillis!=='function')
    return null;
  const pair=data.status+'|'+data.policyVersion;
  const expiresAtMs=data.reviewExpiresAt.toMillis();
  return Object.hasOwn(INBOX_AGE_COLLECTIONS,pair) && Number.isFinite(expiresAtMs)
    ? {pair,expiresAtMs} : null;
}

export function inboxDiscoveryCollection(ownerUid,pair) {
  return inboxOwnerPath(ownerUid)+'/'+INBOX_AGE_COLLECTIONS[pair];
}

// Read before writing, including on replay. An absent entry costs no delete.
export async function readInboxDiscoveryEntries(adminDb,tx,ownerUid,chatId) {
  return Promise.all(Object.keys(INBOX_AGE_COLLECTIONS).map(async pair=>{
    const ref=adminDb.doc(inboxDiscoveryCollection(ownerUid,pair)+'/'+chatId);
    return {ownerUid,pair,ref,snap:await tx.get(ref)};
  }));
}

export function writeInboxDiscoveryEntry(db,tx,{ownerUid,pair,ref,snap},grant) {
  const current=snap.data();
  if(grant?.pair===pair) {
    if(current?.peerExpiresAtMs===grant.expiresAtMs && Object.keys(current).length===1)
      return;
    tx.set(ref,{peerExpiresAtMs:grant.expiresAtMs});
  } else {
    if(!snap.exists)return;
    tx.delete(ref);
  }
  const now=snap.readTime?.toMillis() ?? Date.now();
  if(current?.peerExpiresAtMs>now || (grant?.pair===pair && grant.expiresAtMs>now))
    tx.set(db.doc(inboxOwnerPath(ownerUid)),{
      revisions:{[INBOX_AGE_COLLECTIONS[pair]]:randomUUID()}
    },{merge:true});
}

export function syncInboxDiscoveryEntries(db,tx,entries,grant=null) {
  for(const entry of entries)writeInboxDiscoveryEntry(db,tx,entry,grant);
}
function validUid(uid) {
  return typeof uid==='string' && VALID_UID.test(uid);
}
export function peerInboxEntries(chatId, chat) {
  if(typeof chatId!=='string' || !VALID_CHAT.test(chatId) ||
     !chat || typeof chat!=='object' || Array.isArray(chat))
    throw Error('inbox_invalid_chat');
  const {requesterUid:a,recipientUid:b,status,lastPreview,updatedAt}=chat;
  if(!validUid(a) || !validUid(b) || a===b ||
     (chatId!==a+'__'+b && chatId!==b+'__'+a) ||
     !Array.isArray(chat.participants) ||
     chat.participants.length!==2 ||
     chat.participants[0]!==a || chat.participants[1]!==b ||
     !['pending','accepted','declined'].includes(status) ||
     typeof lastPreview!=='string' || lastPreview.length>MAX_PREVIEW ||
     typeof updatedAt?.toMillis!=='function' || !Number.isFinite(updatedAt.toMillis()))
    throw Error('inbox_invalid_contract');
  const one=(ownerUid,peerUid)=>({
    path:'users/'+ownerUid+'/chatInboxByPeer/'+peerUid+'/entries/'+chatId,
    data:{ownerUid,peerUid,chatId,status,lastPreview,updatedAt}
  });
  return [one(a,b),one(b,a)];
}

export function existingPeerInboxViews(chat) {
  if(!chat.exists)return [];
  try{return peerInboxEntries(chat.id,chat.data());}
  catch{return [];}
}

export async function readPeerInboxAuthorization(db,tx,views,blockOverride=null) {
  const [a,b]=views.map(view=>view.data.ownerUid);
  const [blockA,blockB,ageA,ageB]=await Promise.all([
    tx.get(db.doc(inboxBlockPath(a,b))),
    tx.get(db.doc(inboxBlockPath(b,a))),
    tx.get(db.doc(inboxAgePath(a))),
    tx.get(db.doc(inboxAgePath(b)))
  ]);
  const blocked=(blockA,ownerBlockPath)=>{
    return ownerBlockPath===blockOverride?.path ? blockOverride.blocked : blockA.exists;
  };
  const denied=blocked(blockA,inboxBlockPath(a,b)) || blocked(blockB,inboxBlockPath(b,a));
  return {blocked:denied,grants:denied ? [null,null] : [
    inboxAgeGrant(ageB.data()),inboxAgeGrant(ageA.data())
  ]};
}

// Plan all reads before applying any writes, including a multi-chat batch.
export async function preparePeerInbox(db,tx,views,blockOverride) {
  const [authorization,entries]=await Promise.all([
    readPeerInboxAuthorization(db,tx,views,blockOverride),
    Promise.all(views.map(({data})=>
      readInboxDiscoveryEntries(db,tx,data.ownerUid,data.chatId)))
  ]);
  return ()=>{
    for(const [i,entry] of views.entries()) {
      const ref=db.doc(entry.path);
      if(authorization.blocked)tx.delete(ref);
      else tx.set(ref,entry.data);
      syncInboxDiscoveryEntries(db,tx,entries[i],authorization.grants[i]);
    }
    return {blocked:authorization.blocked,views:views.length};
  };
}
/**
 * Reconciliacao opcional para Worker/Function ADMIN, nao para o cliente.
 * Usa transacao: os dois bloqueios sao lidos antes das duas escritas.
 * Mesmo se o indice ficar desatualizado, a regra Firestore checa ambos
 * os bloqueios em tempo de leitura (fail-closed).
 */
export async function reconcilePeerInbox(adminDb,chatId) {
  if(!adminDb || typeof adminDb.runTransaction!=='function' ||
     typeof adminDb.doc!=='function' || !VALID_CHAT.test(chatId||''))
    throw Error('inbox_admin_db_required');
  return adminDb.runTransaction(async tx=>{
    const chatRef=adminDb.doc('chats/'+chatId);
    const snap=await tx.get(chatRef);
    if(!snap.exists) throw Error('inbox_chat_not_found');
    const views=peerInboxEntries(chatId,snap.data());
    const apply=await preparePeerInbox(adminDb,tx,views);
    return apply();
  });
}
