import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFirestoreBatchGetStream,Firestore} from './firestore.js';

const qaTx='cWEtc3RyZWFtLW9ubHk=';
const name='projects/demo-atrio-v11/databases/(default)/documents/account_deletion_freeze/alice';
const textResponse=(body,headers={})=>new Response(body,{status:200,headers});
const rows=(body)=>parseFirestoreBatchGetStream(textResponse(body));

test('batchGet accepts single result object',async()=>{
  assert.deepEqual(await rows(JSON.stringify({transaction:qaTx,missing:name})),
    [{transaction:qaTx,missing:name}]);
});
test('batchGet supports emulator JSON array',async()=>{
  const value=[{transaction:qaTx},{missing:name}];
  assert.deepEqual(await rows(JSON.stringify(value)),value);
});
test('batchGet accepts newline-separated production JSON records and nested objects',async()=>{
  const response=[
    {transaction:qaTx},
    {found:{name,fields:{note:{stringValue:'This says } and \\"quoted\\" in text'}}}},
    {missing:name+'/subcollection/other'}
  ];
  const input=response.map(x=>JSON.stringify(x,null,2)).join('\n');
  assert.deepEqual(await rows(input),response);
});
test('batchGet stream directly feeds Firestore.commit with all original preconditions',async()=>{
  const db=new Firestore('qa-token','demo-atrio-v11','http://127.0.0.1:8089/v1');
  const prev=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),method:options.method,payload:JSON.parse(options.body)});
    if(String(url).endsWith(':batchGet')){
      return textResponse(JSON.stringify({transaction:qaTx})+'\n'+JSON.stringify({missing:name})+'\n');
    }
    if(String(url).endsWith(':commit'))return Response.json({writeResults:[{}]});
    throw Error('Unexpected call '+url);
  };
  try{
    await db.commit([
      {verify:name,currentDocument:{exists:false}},
      {update:{name:db.resource+'/guardian_runtime/qa',fields:{status:{stringValue:'safe'}}},
       currentDocument:{exists:false}}
    ]);
    assert.equal(calls.length,2);
    assert.equal(calls[1].payload.transaction,qaTx);
    assert.equal(calls[1].payload.writes.length,1);
    assert.equal(calls[1].payload.writes.some(w=>Object.hasOwn(w,'verify')),false);
  }finally{globalThis.fetch=prev;}
});
test('batchGet rejects malformed JSON, unexpected separators and incomplete objects',async()=>{
  for(const x of ['{','{"transaction":','{}{}','{}\nnot-json','', '[]','null','[null]','{"fields":{}\n']){
    await assert.rejects(rows(x),/firestore_batch_get_/);
  }
});
test('batchGet rejects missing or malformed streaming body and invalid UTF8',async()=>{
  await assert.rejects(parseFirestoreBatchGetStream(new Response(null)),/invalid_body/);
  await assert.rejects(parseFirestoreBatchGetStream(new Response(Uint8Array.from([0xff,0xfe]))),
    /invalid_utf8/);
});
test('batchGet never accepts oversized bodies even when Content-Length is missing',async()=>{
  await assert.rejects(rows('X'.repeat(4*1024*1024+1)),/oversized/);
  await assert.rejects(parseFirestoreBatchGetStream(textResponse('{}',
    {'content-length':String(4*1024*1024+1)})),/oversized/);
});
test('batchGet refuses more than 16 streaming records',async()=>{
  await assert.rejects(rows(Array.from({length:17},()=>JSON.stringify({transaction:qaTx})).join('\n')),
    /too_many_rows/);
});
test('batchGet rejects a 200 response containing HTML or a scalar',async()=>{
  for(const x of ['<html></html>','false','123','"text"']){
    await assert.rejects(rows(x),/firestore_batch_get_/);
  }
});
