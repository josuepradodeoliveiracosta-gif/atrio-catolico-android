// Continuous QA authorization contract; no remote activation or renewal API.
// A new epoch is independent of the historical one-shot trial. No arm API.
export const CONTINUOUS_SCHEMA = `CREATE TABLE IF NOT EXISTS qa_auto_d1_continuous_epoch (
 activated_at INTEGER PRIMARY KEY CHECK(activated_at>0),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 quota_checked_at INTEGER NOT NULL DEFAULT 0 CHECK(quota_checked_at>=0),
 quota_valid_until INTEGER NOT NULL DEFAULT 0 CHECK(quota_valid_until>=quota_checked_at AND quota_valid_until<=quota_checked_at+86400000)
);
CREATE UNIQUE INDEX IF NOT EXISTS qa_auto_d1_continuous_one_active ON qa_auto_d1_continuous_epoch(enabled) WHERE enabled=1;
CREATE TABLE IF NOT EXISTS qa_auto_d1_continuous_schedule (
 activated_at INTEGER PRIMARY KEY CHECK(activated_at>0),
 last_scheduled_at INTEGER NOT NULL DEFAULT 0 CHECK(last_scheduled_at>=0 AND last_scheduled_at%60000=0)
);`;
const clock = "CAST(unixepoch('subsec')*1000 AS INTEGER)";
const positive = n => Number.isSafeInteger(n) && n > 0;
// The caller must also enforce existing daily and per-invocation budgets,
// authentication, admission, canonical expiry, and shared delivery dedup.
// A quota lease is evidence of headroom, not a subscription or automatic renewal.
export function createContinuousGate({db, activatedAt, enabled=false}={}) {
 if(typeof db?.prepare!=='function') throw Error('missing_continuous_db');
 return async kind => {
  if(enabled!==true || !positive(activatedAt) || !['tick','notice'].includes(kind)) return null;
  const margin = kind==='tick' ? 120000 : 10000;
  try {
   const r = await db.prepare(continuousLeaseSql(margin)).bind(activatedAt).first();
   return positive(r?.until_ms) ? r.until_ms : null;
  } catch { return null; }
 };
}

const eligibility = margin => {
 if(![10000,120000].includes(margin)) throw Error('invalid_continuous_margin');
 return `c.activated_at=? AND c.enabled=1 AND c.activated_at<=${clock}
 AND c.quota_checked_at>=c.activated_at AND c.quota_checked_at<=${clock}
 AND c.quota_valid_until>=${clock}+${margin} AND c.quota_valid_until<=c.quota_checked_at+86400000
 AND EXISTS (SELECT 1 FROM atrio_qa_identity WHERE project_id='atrio-catolico-qa-general')
 AND NOT EXISTS (SELECT 1 FROM atrio_qa_identity WHERE project_id<>'atrio-catolico-qa-general')
 AND NOT EXISTS (SELECT 1 FROM qa_auto_d1_activation_lab WHERE enabled=1)
 AND NOT EXISTS (SELECT 1 FROM qa_auto_d1_trial_lab WHERE activated_at=c.activated_at)`;
};
export const continuousLeaseSql = (margin=10000) =>
 'SELECT c.quota_valid_until AS until_ms FROM qa_auto_d1_continuous_epoch c WHERE '+eligibility(margin);
// Same predicate inside atomic outbox and schedule statements. Exactly one bind.
export const continuousActiveSql = (margin=10000) => 'EXISTS ('+continuousLeaseSql(margin)+')';
export async function noActiveContinuousEpoch(db,{required=false}={}) {
 try {
  const schema=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='qa_auto_d1_continuous_epoch'").bind().first();
  if(!schema)return !required; // backwards-compatible only for legacy databases
  return !await db.prepare('SELECT activated_at FROM qa_auto_d1_continuous_epoch WHERE enabled=1 LIMIT 1').bind().first();
 } catch { return false; }
}
export const continuousConfigured = env => env?.QA_AUTO_MODE==='continuous' && env?.QA_AUTO_CONTINUOUS_ENABLED==='true';
