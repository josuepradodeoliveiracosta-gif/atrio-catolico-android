import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditAllowed,readQaIndexes} from './qa-index-audit.js';
const PROJECT='atrio-catolico-qa-v2',TOKEN='A'.repeat(50);
const root='projects/'+PROJECT+'/databases/(default)/collectionGroups/';
const c=(group,scope)=>({name:root+group+'/indexes/test',
 queryScope:scope,state:'READY',fields:[
  {fieldPath:'qaFixture',order:'ASCENDING'},
  {fieldPath:'createdAt',order:'DESCENDING'},
  {fieldPath:'__name__',order:'DESCENDING'}
 ]});
const composite={indexes:[c('posts','COLLECTION'),c('replies','COLLECTION_GROUP'),c('reports','COLLECTION')]};
const single={name:root+'replies/fields/createdAt',indexConfig:{indexes:[
 {queryScope:'COLLECTION',fields:[{fieldPath:'createdAt',order:'ASCENDING'}],state:'READY'},
 {queryScope:'COLLECTION',fields:[{fieldPath:'createdAt',order:'DESCENDING'}],state:'READY'},
 {queryScope:'COLLECTION_GROUP',fields:[{fieldPath:'createdAt',order:'DESCENDING'}],state:'READY'}
]}};
const fake=(first=composite,second=single)=>{
 const requests=[];
 const fetcher=async (url,opts)=>{
  requests.push({url,opts});
  return new Response(JSON.stringify(requests.length===1?first:second),{status:200});
 };
 return {requests,fetcher};
};
const args={project:PROJECT,approved:PROJECT,accessToken:TOKEN};
test('auditoria bloqueia todo projeto que não seja QA exato',async()=>{
 assert.equal(auditAllowed('atrio-catolico',PROJECT),false);
 assert.equal(auditAllowed(PROJECT,PROJECT),true);
 let calls=0;
 const result=await readQaIndexes({...args,project:'atrio-catolico',
  fetcher:async()=>{calls++;throw Error('network')}});
 assert.deepEqual(result,{status:'blocked'});assert.equal(calls,0);
});
test('auditoria faz apenas GET com token efêmero nas rotas do projeto QA',async()=>{
 const {requests,fetcher}=fake();
 const result=await readQaIndexes({...args,fetcher});
 assert.deepEqual(result,{status:'observed',
  composites:[{group:'posts',state:'ready'},{group:'replies',state:'ready'},{group:'reports',state:'ready'}],
  repliesCreatedAtGroup:'ready'});
 assert.equal(requests.length,2);
 for(const {url,opts} of requests){
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);
  assert.ok(url.startsWith('https://firestore.googleapis.com/v1/projects/'+PROJECT+'/'));
  assert.equal(JSON.stringify(opts).includes('PATCH'),false);
 }
 assert.ok(!JSON.stringify(result).includes(TOKEN));
});
test('campo sem índice de grupo é missing e não aprovado',async()=>{
 const {fetcher}=fake(composite,{indexConfig:{indexes:[{queryScope:'COLLECTION',fields:[
  {fieldPath:'createdAt',order:'DESCENDING'}],state:'READY'}]}});
 const result=await readQaIndexes({...args,fetcher});
 assert.equal(result.repliesCreatedAtGroup,'missing');
});
test('índice criando não é tratado como pronto',async()=>{
 const source=structuredClone(single);
 source.indexConfig.indexes[2].state='CREATING';
 const result=await readQaIndexes({...args,fetcher:fake(composite,source).fetcher});
 assert.equal(result.repliesCreatedAtGroup,'building');
});
test('índices compostos anteriores precisam estar READY',async()=>{
 const data=structuredClone(composite);
 data.indexes[2].state='CREATING';
 const result=await readQaIndexes({...args,fetcher:fake(data,single).fetcher});
 assert.equal(result.composites[2].state,'building');
});
test('falta de credencial e falhas de API nunca fingem sucesso',async()=>{
 assert.deepEqual(await readQaIndexes({...args,accessToken:'short'}),{status:'unavailable'});
 const result=await readQaIndexes({...args,fetcher:async()=>new Response('forbidden',{status:403})});
 assert.deepEqual(result,{status:'unavailable',reason:'api_403_composite'});
});
test('auditoria exige formato de índices esperado',async()=>{
 const result=await readQaIndexes({...args,fetcher:fake({indexes:[]},single).fetcher});
 assert.ok(result.composites.every(x=>x.state==='missing'));
});
