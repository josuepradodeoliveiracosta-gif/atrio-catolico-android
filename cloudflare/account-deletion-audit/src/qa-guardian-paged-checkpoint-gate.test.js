import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {scanPagedCycle} from '../../guardian-worker/src/scan-paged.js';
import {processDocument,processReport} from '../../guardian-worker/src/index.js';
import {ROOT,str} from '../../guardian-worker/src/firestore.js';
import {createQaPrivilegedWriteBarrier} from './qa-privileged-write-barrier.js';
import {createQaGuardianPagedCheckpointGate,QA_GUARDIAN_CHECKPOINT_READINESS}
  from './qa-guardian-paged-checkpoint-gate.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const NOW='2026-10-31T15:30:00.000Z';
const WHEN='2026-10-31T15:25:00.000Z';
const SCHEMA=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
const content=(uid,id)=>({
  name:ROOT+'/posts/qa_topic/replies/'+id,
  updateTime:'2026-10-31T15:25:03.000Z',
  fields:{uid:str(uid),body:str('Clique https://exemplo.invalid para informar sua senha'),
    createdAt:{timestampValue:WHEN}}
});
class FakeGuardian {
  resource=ROOT;
  constructor(records=[]){
    this.data=new Map(records.map(x=>[x.name,x]));
    this.updated=0;this.commits=0;
  }
  async get(path){return this.data.get(ROOT+'/'+path)||null;}
  async create(path,fields){
    if(await this.get(path))throw Error('qa_mock_conflict');
    this.data.set(ROOT+'/'+path,{name:ROOT+'/'+path,fields,updateTime:'v'+(++this.updated)});
  }
  async update(path,fields,version){
    const prev=await this.get(path);
    if(!prev||prev.updateTime!==version)throw Error('qa_mock_conflict');
    this.data.set(ROOT+'/'+path,{...prev,fields,updateTime:'v'+(++this.updated)});
  }
  async scanPage(group,{since,until,after,max,field}){
    const pathMatcher=group==='replies'
      ?/^posts\/[^/]+\/replies\/[^/]+$/
      :new RegExp('^'+group+'/[^/]+$');
    const rows=[...this.data.values()].filter(d=>{
      const path=d.name.slice(ROOT.length+1);
      const date=d.fields?.[field]?.timestampValue;
      return pathMatcher.test(path)&&date &&
        Date.parse(date)>=Date.parse(since)&&Date.parse(date)<=Date.parse(until);
    }).sort((x,y)=>y.name.localeCompare(x.name));
    let start=0;
    if(after){
      const index=rows.findIndex(d=>d.name===after.name);
      if(index<0)throw Error('qa_missing_cursor');
      start=index+1;
    }
    const docs=rows.slice(start,start+max);
    const last=docs.at(-1);
    return {documents:docs,nextCursor:rows.length>start+max?
      {name:last.name,time:last.fields[field].timestampValue}:null};
  }
  async commit(writes){
    this.commits++;
    for(const item of writes){
      const name=item.update?.name||item.delete||item.verify;
      const prev=this.data.get(name);
      if(item.currentDocument?.exists===false&&prev)
        throw Error('qa_mock_conflict');
      if(item.currentDocument?.updateTime &&
         (!prev||prev.updateTime!==item.currentDocument.updateTime))
        throw Error('qa_mock_conflict');
    }
    for(const item of writes){
      if(item.verify)continue;
      if(item.delete){this.data.delete(item.delete);continue;}
      const name=item.update.name;
      const prev=this.data.get(name);
      this.data.set(name,{name,updateTime:'v'+(++this.updated),
        fields:{...(prev?.fields||{}),...item.update.fields}});
    }
    return {};
  }
}
function setup(records=[]){
  const sql=new DatabaseSync(':memory:');
  sql.exec(SCHEMA);
  const db=new FakeGuardian(records);
  const adapter={
    prepare(statement){return {bind(...values){return{
      async first(){return sql.prepare(statement).get(...values)||null;},
      async all(){return{results:sql.prepare(statement).all(...values)};}
    };}};}
  };
  const barrier=createQaPrivilegedWriteBarrier(adapter);
  const gate=()=>createQaGuardianPagedCheckpointGate({
    db,barrier,verifyEffect:async()=>true
  });
  return {sql,db,barrier,gate};
}
const C=(mode,start,end,name='',time='')=>({
  mode:str(mode),windowStart:str(start),windowEnd:str(end),
  cursorName:str(name),cursorTime:str(time)
});
test('actual paged scanner persists only fixed global checkpoints and guarded moderation',async()=>{
  const t=setup([content(B,'qa_reply')]);
  try{
    const result=await scanPagedCycle(t.gate(),{enabled:true,allowHold:false},
      {onDocument:processDocument,onReport:processReport},NOW);
    assert.equal(result.error,0);
    assert.equal(result.review,1);
    assert.equal(t.db.commits,1);
    const state=await t.db.get('guardian_runtime/scan_replies');
    assert.equal(state.fields.mode.stringValue,'complete');
    assert.equal((await t.barrier.status(B)).inFlight,0);
    assert.equal(QA_GUARDIAN_CHECKPOINT_READINESS.productionIntegrated,false);
  }finally{t.sql.close();}
});
test('frozen owner stops paged scan without advancing cursor beyond failed case',async()=>{
  const t=setup([content(A,'qa_reply')]);
  try{
    await t.barrier.beginFreeze(A);await t.barrier.finalizeFreeze(A);
    const result=await scanPagedCycle(t.gate(),{enabled:true,allowHold:false},
      {onDocument:processDocument,onReport:processReport},NOW);
    assert.equal(result.error,1);
    assert.equal(result.pausedGroups,1);
    assert.equal(t.db.commits,0);
    const state=await t.db.get('guardian_runtime/scan_replies');
    assert.equal(state.fields.mode.stringValue,'running');
    assert.equal(state.fields.cursorName.stringValue,'');
    // Restart a new QA wrapper: the persisted unadvanced cursor remains.
    const again=await scanPagedCycle(t.gate(),{enabled:true,allowHold:false},
      {onDocument:processDocument,onReport:processReport},NOW);
    assert.equal(again.error,1);
    assert.equal((await t.db.get('guardian_runtime/scan_replies'))
      .fields.cursorName.stringValue,'');
    assert.equal(t.db.commits,0);
  }finally{t.sql.close();}
});
test('unknown paths, malformed fields and direct account writes fail before mutation',async()=>{
  const t=setup();
  try{
    const g=t.gate(),v=C('running','2026-10-31T15:10:00.000Z',NOW);
    for(const path of ['users/'+A+'/notifications/qa','guardian_runtime/last_scan',
      'guardian_runtime/scan_unlisted','guardian_cases/guard_fake']){
      await assert.rejects(g.create(path,v),/qa_guardian_checkpoint_unlisted_path/);
    }
    await assert.rejects(g.create('guardian_runtime/scan_posts',{
      ...v,uid:str(A)}),/qa_guardian_checkpoint_invalid_fields/);
    await assert.rejects(g.create('guardian_runtime/scan_posts',
      C('complete','2026-10-31T15:10:00.000Z',NOW)),
      /qa_guardian_checkpoint_invalid_create/);
    await g.create('guardian_runtime/scan_posts',v);
    await assert.rejects(g.update('guardian_runtime/scan_posts',v,'forged'),
      /qa_guardian_checkpoint_stale_version/);
    assert.equal(t.db.commits,0);
    assert.equal((await t.barrier.status(A)).inFlight,0);
  }finally{t.sql.close();}
});
test('forged cursor, time regression and completed checkpoint cannot be accepted',async()=>{
  const t=setup();
  try{
    const g=t.gate(),start='2026-10-31T15:10:00.000Z';
    await g.create('guardian_runtime/scan_posts',C('running',start,NOW));
    let current=await t.db.get('guardian_runtime/scan_posts');
    const fake=ROOT+'/users/'+A+'/notifications/qa';
    await assert.rejects(g.update('guardian_runtime/scan_posts',
      C('running',start,NOW,fake,WHEN),current.updateTime),
      /qa_guardian_checkpoint_invalid_cursor/);
    await assert.rejects(g.update('guardian_runtime/scan_posts',
      C('complete',start,NOW,'posts/qa_wrong',WHEN),current.updateTime),
      /qa_guardian_checkpoint_invalid_state/);
    await g.update('guardian_runtime/scan_posts',C('complete',start,NOW),
      current.updateTime);
    current=await t.db.get('guardian_runtime/scan_posts');
    await assert.rejects(g.update('guardian_runtime/scan_posts',
      C('complete',start,NOW),current.updateTime),
      /qa_guardian_checkpoint_invalid_transition/);
    await assert.rejects(g.update('guardian_runtime/scan_posts',
      C('running',start,'2026-10-31T15:20:00.000Z'),current.updateTime),
      /qa_guardian_checkpoint_invalid_transition/);
    assert.equal(t.db.commits,0);
  }finally{t.sql.close();}
});
