import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scanPagedCycle} from './scan-paged.js';
import {Firestore} from './firestore.js';

const now='2026-10-29T20:00:00.000Z';
const root='projects/demo-atrio-v11/databases/(default)/documents/';
const t='2026-10-29T19:59:00.000Z';
class CheckpointDb {
 constructor(number=0) {
  this.states=new Map();this.modified=0;this.queries=[];this.calls=[];
  this.source=Array.from({length:number},(_,i)=>({
    name:root+'posts/p'+String(i).padStart(3,'0'),
    fields:{createdAt:{timestampValue:t}}
  })).reverse();
 }
 async get(path){return this.states.get(path)||null}
 async create(path,fields){if(this.states.has(path))throw Error('conflict');
  this.states.set(path,{fields,updateTime:'v'+(++this.modified)})}
 async update(path,fields,oldTime){
  if(this.states.get(path)?.updateTime!==oldTime)throw Error('conflict');
  this.states.set(path,{fields,updateTime:'v'+(++this.modified)})
 }
 async scanPage(group,{since,until,after,max,field='createdAt'}){
  this.queries.push({group,since,until,after,max});
  let docs=group==='posts'?this.source.filter(x=>
    x.fields[field]?.timestampValue &&
    Date.parse(x.fields[field].timestampValue)>=Date.parse(since)&&
    Date.parse(x.fields[field].timestampValue)<=Date.parse(until)):[];
  if(after){const idx=docs.findIndex(x=>x.name===after.name);if(idx<0)throw Error('bad cursor');docs=docs.slice(idx+1);}
  const current=docs.slice(0,max);
  const last=current.at(-1);
  return {documents:current,nextCursor:docs.length>max?{
    name:last.name,time:last.fields[field].timestampValue}:null};
 }
}
const callbacks={onDocument:async(db,doc)=>{db.calls.push(doc.name);return 'clear';},
  onReport:async()=> 'ignored'};
test('paginação percorre 65 publicações em várias execuções, sem repetir ou perder',async()=>{
 const db=new CheckpointDb(65);
 const first=await scanPagedCycle(db,{enabled:true},callbacks,now);
 assert.equal(first.clear,60);assert.equal(first.backlogGroups,1);assert.equal(first.pages,5);
 const state=db.states.get('guardian_runtime/scan_posts');
 assert.equal(state.fields.mode.stringValue,'running');
 assert.ok(state.fields.cursorName.stringValue.endsWith('/posts/p005'));
 const next=await scanPagedCycle(db,{enabled:true},callbacks,now);
 assert.equal(next.clear,5);assert.equal(next.backlogGroups,0);
 assert.equal(db.calls.length,65);
 assert.equal(new Set(db.calls).size,65);
 assert.equal(db.states.get('guardian_runtime/scan_posts').fields.mode.stringValue,'complete');
});
test('falha na publicação pausa o lote sem avançar checkpoint',async()=>{
 const db=new CheckpointDb(35);
 let first=true;
 const cb={...callbacks,onDocument:async(_db,doc)=>{
   if(doc.name.endsWith('/posts/p019')&&first){first=false;throw Error('retry')}
   db.calls.push(doc.name);return 'clear';
 }};
 const res=await scanPagedCycle(db,{enabled:true},cb,now);
 assert.equal(res.error,1);
 assert.equal(res.pausedGroups,1);
 const state=db.states.get('guardian_runtime/scan_posts');
 assert.equal(state.fields.cursorName.stringValue,'');
 assert.equal(state.fields.mode.stringValue,'running');
 const second=await scanPagedCycle(db,{enabled:true},callbacks,now);
 assert.equal(second.clear,35);
 assert.equal(db.states.get('guardian_runtime/scan_posts').fields.mode.stringValue,'complete');
});
test('checkpoint completo reabre apenas o intervalo posterior, com sobreposição de 1 segundo',async()=>{
 const db=new CheckpointDb(2);
 await scanPagedCycle(db,{enabled:true},callbacks,now);
 const later='2026-10-29T20:05:00.000Z';
 db.source.unshift({name:root+'posts/new',fields:{createdAt:{timestampValue:'2026-10-29T20:02:00.000Z'}}});
 const res=await scanPagedCycle(db,{enabled:true},callbacks,later);
 assert.equal(res.clear,1);
 const q=db.queries.filter(q=>q.group==='posts').at(-1);
 assert.equal(q.since,'2026-10-29T19:59:59.000Z');
 assert.equal(q.until,later);
});
test('sem habilitação, nenhuma leitura nem escrita ocorre',async()=>{
 const db=new CheckpointDb(50);
 const res=await scanPagedCycle(db,{enabled:false},callbacks,now);
 assert.deepEqual(res,{status:'disabled'});
 assert.equal(db.states.size,0);assert.equal(db.queries.length,0);
});
test('checkpoint inválido causa parada segura sem descartar o estado',async()=>{
 const db=new CheckpointDb(3);
 db.states.set('guardian_runtime/scan_posts',{updateTime:'v1',
  fields:{mode:{stringValue:'running'},windowStart:{stringValue:now},
   windowEnd:{stringValue:'2026-10-29T19:00:00.000Z'}}});
 const result=await scanPagedCycle(db,{enabled:true},callbacks,now);
 assert.equal(result.error,1);assert.equal(result.pausedGroups,1);
 assert.equal(db.queries.some(q=>q.group==='posts'),false);
 assert.equal(db.states.get('guardian_runtime/scan_posts').updateTime,'v1');
});
test('adaptação de página Firestore REST utiliza tie breaker __name__ e cursor validado',async()=>{
 const db=new Firestore('dummy','demo-atrio-v11','http://127.0.0.1:8089/v1');
 const old=globalThis.fetch;
 let query;
 globalThis.fetch=async(url,opts)=>{
  assert.ok(url.endsWith(':runQuery'));
  query=JSON.parse(opts.body).structuredQuery;
  return new Response(JSON.stringify([
    {document:{name:db.resource+'/posts/p2',fields:{createdAt:{timestampValue:t}}}},
    {document:{name:db.resource+'/posts/p1',fields:{createdAt:{timestampValue:t}}}},
    {document:{name:db.resource+'/posts/p0',fields:{createdAt:{timestampValue:t}}}}
  ]),{status:200});
 };
 try {
  const resp=await db.scanPage('posts',{since:'2026-10-29T19:40:00.000Z',until:now,max:2});
  assert.equal(resp.documents.length,2);
  assert.deepEqual(resp.nextCursor,{time:t,name:db.resource+'/posts/p1'});
  assert.equal(query.orderBy[1].field.fieldPath,'__name__');
  assert.equal(query.limit,3);
  assert.equal(query.where.compositeFilter.filters.length,2);
  await db.scanPage('posts',{since:'2026-10-29T19:40:00.000Z',until:now,max:2,after:resp.nextCursor});
  assert.equal(query.startAt.before,false);
  assert.equal(query.startAt.values[1].referenceValue,db.resource+'/posts/p1');
  await assert.rejects(db.scanPage('posts',{since:'2026-10-29T19:40:00.000Z',until:now,
   after:{time:t,name:'projects/atrio-catolico/databases/(default)/documents/posts/p1'}}),/invalid_scan_cursor/);
 }finally{globalThis.fetch=old;}
});

