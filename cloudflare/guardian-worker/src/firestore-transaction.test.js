import test from 'node:test';
import assert from 'node:assert/strict';
import {Firestore} from './firestore.js';
const db=()=>new Firestore('qa-token','demo-atrio-v11','http://127.0.0.1:8089/v1');
const tx='cWEtb25seS10eA==';
const check=(s,uid='alice')=>({verify:s.resource+'/account_deletion_freeze/'+uid,currentDocument:{exists:false}});
const update=s=>({update:{name:s.resource+'/guardian_audit/qa-test',fields:{source:{stringValue:'qa-only'}}},currentDocument:{exists:false}});
const resp=(x,status=200)=>Response.json(x,{status});
async function stub(fn,body){
  const prev=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,opts={})=>{
    const c={url:String(url),method:opts.method||'GET',payload:opts.body?JSON.parse(opts.body):null};
    calls.push(c);
    return fn(c,calls);
  };
  try{await body(calls)}finally{globalThis.fetch=prev}
}
test('REST batch normal dispensa transacao',async()=>{
 const s=db();await stub(c=>{
   assert.ok(c.url.endsWith(':commit'));
   assert.deepEqual(c.payload.writes,[update(s)]);
   return resp({});
 },async calls=>{await s.commit([update(s)]);assert.equal(calls.length,1)});
});
test('REST batchGet newTransaction verifica marcador ausente antes do commit',async()=>{
 const s=db(),name=s.resource+'/account_deletion_freeze/alice';
 await stub(c=>{
   if(c.url.endsWith(':batchGet')){
     assert.deepEqual(c.payload,{documents:[name],newTransaction:{readWrite:{}}});
     return resp([{transaction:tx,missing:name}]);
   }
   if(c.url.endsWith(':commit')){
     assert.equal(c.payload.transaction,tx);
     assert.deepEqual(c.payload.writes,[update(s)]);
     return resp({});
   }
   throw Error('unexpected '+c.url);
 },async calls=>{
   await s.commit([update(s),check(s)]);
   assert.deepEqual(calls.map(x=>x.method),['POST','POST']);
 });
});
test('REST marcador presente nega escrita e faz rollback',async()=>{
 const s=db(),name=s.resource+'/account_deletion_freeze/alice';
 await stub(c=>{
   if(c.url.endsWith(':batchGet'))return resp([{transaction:tx,found:{name,updateTime:'2026-11-01T10:00:00Z'}}]);
   if(c.url.endsWith(':rollback'))return resp({});
   throw Error('unsafe write');
 },async calls=>{
   await assert.rejects(s.commit([update(s),check(s)]),/verified_document_changed/);
   assert.equal(calls.some(x=>x.url.endsWith(':commit')),false);
   assert.equal(calls.some(x=>x.url.endsWith(':rollback')),true);
 });
});
test('REST commit abortado ao criar marcador em paralelo falha fechado',async()=>{
 const s=db(),name=s.resource+'/account_deletion_freeze/alice';
 await stub(c=>{
   if(c.url.endsWith(':batchGet'))return resp([{transaction:tx,missing:name}]);
   if(c.url.endsWith(':commit'))return resp({error:{status:'ABORTED'}},409);
   if(c.url.endsWith(':rollback'))return resp({});
   throw Error('unexpected REST call');
 },async calls=>{
   await assert.rejects(s.commit([update(s),check(s)]),e=>e?.status===409);
   assert.equal(calls.filter(x=>x.url.endsWith(':commit')).length,1);
 });
});
test('REST falha na leitura do marcador nao faz commit',async()=>{
 const s=db();await stub(c=>{
   if(c.url.endsWith(':batchGet'))return resp({error:{status:'UNAVAILABLE'}},503);
   throw Error('unsafe write');
 },async calls=>{
   await assert.rejects(s.commit([update(s),check(s)]),/firestore_http_503/);
   assert.equal(calls.some(x=>x.url.endsWith(':commit')),false);
 });
});
test('REST condicao de versao na mesma transacao',async()=>{
 const s=db(),name=s.resource+'/posts/p1',version='2026-11-01T10:00:00Z';
 await stub(c=>{
   if(c.url.endsWith(':batchGet'))return resp([{transaction:tx,found:{name,updateTime:version}}]);
   if(c.url.endsWith(':commit'))return resp({});
   throw Error('unexpected');
 },async()=>{await s.commit([update(s),{verify:name,currentDocument:{updateTime:version}}])});
});
test('REST recusa versao divergente, falta de linha e token ausente',async()=>{
 const s=db(),name=s.resource+'/posts/p1',version='2026-11-01T10:00:00Z';
 let kind='stale';
 await stub(c=>{
   if(c.url.endsWith(':batchGet')){
     if(kind==='stale')return resp([{transaction:tx,found:{name,updateTime:'2026-11-01T11:00:00Z'}}]);
     if(kind==='empty')return resp([{transaction:tx}]);
     if(kind==='token')return resp([{missing:name}]);
   }
   if(c.url.endsWith(':rollback'))return resp({});
   throw Error('unexpected');
 },async calls=>{
   for(kind of ['stale','empty','token']){
     await assert.rejects(s.commit([update(s),{verify:name,currentDocument:{updateTime:version}}]));
   }
   assert.equal(calls.some(c=>c.url.endsWith(':commit')),false);
 });
});
test('REST recusas antes da rede para paths e operacoes malformadas',async()=>{
 const s=db();
 await stub(()=>{throw Error('network must not be called')},async calls=>{
   for(const invalid of [
     {verify:'../../outside',currentDocument:{exists:false}},
     {verify:s.resource+'/posts/p1',currentDocument:{exists:true}},
     {verify:s.resource+'/posts/p1',currentDocument:{exists:false},delete:s.resource+'/posts/p1'}
   ]) await assert.rejects(s.commit([update(s),invalid]),/invalid_firestore_verify/);
   assert.equal(calls.length,0);
 });
});
test('REST resposta batchGet pode conter varios documentos fora de ordem',async()=>{
 const s=db(),a=s.resource+'/account_deletion_freeze/alice',
 b=s.resource+'/posts/p1',date='2026-11-01T10:00:00Z';
 await stub(c=>{
   if(c.url.endsWith(':batchGet'))return resp([{found:{name:b,updateTime:date}},
     {transaction:tx,missing:a}]);
   if(c.url.endsWith(':commit'))return resp({});
   throw Error('unexpected');
 },async()=>{
   await s.commit([update(s),check(s),{verify:b,currentDocument:{updateTime:date}}]);
 });
});
