/**
 * #355 - materializacao confiavel (NUNCA executa sozinho).
 * A API recebe uma instancia Firestore ADMIN previamente autenticada, apenas
 * do backend. Nao importe em Android/Web, nao publique Rules nem credenciais.
 * As Rules negam qualquer escrita destas visoes por clientes.
 */
const VALID_UID=/^[A-Za-z0-9_-]{1,128}$/;
const VALID_CHAT=/^[A-Za-z0-9_-]{1,260}$/;
const MAX_PREVIEW=1500;
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
     !updatedAt)
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
    const [blockedByA,blockedByB]=await Promise.all([
      tx.get(adminDb.doc('users/'+a+'/blockedMembers/'+b)),
      tx.get(adminDb.doc('users/'+b+'/blockedMembers/'+a))
    ]);
    const blocked=blockedByA.exists || blockedByB.exists;
    for(const entry of views) {
      const ref=adminDb.doc(entry.path);
      if(blocked) tx.delete(ref);
      else tx.set(ref,entry.data);
    }
    return {blocked,views:views.length};
  });
}
