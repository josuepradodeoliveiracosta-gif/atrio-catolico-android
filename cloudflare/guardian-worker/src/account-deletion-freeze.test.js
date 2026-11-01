import test from 'node:test';
import assert from 'node:assert/strict';
import {guardianAccountFrozen,processDocument} from './index.js';
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
