// QA-only, atomic UTC-day reservation BEFORE every Firestore fixture GET.
// This is a single-statement SQLite UPSERT, never a read-then-write counter.
// Missing D1 binding or schema fails CLOSED; no D1 resource is provisioned here.
// Credits are intentionally not refunded on Firebase errors, avoiding races.
export const QA_DAILY_READ_LIMIT=12;
export const QA_D1_RESERVE_SQL='INSERT INTO guardian_qa_daily_budget(day,used) VALUES (?1,1) ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<?2 RETURNING used';

export async function reserveQaDailyRead(env,{clock=Date.now}={}){
 const db=env?.GUARDIAN_QA_BUDGET_DB;
 if(typeof db?.prepare!=='function')return 'unavailable';
 try{
  const now=clock();
  if(!Number.isSafeInteger(now)||now<0)return 'unavailable';
  const day=new Date(now).toISOString().slice(0,10); // UTC, not client input
  const statement=db.prepare(QA_D1_RESERVE_SQL);
  const bound=statement?.bind?.(day,QA_DAILY_READ_LIMIT);
  if(typeof bound?.first!=='function')return 'unavailable';
  const row=await bound.first();
  if(row===null)return 'limited';
  if(!Number.isSafeInteger(row?.used)||row.used<1||row.used>QA_DAILY_READ_LIMIT)
   return 'unavailable';
  return 'allowed';
 }catch{return 'unavailable';}
}
