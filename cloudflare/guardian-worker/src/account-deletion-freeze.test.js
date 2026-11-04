import test from 'node:test';
import assert from 'node:assert/strict';
import {guardianAccountFrozen,guardianFreezeVerifies,processDocument} from './index.js';
import {ROOT,str} from './firestore.js';

function mockDb(frozen=[],fails=null){
 const calls=[],writes=[];
 const db={
   resource:ROOT,
   async get(path){
     calls.push(path);
     if(fails===path)throw Error('firestore_read_unavailable');
     return frozen.includes(path)?{name:ROOT+'/'+path,fields:{status:str('draining')}}:null;
   },
   async commit(items){writes.push(items);}
 };
 return {db,calls,writes};
}
test('guardian: usuario sem marcador tem preflight somente leitura',async()=>{
 const {db,calls}=mockDb();
 assert.equal(await guardianAccountFrozen(db,['alice','alice']),false);
 assert.deepEqual(calls,['account_deletion_freeze/alice']);
});
test('guardian: marcador em titular ou administrador impede operacao',async()=>{
 const {db,calls}=mockDb(['account_deletion_freeze/bob']);
 assert.equal(await guardianAccountFrozen(db,['alice','bob']),true);
 assert.deepEqual(calls,['account_deletion_freeze/alice','account_deletion_freeze/bob']);
});
test('guardian: falha de lookup bloqueia sem liberar como conta ativa',async()=>{
 const {db}=mockDb([], 'account_deletion_freeze/alice');
 await assert.rejects(guardianAccountFrozen(db,['alice']),/firestore_read_unavailable/);
});
test('guardian: escopo malformado e recusado antes de ler dados privados',async()=>{
 const {db,calls}=mockDb();
 for(const input of [['../admin'],[],[''],['alice','bob','charlie']])
   await assert.rejects(guardianAccountFrozen(db,input),/guardian_freeze_invalid_scope/);
 assert.deepEqual(calls,[]);
});
test('guardian: processamento automatico de titular congelado nao faz commit',async()=>{
 const {db,writes}=mockDb(['account_deletion_freeze/alice']);
 const doc={name:ROOT+'/posts/p1',updateTime:'2026-10-29T18:00:01.000000Z',
  fields:{uid:str('alice'),title:str('Discussão'),body:str('Vou te matar amanhã')}};
 const result=await processDocument(db,doc,{enabled:true,allowHold:false});
 assert.equal(result,'frozen');
 assert.equal(writes.length,0);
});
test('guardian: resultado disponivel quando nao ha marcador e sem resposta incompleta',async()=>{
 const {db,writes}=mockDb();
 const doc={name:ROOT+'/posts/p1',updateTime:'2026-10-29T18:00:01.000000Z',
  fields:{uid:str('alice'),title:str('Discussão'),body:str('Vou te matar amanhã')}};
 assert.equal(await processDocument(db,doc,{enabled:true,allowHold:false}),'review');
 assert.equal(writes.length,1);
});

test('guardian: verificacao transacional do marcador usa resource correto e deduplica contas',()=>{
 const {db}=mockDb();
 const verifies=guardianFreezeVerifies(db,['alice','alice']);
 assert.deepEqual(verifies,[{verify:ROOT+'/account_deletion_freeze/alice',
   currentDocument:{exists:false}}]);
 assert.throws(()=>guardianFreezeVerifies(db,['../admin']),/invalid_scope/);
});
test('guardian: commit de aviso inclui verificacao atomica do marcador do titular',async()=>{
 const {db,writes}=mockDb();
 const doc={name:ROOT+'/posts/p1',updateTime:'2026-10-29T18:00:01.000000Z',
  fields:{uid:str('alice'),title:str('Discussão'),body:str('Vou te matar amanhã')}};
 assert.equal(await processDocument(db,doc,{enabled:true,allowHold:false}),'review');
 assert.equal(writes.length,1);
 assert.ok(writes[0].some(w=>w.verify===ROOT+'/account_deletion_freeze/alice'&&
   w.currentDocument?.exists===false));
 assert.ok(writes[0].some(w=>w.verify===doc.name&&
   w.currentDocument?.updateTime===doc.updateTime));
});
test('guardian: marcador criado depois do preflight aborta commit sem escrita parcial',async()=>{
 const {db,calls,writes}=mockDb();
 db.commit=async items=>{
   assert.ok(items.some(w=>w.verify===ROOT+'/account_deletion_freeze/alice'));
   const e=Error('race_freeze_detected');e.status=409;throw e;
 };
 const doc={name:ROOT+'/posts/p1',updateTime:'2026-10-29T18:00:01.000000Z',
  fields:{uid:str('alice'),title:str('Discussão'),body:str('Vou te matar amanhã')}};
 await assert.rejects(()=>processDocument(db,doc,{enabled:true,allowHold:false}),
   /race_freeze_detected/);
 assert.equal(writes.length,0);
 assert.ok(calls.includes('account_deletion_freeze/alice'));
});
