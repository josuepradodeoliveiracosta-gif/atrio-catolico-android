import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FREE_BUDGET_SCHEMA,createFreeBudgetLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-budget-lab.mjs';
import {FREE_PUBLICATION_RESERVATION as reservation} from '../../cloudflare/push-worker/scripts/qa-automatic-free-publication-lab.mjs';
const bridge=db=>({prepare(sql){return {bind(...args){return {async run(){
 const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:r.changes}};
 }}}}}});
test('closed by default, rejects wrong reservation shape',async()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(FREE_BUDGET_SCHEMA);
 assert.equal(await createFreeBudgetLab({db:bridge(db)}).reserveDiscovery(),false);
 const service=createFreeBudgetLab({db:bridge(db),enabled:true});
 assert.equal(await service.reservePublication({...reservation,reads:1}),false);
 assert.equal(db.prepare('SELECT count(*) AS n FROM qa_auto_daily_budget_lab').get().n,0);
 }finally{db.close()}
});
test('persistent SQLite reservations survive process-style reopen and concurrent calls',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'atrio-budget-'));let db;
 try{
 const file=join(dir,'budget.db');db=new DatabaseSync(file);db.exec(FREE_BUDGET_SCHEMA);
 let service=createFreeBudgetLab({db:bridge(db),enabled:true});
 assert.equal(await service.reservePublication(reservation),true);
 db.close();db=new DatabaseSync(file);
 service=createFreeBudgetLab({db:bridge(db),enabled:true});
 const results=await Promise.all(Array.from({length:110},()=>service.reservePublication(reservation)));
 assert.equal(results.filter(Boolean).length,99);
 assert.equal(await service.reservePublication(reservation),false);
 const ticks=await Promise.all(Array.from({length:1450},()=>service.reserveDiscovery()));
 assert.equal(ticks.filter(Boolean).length,1440);
 const row=db.prepare('SELECT * FROM qa_auto_daily_budget_lab').get();
 assert.equal(row.publication,100);assert.equal(row.discovery,1440);
 assert.equal(row.reads,5280);assert.equal(row.writes,300);assert.equal(row.requests,3680);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true})}
});
test('old daily row cannot reset current day; failed database operation closes',async()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(FREE_BUDGET_SCHEMA);
 db.exec("INSERT INTO qa_auto_daily_budget_lab VALUES('2000-01-01',1440,100,5280,300,3680)");
 const service=createFreeBudgetLab({db:bridge(db),enabled:true});
 assert.equal(await service.reserveDiscovery(),true);
 assert.equal(db.prepare('SELECT count(*) AS n FROM qa_auto_daily_budget_lab').get().n,2);
 const broken=createFreeBudgetLab({enabled:true,db:{prepare(){throw Error('quota')}}});
 assert.equal(await broken.reserveDiscovery(),false);
 }finally{db.close()}
});
