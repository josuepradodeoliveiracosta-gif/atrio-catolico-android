import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qaReadiness} from './qa-firebase-readiness.mjs';
const project='atrio-catolico-qa-v2';
const env={QA_FIREBASE_PROJECT_ID:project,QA_APPROVED_PROJECT_ID:project,QA_ACCESS_TOKEN:'x'.repeat(30)};
const doc={name:'projects/'+project+'/databases/(default)/documents/posts/qa_post_1',fields:{qaFixture:{booleanValue:true},title:{stringValue:'qa'},body:{stringValue:'texto fictício'}}};
test('rejeita outro projeto e ausência WIF',async()=>{
 await assert.rejects(qaReadiness({...env,QA_FIREBASE_PROJECT_ID:'atrio-catolico'},()=>{throw Error('should not call');}));
 await assert.rejects(qaReadiness({...env,QA_ACCESS_TOKEN:''},()=>{throw Error('should not call');}));
});
test('aceita uma única fixture específica sem mostrar conteúdo e só GET',async()=>{
 const calls=[];
 const r=await qaReadiness(env,async(url,opts)=>{
  calls.push({url,method:opts.method,redirect:opts.redirect});
  return new Response(url.includes('firestore.googleapis')?JSON.stringify(doc):'{}',{status:url.includes('firestore.googleapis')?200:403});
 });
 assert.deepEqual(r,{fixture:'READY',authConfig:'NOT_AUTHORIZED'});
 assert.equal(calls.length,2);
 assert.ok(calls.every(c=>c.method==='GET'&&c.redirect==='error'&&c.url.includes(project)));
 assert.ok(!JSON.stringify(r).includes(doc.fields.body.stringValue));
});
test('documento ausente, negado, inválido ou rede falhando é seguro',async()=>{
 for(const [status,label] of [[404,'MISSING'],[403,'NOT_AUTHORIZED'],[503,'UNAVAILABLE']]){
  const r=await qaReadiness(env,async url=>new Response('{}',{status:url.includes('firestore.googleapis')?status:403}));
  assert.equal(r.fixture,label);
 }
 const bad=await qaReadiness(env,async url=>new Response(JSON.stringify(url.includes('firestore.googleapis')?{...doc,name:'projects/atrio-catolico/posts/qa_post_1'}:{})));
 assert.equal(bad.fixture,'INVALID');
 const secret=await qaReadiness(env,async()=>{throw Error('secret '+env.QA_ACCESS_TOKEN)});
 assert.deepEqual(secret,{fixture:'UNAVAILABLE',authConfig:'UNAVAILABLE'});
});
