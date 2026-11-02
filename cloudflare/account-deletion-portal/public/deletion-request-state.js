/**
 * Estado de solicitação de exclusão, lido somente de um snapshot do servidor.
 * "completed" representa alegação administrativa, NÃO comprova eliminação.
 * Não altera Auth, Firestore, Cloudinary nem reabre registros existentes.
 */
export function portalDeletionRequestState(snapshot) {
  try {
    if(!snapshot || typeof snapshot.exists!=='function' ||
       snapshot.metadata?.fromCache!==false ||
       snapshot.metadata?.hasPendingWrites!==false ||
       typeof snapshot.data!=='function') return 'indeterminate';
    if(!snapshot.exists()) return 'not_requested';
    const data=snapshot.data();
    if(!data || (data.source!=='android' && data.source!=='web') ||
       typeof data.requestedAt?.toMillis!=='function' ||
       !Number.isFinite(data.requestedAt.toMillis())) return 'indeterminate';
    switch(data.status) {
      case 'requested': return 'requested';
      case 'processing': return 'processing';
      case 'completed': return 'completion_reported';
      case 'rejected': return 'review_required';
      default: return 'indeterminate';
    }
  }catch{return 'indeterminate';}
}
export function verifiedPortalDeletionRequest(snapshot) {
  return portalDeletionRequestState(snapshot)==='requested';
}
