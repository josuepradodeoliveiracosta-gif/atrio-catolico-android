/**
 * Átrio Conversas: simulação de retenção sem escrita, rede ou Firebase.
 * Nunca executa exclusões. Nenhum prazo é presumido.
 */
export function planRetention(policy,groups,now=Date.now()) {
  if(!Array.isArray(groups) || !Number.isFinite(now)) throw TypeError('entrada inválida');
  const approved=policy?.approved===true
    && typeof policy.approvedBy==='string' && policy.approvedBy.trim()!==''
    && Number.isInteger(policy.days) && policy.days>=1 && policy.days<=3650;
  if(!approved) return Object.freeze({
    ready:false,reason:'policy_not_approved',inspected:groups.length,
    eligibleCount:0,heldCount:0,unknownCount:groups.length,
    action:'none',deletedCount:0
  });
  const cutoff=now-policy.days*86_400_000;
  let eligibleCount=0,heldCount=0,unknownCount=0;
  for(const group of groups) {
    if(!group || group.status!=='closed') { unknownCount++; continue; }
    if(group.legalHold===true || group.openReports===true) { heldCount++; continue; }
    const closedAt=Date.parse(group.closedAt);
    if(!Number.isFinite(closedAt) || closedAt>now) { unknownCount++; continue; }
    if(closedAt<=cutoff) eligibleCount++;
  }
  return Object.freeze({
    ready:true,reason:'human_review_required',inspected:groups.length,
    eligibleCount,heldCount,unknownCount,
    cutoffDate:new Date(cutoff).toISOString(),
    action:'dry_run_only',deletedCount:0
  });
}
