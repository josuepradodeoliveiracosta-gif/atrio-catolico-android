/**
 * #355 - materializacao confiavel (NUNCA executa sozinho).
 * A API recebe uma instancia Firestore ADMIN previamente autenticada, apenas
 * do backend. Nao importe em Android/Web, nao publique Rules nem credenciais.
 * As Rules negam qualquer escrita destas visoes por clientes.
 */
const VALID_UID=/^[A-Za-z0-9_-]{1,128}$/;
const VALID_CHAT=/^[A-Za-z0-9_-]{1,260}$/;
const MAX_PREVIEW=1500;
export const LEGACY_INBOX_AGE_PAIR='eligible|2026-11-18plus-qa-v1';
export const INBOX_AGE_COLLECTIONS=Object.freeze({
  [LEGACY_INBOX_AGE_PAIR]:'legacy',
  'declared_18_plus|2026-11-selfdecl-qa-v1':'selfDeclared'
});
export const INBOX_DISCOVERY_CONTROL='serverInboxControl/pagination';
export const INBOX_DISCOVERY_SCHEMA=1;

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
  return 'serverInboxOwners/'+ownerUid+'/'+INBOX_AGE_COLLECTIONS[pair];
}

// Read before writing, including on replay. An absent entry costs no delete.
export async function readInboxDiscoveryEntries(adminDb,tx,ownerUid,chatId) {
  return Promise.all(Object.keys(INBOX_AGE_COLLECTIONS).map(async pair=>{
    const ref=adminDb.doc(inboxDiscoveryCollection(ownerUid,pair)+'/'+chatId);
    return {pair,ref,snap:await tx.get(ref)};
  }));
}

export function syncInboxDiscoveryEntries(tx,entries,grant=null) {
  for(const {pair,ref,snap} of entries) {
    if(grant?.pair===pair) {
      if(snap.data()?.peerExpiresAtMs!==grant.expiresAtMs)
        tx.set(ref,{peerExpiresAtMs:grant.expiresAtMs});
    } else if(snap.exists) {
      tx.delete(ref);
    }
  }
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
    const [a,b]=views.map(v=>v.data.ownerUid);
    const [blockedByA,blockedByB,ageA,ageB,discoveryA,discoveryB]=await Promise.all([
      tx.get(adminDb.doc('users/'+a+'/blockedMembers/'+b)),
      tx.get(adminDb.doc('users/'+b+'/blockedMembers/'+a)),
      tx.get(adminDb.doc('users/'+a+'/chatAgeEligibility/current')),
      tx.get(adminDb.doc('users/'+b+'/chatAgeEligibility/current')),
      readInboxDiscoveryEntries(adminDb,tx,a,chatId),
      readInboxDiscoveryEntries(adminDb,tx,b,chatId)
    ]);
    const blocked=blockedByA.exists || blockedByB.exists;
    for(const entry of views) {
      const ref=adminDb.doc(entry.path);
      if(blocked) tx.delete(ref);
      else tx.set(ref,entry.data);
    }
    syncInboxDiscoveryEntries(tx,discoveryA,blocked ? null : inboxAgeGrant(ageB.data()));
    syncInboxDiscoveryEntries(tx,discoveryB,blocked ? null : inboxAgeGrant(ageA.data()));
    return {blocked,views:views.length};
  });
}
