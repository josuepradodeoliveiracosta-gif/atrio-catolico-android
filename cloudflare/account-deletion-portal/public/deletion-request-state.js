/**
 * Confirmacao de pedido de exclusao: exige documento completo, origem permitida,
 * timestamp Firebase e leitura sem cache ou escritas locais pendentes.
 * Nao e comprovacao de processamento/exclusao da conta.
 */
export function verifiedPortalDeletionRequest(snapshot) {
  if(!snapshot || typeof snapshot.exists!=='function' || !snapshot.exists()
    || snapshot.metadata?.fromCache!==false
    || snapshot.metadata?.hasPendingWrites!==false
    || typeof snapshot.data!=='function') return false;
  try {
    const data=snapshot.data();
    return data?.status==='requested'
      && (data.source==='android' || data.source==='web')
      && typeof data.requestedAt?.toMillis==='function'
      && Number.isFinite(data.requestedAt.toMillis());
  }catch{return false;}
}
