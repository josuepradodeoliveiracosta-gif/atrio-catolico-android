// Conservative laboratory reservations, not billing metrics. One persistent
// UTC day across all invocations, no refunds. No schema installed remotely.
import {continuousActiveSql} from './qa-automatic-continuous-gate.mjs';
export const D1_LAB_LIMITS=Object.freeze({discovery:1440,work:60,notice:200});
// Discovery: two reads; work: four 21-read snapshots + two 6-read device lists.
// Notice: one 21-read snapshot. Count empty bounded queries conservatively.
export const D1_LAB_ENVELOPE=Object.freeze({
 reads:1440*2+60*(4*21+2*6)+200*21,
 writesFirestore:0,externalPerTick:35,externalPerNotice:10,d1CallsPerTick:24,d1CallsPerNotice:10
});
export const D1_LAB_BUDGET_SCHEMA=`CREATE TABLE IF NOT EXISTS qa_auto_d1_budget_lab (
 day TEXT PRIMARY KEY,
 discovery INTEGER NOT NULL CHECK(discovery BETWEEN 0 AND 1440),
 work INTEGER NOT NULL CHECK(work BETWEEN 0 AND 60),
 notice INTEGER NOT NULL CHECK(notice BETWEEN 0 AND 200)
);`;
const SQL="INSERT INTO qa_auto_d1_budget_lab(day,discovery,work,notice) VALUES(strftime('%Y-%m-%d','now'),?,?,?)"+
 " ON CONFLICT(day) DO UPDATE SET discovery=discovery+excluded.discovery,work=work+excluded.work,notice=notice+excluded.notice"+
 " WHERE discovery+excluded.discovery<=1440 AND work+excluded.work<=60 AND notice+excluded.notice<=200";
// Continuous mode shares the historical UTC counters, but allows less work
// and notice traffic. Any Pacific calendar day is contained in two UTC dates,
// including DST transitions. Reserve against both dates atomically. This is
// an application envelope, never a claim about actual provider billing.
export const D1_CONTINUOUS_LIMITS=Object.freeze({discovery:1440,work:20,notice:75});
export const D1_CONTINUOUS_TWO_DAY_READS=12840;
const weights=Object.freeze({discovery:2,work:96,notice:21});
const continuousSql="INSERT INTO qa_auto_d1_budget_lab(day,discovery,work,notice) "+
 "SELECT strftime('%Y-%m-%d','now'),?,?,? WHERE "+continuousActiveSql()+
 " AND (SELECT COALESCE(SUM(discovery*2+work*96+notice*21),0) FROM qa_auto_d1_budget_lab "+
 "WHERE day BETWEEN date('now','-1 day') AND date('now'))+?<=12840"+
 " ON CONFLICT(day) DO UPDATE SET discovery=discovery+excluded.discovery,work=work+excluded.work,notice=notice+excluded.notice"+
 " WHERE discovery+excluded.discovery<=1440 AND work+excluded.work<=20 AND notice+excluded.notice<=75";
const units=Object.freeze({discovery:[1,0,0],work:[0,1,0],notice:[0,0,1]});
export function createD1DailyBudgetLab({db,enabled=false,continuous=false,activatedAt}={}){
 if(typeof db?.prepare!=='function')throw Error('missing_lab_db');
 return async stage=>{
  if(enabled!==true||!Object.hasOwn(units,stage))return false;
  if(continuous===true&&(!Number.isSafeInteger(activatedAt)||activatedAt<=0))return false;
  try{const r=continuous===true?await db.prepare(continuousSql).bind(...units[stage],activatedAt,weights[stage]).run():
   await db.prepare(SQL).bind(...units[stage]).run();return r?.success===true&&r.meta?.changes===1}
  catch{return false}
 };
}
// Per invocation. Count attempts before I/O. A separate finish slot prevents
// a D1 quota rejection in earlier stages from consuming the terminal write.
export function createD1InvocationBudgetLab(kind){
 if(!['tick','notice'].includes(kind))throw Error('invalid_budget_kind');
 const max=kind==='tick'?D1_LAB_ENVELOPE.externalPerTick:D1_LAB_ENVELOPE.externalPerNotice;
 const maxSql=kind==='tick'?D1_LAB_ENVELOPE.d1CallsPerTick:D1_LAB_ENVELOPE.d1CallsPerNotice;
 let external=2,d1=0,finished=false; // reserve cold credential slots; not actual calls
 const fail=()=>{throw Error('d1_invocation_budget')};
 return Object.freeze({
  chargeExternal(n=1){if(!Number.isSafeInteger(n)||n<1||external+n>max)fail();external+=n},
  chargeD1({finish=false}={}){
   if(finish){if(kind!=='tick'||finished||d1>=maxSql)fail();finished=true}
   else if(d1>=maxSql-(kind==='tick'&&!finished?1:0))fail();
   d1++;
  },
  snapshot:()=>({externalReserved:external,d1Calls:d1})
 });
}
