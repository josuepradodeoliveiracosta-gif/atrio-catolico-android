// Laboratory D1 contract. Not installed in any remote database.
// Reservation is conservative: charge before work, never refund, even on failure.
// UTC windows are internal budgets, not Firebase's Pacific-time quota windows.
export const FREE_BUDGET_SCHEMA=`CREATE TABLE IF NOT EXISTS qa_auto_daily_budget_lab (
 day TEXT PRIMARY KEY,
 discovery INTEGER NOT NULL CHECK(discovery BETWEEN 0 AND 1440),
 publication INTEGER NOT NULL CHECK(publication BETWEEN 0 AND 100),
 reads INTEGER NOT NULL CHECK(reads BETWEEN 0 AND 5280),
 writes INTEGER NOT NULL CHECK(writes BETWEEN 0 AND 300),
 requests INTEGER NOT NULL CHECK(requests BETWEEN 0 AND 3680)
 );
CREATE TABLE IF NOT EXISTS qa_auto_transport_budget_lab (
 day TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 100)
);`;
const RESERVE=`INSERT INTO qa_auto_daily_budget_lab(day,discovery,publication,reads,writes,requests)
 VALUES(strftime('%Y-%m-%d','now'),?,?,?,?,?)
 ON CONFLICT(day) DO UPDATE SET
 discovery=discovery+excluded.discovery, publication=publication+excluded.publication,
 reads=reads+excluded.reads,writes=writes+excluded.writes,requests=requests+excluded.requests
 WHERE discovery+excluded.discovery<=1440 AND publication+excluded.publication<=100
 AND reads+excluded.reads<=5280 AND writes+excluded.writes<=300
 AND requests+excluded.requests<=3680`;
const RESERVE_TRANSPORT=`INSERT INTO qa_auto_transport_budget_lab(day,attempts)
 VALUES(strftime('%Y-%m-%d','now'),1)
 ON CONFLICT(day) DO UPDATE SET attempts=attempts+1 WHERE attempts<100`;
const discovery=Object.freeze([1,0,2,0,2]);
const publication=Object.freeze([0,1,24,3,8]);
export function createFreeBudgetLab({db,enabled=false}={}){
 if(typeof db?.prepare!=='function')throw Error('missing_lab_db');
 async function reserve(values){
  if(enabled!==true)return false;
  try{
   const result=await db.prepare(RESERVE).bind(...values).run();
   return result?.success===true&&result.meta?.changes===1;
  }catch{return false}
 }
 return Object.freeze({
  reserveDiscovery:()=>reserve(discovery),
  async reserveTransport(){
   if(enabled!==true)return false;
   try{
    const r=await db.prepare(RESERVE_TRANSPORT).bind().run();
    return r?.success===true&&r.meta?.changes===1;
   }catch{return false}
  },
  reservePublication:amount=>{
   if(!amount||Object.keys(amount).length!==3||amount.reads!==24||amount.writes!==3||amount.requests!==8)
    return Promise.resolve(false);
   return reserve(publication);
  }
 });
}
