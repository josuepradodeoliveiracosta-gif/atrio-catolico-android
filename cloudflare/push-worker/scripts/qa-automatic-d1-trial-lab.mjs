// A single finite QA trial. No reset, arm, migration or delete API.
// Keep event tombstones and shared delivery markers; never recycle an epoch.
const clock="CAST(unixepoch('subsec')*1000 AS INTEGER)";
export const D1_TRIAL_SCHEMA=`CREATE TABLE IF NOT EXISTS qa_auto_d1_trial_lab (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 activated_at INTEGER NOT NULL CHECK(activated_at>0),
 ends_at INTEGER NOT NULL CHECK(ends_at>activated_at AND ends_at<=activated_at+3600000),
 ticks INTEGER NOT NULL DEFAULT 0 CHECK(ticks BETWEEN 0 AND 60),
 notices INTEGER NOT NULL DEFAULT 0 CHECK(notices BETWEEN 0 AND 200)
);
CREATE INDEX IF NOT EXISTS qa_auto_d1_outbox_expiry_lab ON qa_auto_d1_outbox_lab(expires_at);`;
export function createD1TrialGate({db,activatedAt}={}){
 if(typeof db?.prepare!=='function')throw Error('missing_trial_db');
 return async kind=>{
  if(!Number.isSafeInteger(activatedAt)||activatedAt<=0||!['tick','notice'].includes(kind))return null;
  const col=kind==='tick'?'ticks':'notices',max=kind==='tick'?60:200,margin=kind==='tick'?120000:10000;
  try{
   const row=await db.prepare('SELECT ends_at FROM qa_auto_d1_trial_lab WHERE singleton=1 AND activated_at=?').bind(activatedAt).first();
   if(!Number.isSafeInteger(row?.ends_at)||row.ends_at<=activatedAt||row.ends_at>activatedAt+3600000)return null;
   const r=await db.prepare("UPDATE qa_auto_d1_trial_lab SET "+col+"="+col+"+1 WHERE singleton=1 AND activated_at=? AND ends_at=? AND "+
    col+"<? AND activated_at<="+clock+" AND ends_at>="+clock+"+? AND EXISTS (SELECT 1 FROM qa_auto_d1_activation_lab WHERE singleton=1 AND enabled=1 AND activated_at=?)")
    .bind(activatedAt,row.ends_at,max,margin,activatedAt).run();
   return r?.success===true&&r.meta?.changes===1?row.ends_at:null;
  }catch{return null}
 };
}
export async function manualModeReady(db){
 try{
  const row=await db.prepare('SELECT enabled FROM qa_auto_d1_activation_lab WHERE singleton=1').bind().first();
  if(row?.enabled!==0)return false;
  return !await db.prepare('SELECT event_key FROM qa_auto_d1_outbox_lab WHERE expires_at>'+clock+' LIMIT 1').bind().first();
 }catch{return false}
}

export async function trialCurrent(db,activatedAt,end){
 try{
  const r=await db.prepare("SELECT t.singleton FROM qa_auto_d1_trial_lab t JOIN qa_auto_d1_activation_lab a ON a.singleton=t.singleton WHERE t.singleton=1 AND t.activated_at=? AND t.ends_at=? AND a.enabled=1 AND a.activated_at=t.activated_at AND t.ends_at>"+clock).bind(activatedAt,end).first();
  return r?.singleton===1;
 }catch{return false}
}
