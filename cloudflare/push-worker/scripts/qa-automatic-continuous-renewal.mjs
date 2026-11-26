// Private control-plane renewal, never a public Worker handler.
// The collector is a trusted, read-only operator adapter, not a user payload.
// No default credentials, network, billing changes, or activation API.
export const RENEWAL_SCOPE=Object.freeze({
 accountId:'11f5b44f182f37b5b374330592c92b8c',
 projectId:'atrio-catolico-qa-general',
 workerName:'atrio-push-qa-general',
 databaseId:'dc88db76-99c2-46d0-b5e3-df68152c564d'
});
export const RENEWAL_LIMITS=Object.freeze({
 maxAgeMs:900000,renewWithinMs:3600000,minMarginMs:120000,leaseMs:86400000,
 workerRequestsRemaining:2000,d1RowsReadRemaining:200000,d1RowsWrittenRemaining:20000,firestoreReadsRemaining:15000
});
const L=RENEWAL_LIMITS,clock="CAST(unixepoch('subsec')*1000 AS INTEGER)";
const integer=x=>Number.isSafeInteger(x)&&x>0;
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(x);
const stop=reason=>({status:'not_renewed',reason});
const bounds=Object.freeze({workerRequestsRemaining:100000,d1RowsReadRemaining:5000000,d1RowsWrittenRemaining:100000,firestoreReadsRemaining:50000});
export function reviewRenewalEvidence(e,now,expectedVersion){
 if(!e||!integer(now)||!uuid(expectedVersion))return false;
 if(Object.entries(RENEWAL_SCOPE).some(([k,v])=>e[k]!==v))return false;
 if(!integer(e.observedAt)||e.observedAt>now||now-e.observedAt>L.maxAgeMs)return false;
 if(e.versionId!==expectedVersion||e.singleVersion!==true||e.traffic!==100||e.cron!=='* * * * *'||e.mode!=='continuous')return false;
 // Adapter must attest completeness, current UTC/Pacific quota windows,
 // conservative remaining amounts, and applicable enforced free limits.
 if(e.complete!==true||e.currentQuotaWindows!==true||e.conservative!==true||e.freeLimitsEnforced!==true)return false;
 return Object.entries(bounds).every(([k,max])=>integer(e[k])&&e[k]>=L[k]&&e[k]<=max);
}
const SELECT="SELECT activated_at,enabled,quota_checked_at,quota_valid_until FROM qa_auto_d1_continuous_epoch WHERE activated_at=?";
const UPDATE="UPDATE qa_auto_d1_continuous_epoch SET quota_checked_at=?,quota_valid_until=? "+
 "WHERE activated_at=? AND enabled=1 AND quota_checked_at=? AND quota_valid_until=? "+
 "AND quota_valid_until>="+clock+"+120000 AND quota_valid_until<="+clock+"+3600000 "+
 "AND ? BETWEEN "+clock+"-900000 AND "+clock+" AND ?>quota_valid_until "+
 "AND EXISTS (SELECT 1 FROM atrio_qa_identity WHERE project_id='atrio-catolico-qa-general') "+
 "AND NOT EXISTS (SELECT 1 FROM atrio_qa_identity WHERE project_id<>'atrio-catolico-qa-general') "+
 "AND NOT EXISTS (SELECT 1 FROM qa_auto_d1_activation_lab WHERE enabled=1) "+
 "AND NOT EXISTS (SELECT 1 FROM qa_auto_d1_trial_lab WHERE activated_at=?) "+
 "AND EXISTS (SELECT 1 FROM qa_auto_d1_continuous_schedule WHERE activated_at=?) "+
 "AND NOT EXISTS (SELECT 1 FROM qa_auto_d1_outbox_lab WHERE expires_at>"+clock+")";
// Run periodically in an isolated operator process, never in the send Worker.
// CAS prevents stale samples, concurrent renewal, disarm and expired-lease revival.
export function createContinuousRenewal({db,collectEvidence,activatedAt,expectedVersion,enabled=false,now=Date.now}={}){
 if(typeof db?.prepare!=='function'||typeof collectEvidence!=='function'||typeof now!=='function')throw Error('missing_renewal_dependency');
 return async()=>{
  if(enabled!==true||!integer(activatedAt)||!uuid(expectedVersion))return stop('disabled');
  try{
   const old=await db.prepare(SELECT).bind(activatedAt).first(),t=now();
   if(!integer(t)||old?.enabled!==1||old.activated_at!==activatedAt||!integer(old.quota_checked_at)||!integer(old.quota_valid_until)||old.quota_checked_at<activatedAt||old.quota_checked_at>t||old.quota_valid_until>old.quota_checked_at+L.leaseMs)return stop('invalid_epoch');
   if(old.quota_valid_until-t<L.minMarginMs)return stop('expired_or_too_late');
   if(old.quota_valid_until-t>L.renewWithinMs)return stop('not_due');
   const e=await collectEvidence({...RENEWAL_SCOPE,expectedVersion}),checked=now();
   if(!reviewRenewalEvidence(e,checked,expectedVersion)||e.observedAt<=old.quota_checked_at)return stop('evidence_unavailable');
   const until=e.observedAt+L.leaseMs;
   if(!integer(until)||until<=old.quota_valid_until)return stop('no_extension');
   const r=await db.prepare(UPDATE).bind(e.observedAt,until,activatedAt,old.quota_checked_at,old.quota_valid_until,e.observedAt,until,activatedAt,activatedAt).run();
   return r?.success===true&&r.meta?.changes===1?{status:'renewed',activatedAt,quotaValidUntil:until}:stop('state_changed_or_busy');
  }catch{return stop('verification_unavailable')}
 };
}
