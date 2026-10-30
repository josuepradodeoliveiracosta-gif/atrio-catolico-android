import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localBridgeProbe} from './qa-bridge-auth-local.mjs';
const id='a'.repeat(30)+'.'+'b'.repeat(50)+'.'+'c'.repeat(70);
const url='https://firestore.googleapis.com/v1/projects/atrio-catolico-qa-v2/databases/(default)/documents/posts/qa_post_1';
const fixture=(body='Como funciona o calendário litúrgico?')=>({
 name:'projects/atrio-catolico-qa-v2/databases/(default)/documents/posts/qa_post_1',
 fields:{qaFixture:{booleanValue:true},title:{stringValue:'Dúvida fictícia sobre a Missa'},
  body:{stringValue:body}}
});
test('usa a ponte verdadeira com um único GET e D1/limites simulados',async()=>{
 const calls=[];
 const r=await localBridgeProbe(id,{fetcher:async(path,opts)=>{
  calls.push([path,opts]);return new Response(JSON.stringify(fixture()),{status:200});
 }});
 assert.deepEqual(r,{status:'passed',code:'qa_fixture_clear',gets:1});
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],url);
 assert.equal(calls[0][1].method,'GET');
 assert.equal(calls[0][1].headers.Authorization,'Bearer '+id);
 assert.equal(calls[0][1].redirect,'error');
 assert.ok(!JSON.stringify(r).includes(id));
 assert.ok(!JSON.stringify(r).includes('Missa'));
});
test('fraude é classificação de revisão, não intervenção',async()=>{
 const r=await localBridgeProbe(id,{fetcher:async()=>new Response(JSON.stringify(
  fixture('Clique https://exemplo.invalid e informe sua senha')
 ),{status:200})});
 assert.deepEqual(r,{status:'passed',code:'qa_fixture_review',gets:1});
});
test('nenhuma rede para token malformado',async()=>{
 let calls=0;
 const r=await localBridgeProbe('not-an-id-token',{fetcher:async()=>{calls++;throw Error('bad');}});
 assert.deepEqual(r,{status:'blocked',code:'invalid_token',gets:0});
 assert.equal(calls,0);
});
test('Firestore nega token e a ponte falha fechada, sem revelar token',async()=>{
 const r=await localBridgeProbe(id,{fetcher:async()=>new Response('{}',{status:403})});
 assert.deepEqual(r,{status:'blocked',code:'qa_bridge_failed',gets:1});
 assert.ok(!JSON.stringify(r).includes(id));
});
test('nome do projeto ou fixture adulterado é rejeitado',async()=>{
 const changed=fixture();
 changed.name='projects/atrio-catolico/databases/(default)/documents/posts/qa_post_1';
 const r=await localBridgeProbe(id,{fetcher:async()=>new Response(JSON.stringify(changed),{status:200})});
 assert.deepEqual(r,{status:'blocked',code:'qa_bridge_failed',gets:1});
});
test('erro de rede da consulta QA nunca vira sucesso',async()=>{
 const r=await localBridgeProbe(id,{fetcher:async()=>{throw Error('secret '+id);}});
 assert.deepEqual(r,{status:'blocked',code:'qa_bridge_failed',gets:1});
 assert.ok(!JSON.stringify(r).includes(id));
});
