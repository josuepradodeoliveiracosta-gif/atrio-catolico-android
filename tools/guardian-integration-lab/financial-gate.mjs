// Candidato offline: não consulta provedores, não autoriza operações remotas.
// A admissão exige uma fonte confiável de métricas e reserva atômica externa.
export const LIMITS = Object.freeze({reads:50000,writes:20000,deletes:20000,storageBytes:1073741824,workerRequests:100000});
const keys=Object.keys(LIMITS);
const deny=reason=>({allowed:false,reason,remoteAuthorized:false});
const exact=(v,keys)=>v!==null&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const snapshotKeys=['firebasePlan','firebaseBillingEnabled','workerPlan','githubPublic','standardRunner','paidExtras','observedAt','firestoreDay','workerDay','usage','reserved'];
const estimateKeys=[...keys,'workerCpuMs','newPaidService','additionalProducts','artifactUpload'];
const integer=n=>Number.isSafeInteger(n)&&n>=0;
function dateInZone(ms,zone){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ms);
  const get=k=>parts.find(p=>p.type===k).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function evaluateFinancialGate(snapshot,estimate,now=Date.now()){
  try {
  if(!integer(now)||now>8640000000000000) return deny('invalid_clock');
  if(!exact(snapshot,snapshotKeys)) return deny('free_plan_unproven');
  if(snapshot?.firebasePlan!=='Spark'||snapshot?.firebaseBillingEnabled!==false||snapshot?.workerPlan!=='Free'||snapshot?.githubPublic!==true||snapshot?.standardRunner!==true||snapshot?.paidExtras!==false) return deny('free_plan_unproven');
  if(!integer(snapshot.observedAt)||snapshot.observedAt>now||now-snapshot.observedAt>300000) return deny('stale_snapshot');
  if(snapshot.firestoreDay!==dateInZone(now,'America/Los_Angeles')||snapshot.workerDay!==dateInZone(now,'UTC')) return deny('wrong_quota_window');
  if(!exact(estimate,estimateKeys)) return deny('unsupported_operation');
  if(estimate?.newPaidService!==false||estimate?.additionalProducts!==false||estimate?.artifactUpload!==false) return deny('unsupported_operation');
  if(!integer(estimate.workerCpuMs)||estimate.workerCpuMs>8) return deny('cpu_budget');
  if(estimate.deletes!==0) return deny('deletion_not_authorized');
  for(const values of [snapshot.usage,snapshot.reserved]){
    if(values===null||typeof values!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(values))||Reflect.ownKeys(values).some(k=>!keys.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(values,k),'value'))) return deny('invalid_usage');
  }
  for(const k of keys){
    const used=Object.hasOwn(snapshot.usage,k)?snapshot.usage[k]:undefined,pending=Object.hasOwn(snapshot.reserved,k)?snapshot.reserved[k]:undefined,delta=estimate[k];
    if(![used,pending,delta].every(integer)) return deny('unknown_usage_'+k);
    if(used>LIMITS[k]||pending>LIMITS[k]||delta>LIMITS[k]) return deny('quota_'+k);
    if((used+pending+delta)*10>=LIMITS[k]*9) return deny('quota_'+k);
  }
  const peak=Math.max(...keys.map(k=>(snapshot.usage[k]+snapshot.reserved[k]+estimate[k])/LIMITS[k]));
  if(peak>=0.85) return deny('nonessential_paused');
  return {allowed:true,reason:peak>=0.70?'preventive_alert':'within_budget',requiresAtomicReservation:true,remoteAuthorized:false};
  } catch { return deny('invalid_input'); }
}
