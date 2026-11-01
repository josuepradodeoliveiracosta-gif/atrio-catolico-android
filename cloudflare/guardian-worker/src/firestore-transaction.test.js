import test from 'node:test';
import assert from 'node:assert/strict';
import {Firestore} from './firestore.js';

const makeDb=()=>new Firestore('qa-token','demo-atrio-v11','http://127.0.0.1:8089/v1');
const tx='cWEtb25seS10eA==';
const check=(db,uid='alice')=>({verify:db.resource+'/account_deletion_freeze/'+uid,
 currentDocument:{exists:false}});
const update=db=>({update:{name:db.resource+'/guardian_audit/qa-test',
 fields:{source:{stringValue:'qa-only'}}},currentDocument:{exists:false}});
const response=(data,status=200)=>Response.json(data,{status});
const withMock=async(handler,body)=>{
 const prev=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(url,options={})=>{
   const item={url:String(url),method:options.method||'GET',
    payload:options.body?JSON.parse(options.body):null};
   calls.push(item);
   return handler(item,calls);
 };
 try{return await body(calls)}finally{globalThis.fetch=prev}
};

test('REST: writes comuns sem verify usam apenas commit normal',async()=>{
 const db=makeDb();
 await withMock(item=>{
   assert.match(item.url,/:commit$/);
   assert.equal(item.payload.transaction,undefined);
   assert.deepEqual(item.payload.writes,[update(db)]);
   return response({});
 },async calls=>{
   await db.commit([update(db)]);
   assert.equal(calls.length,1);
 });
});
test('REST: verify ausente inicia transacao e nao envia operacao verify invalida',async()=>{
 const db=makeDb();
 await withMock(item=>{
   if(item.url.endsWith(':beginTransaction'))return response({transaction:tx});
   if(item.method==='GET'&&item.url.includes('/account_deletion_freeze/alice?transaction='))
     return response({error:{status:'NOT_FOUND'}},404);
   if(item.url.endsWith(':commit')){
     assert.equal(item.payload.transaction,tx);
     assert.deepEqual(item.payload.writes,[update(db)]);
     assert.equal(item.payload.writes.some(w=>Object.hasOwn(w,'verify')),false);
     return response({writeResults:[{}]});
   }
   throw Error('unexpected REST call '+item.url);
 },async calls=>{
   await db.commit([update(db),check(db)]);
   assert.deepEqual(calls.map(x=>x.method),['POST','GET','POST']);
 });
});
test('REST: marcador presente nega commit e faz rollback',async()=>{
 const db=makeDb();
 await withMock(item=>{
   if(item.url.endsWith(':beginTransaction'))return response({transaction:tx});
   if(item.method==='GET')return response({name:db.resource+'/account_deletion_freeze/alice',updateTime:'2026-11-01T10:00:00Z'});
   if(item.url.endsWith(':rollback'))return response({});
   throw Error('unsafe commit attempted');
 },async calls=>{
   await assert.rejects(db.commit([update(db),check(db)]),/verified_document_changed/);
   assert.deepEqual(calls.map(x=>x.url.split(':').at(-1).split('?')[0]).slice(-1),['rollback']);
   assert.equal(calls.some(x=>x.url.endsWith(':commit')),false);
 });
});
test('REST: alteracao entre leitura e commit aborta sem bypass',async()=>{
 const db=makeDb();
 await withMock(item=>{
   if(item.url.endsWith(':beginTransaction'))return response({transaction:tx});
   if(item.method==='GET')return response({},404);
   if(item.url.endsWith(':commit'))
     return response({error:{status:'ABORTED'}},409);
   if(item.url.endsWith(':rollback'))return response({});
   throw Error('unexpected');
 },async calls=>{
   await assert.rejects(db.commit([update(db),check(db)]),
     err=>err.status===409);
   assert.equal(calls.some(x=>x.url.endsWith(':commit')),true);
   assert.equal(calls.some(x=>x.url.endsWith(':rollback')),true);
 });
});
test('REST: falha na leitura do freeze interrompe antes de escrever',async()=>{
 const db=makeDb();
 await withMock(item=>{
   if(item.url.endsWith(':beginTransaction'))return response({transaction:tx});
   if(item.method==='GET')return response({error:{status:'UNAVAILABLE'}},503);
   if(item.url.endsWith(':rollback'))return response({});
   throw Error('unsafe commit attempted');
 },async calls=>{
   await assert.rejects(db.commit([update(db),check(db)]),/firestore_http_503/);
   assert.equal(calls.some(x=>x.url.endsWith(':commit')),false);
 });
});
test('REST: verifica revisao original na mesma transacao',async()=>{
 const db=makeDb();
 const source=db.resource+'/posts/p1',stamp='2026-11-01T10:00:00Z';
 await withMock(item=>{
   if(item.url.endsWith(':beginTransaction'))return response({transaction:tx});
   if(item.method==='GET')return response({name:source,updateTime:stamp});
   if(item.url.endsWith(':commit'))return response({});
   throw Error('unexpected');
 },async()=>{
   await db.commit([update(db),{verify:source,currentDocument:{updateTime:stamp}}]);
 });
});
test('REST: precondicao incorreta nao cria transacao nem altera banco',async()=>{
 const db=makeDb();
 await withMock(()=>{throw Error('network must not be called')},async calls=>{
   await assert.rejects(db.commit([update(db),{verify:'../../outside',currentDocument:{exists:false}}]),
     /invalid_firestore_verify_path/);
   await assert.rejects(db.commit([update(db),{verify:db.resource+'/posts/p1',currentDocument:{exists:true}}]),
     /invalid_firestore_verify_condition/);
   assert.equal(calls.length,0);
 });
});

test('REST: verify com mutacao escondida no mesmo elemento e recusado',async()=>{
 const db=makeDb();
 await withMock(()=>{throw Error('network must not be called')},async calls=>{
   await assert.rejects(db.commit([update(db),{
     verify:db.resource+'/account_deletion_freeze/alice',
     currentDocument:{exists:false},
     delete:db.resource+'/posts/qa'
   }]),/invalid_firestore_verify_operation/);
   assert.equal(calls.length,0);
 });
});
