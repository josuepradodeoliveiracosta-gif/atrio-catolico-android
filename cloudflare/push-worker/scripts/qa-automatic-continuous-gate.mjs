// First offline contract for continuous QA operation; not connected to a Worker.
// A new epoch is independent of the historical one-shot trial. No arm API.
export const CONTINUOUS_SCHEMA = `CREATE TABLE IF NOT EXISTS qa_auto_d1_continuous_epoch (
 activated_at INTEGER PRIMARY KEY CHECK(activated_at>0),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 quota_checked_at INTEGER NOT NULL DEFAULT 0 CHECK(quota_checked_at>=0),
 quota_valid_until INTEGER NOT NULL DEFAULT 0 CHECK(quota_valid_until>=quota_checked_at AND quota_valid_until<=quota_checked_at+86400000)
);
CREATE UNIQUE INDEX IF NOT EXISTS qa_auto_d1_continuous_one_active ON qa_auto_d1_continuous_epoch(enabled) WHERE enabled=1;`;
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
   const r = await db.prepare(`SELECT c.quota_valid_until AS until_ms FROM qa_auto_d1_continuous_epoch c
    WHERE c.activated_at=? AND c.enabled=1 AND c.activated_at<=${clock}
    AND c.quota_checked_at>=c.activated_at AND c.quota_checked_at<=${clock}
    AND c.quota_valid_until>=${clock}+? AND c.quota_valid_until<=c.quota_checked_at+86400000
    AND EXISTS (SELECT 1 FROM atrio_qa_identity WHERE project_id='atrio-catolico-qa-general')
    AND NOT EXISTS (SELECT 1 FROM atrio_qa_identity WHERE project_id<>'atrio-catolico-qa-general')
    AND NOT EXISTS (SELECT 1 FROM qa_auto_d1_activation_lab WHERE enabled=1)
    AND NOT EXISTS (SELECT 1 FROM qa_auto_d1_trial_lab WHERE activated_at=c.activated_at)`).bind(activatedAt,margin).first();
   return positive(r?.until_ms) ? r.until_ms : null;
  } catch { return null; }
 };
}