test('publicação criada ontem mas editada hoje entra pela fila post_edits',async()=>{
 const db=new CheckpointDb();
 const path=root+'posts/old1';
 db.source=[{name:path,fields:{
  createdAt:{timestampValue:'2026-10-27T12:00:00.000Z'},
  updatedAt:{timestampValue:'2026-10-29T19:58:00.000Z'}
 }}];
 const result=await scanPagedCycle(db,{enabled:true},callbacks,now);
 assert.equal(result.clear,1);
 assert.deepEqual(db.calls,[path]);
 const updated=db.queries.find(q=>q.group==='posts'&&q.field==='updatedAt');
 assert.ok(updated);
 assert.equal(db.states.get('guardian_runtime/scan_post_edits').fields.mode.stringValue,'complete');
});
test('trilha updatedAt tem checkpoint independente do createdAt',async()=>{
 const db=new CheckpointDb();
 db.source=Array.from({length:33},(_,i)=>({
   name:root+'posts/e'+String(i).padStart(3,'0'),
   fields:{
    createdAt:{timestampValue:'2026-10-27T00:00:00.000Z'},
    updatedAt:{timestampValue:'2026-10-29T19:58:00.000Z'}
   }
 })).reverse();
 const first=await scanPagedCycle(db,{enabled:true},callbacks,now);
 assert.equal(first.clear,30); // two pages of 15 edits
 assert.equal(first.backlogGroups,1);
 assert.equal(db.states.get('guardian_runtime/scan_posts').fields.mode.stringValue,'complete');
 assert.equal(db.states.get('guardian_runtime/scan_post_edits').fields.mode.stringValue,'running');
 const second=await scanPagedCycle(db,{enabled:true},callbacks,now);
 assert.equal(second.clear,3);
 assert.equal(new Set(db.calls).size,33);
});
test('scanPage rejects updatedAt for replies and reports before network',async()=>{
 const db=new Firestore('dummy','demo-atrio-v11','http://127.0.0.1:8089/v1');
 const range={since:'2026-10-29T19:40:00.000Z',until:now,max:15,field:'updatedAt'};
 await assert.rejects(db.scanPage('reports',range),/invalid_scan_page/);
 await assert.rejects(db.scanPage('replies',range),/invalid_scan_page/);
});
