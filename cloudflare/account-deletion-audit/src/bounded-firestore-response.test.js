import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedFirestoreJson} from './bounded-firestore-response.js';

const bytes=value=>new TextEncoder().encode(value);
function responseChunks(chunks,headers={}){
  let canceled=false,pulled=0;
  const body=new ReadableStream({
    pull(controller){
      if(pulled>=chunks.length){controller.close();return;}
      controller.enqueue(chunks[pulled++]);
    },
    cancel(){canceled=true;}
  });
  return {response:new Response(body,{status:200,headers}),
    counters:()=>({canceled,pulled})};
}
test('streamed firestore response parses valid split multibyte UTF-8 only after EOF',async()=>{
  const data=bytes(JSON.stringify({paths:['users/alice/notifications/n1'],label:'coração'}));
  const split=data.indexOf(0xc3)+1;
  const {response}=responseChunks([data.subarray(0,split),data.subarray(split)]);
  assert.deepEqual(await readBoundedFirestoreJson(response),{
    paths:['users/alice/notifications/n1'],label:'coração'
  });
});
test('never calls response.text or accumulates payload beyond strict 2 MB limit',async()=>{
  const {response,counters}=responseChunks([
    bytes('a'.repeat(1_000_000)),bytes('a'.repeat(1_000_001)),
    bytes('data-after-limit-must-not-be-read')
  ]);
  response.text=async()=>{throw Error('unbounded_text_forbidden');};
  await assert.rejects(readBoundedFirestoreJson(response),
    /firestore_response_too_large/);
  assert.equal(counters().canceled,true);
  // ReadableStream is allowed to prefetch one extra chunk, but the reader
  // stops immediately once its byte budget is exceeded.
  assert.ok(counters().pulled<=3);
});
test('preemptively reject declared oversize/invalid lengths before consuming stream',async()=>{
  for(const [header,pattern] of [
    ['2000001',/firestore_response_too_large/],
    ['not-a-number',/invalid_firestore_response/],
    ['999999999999999999999',/invalid_firestore_response/]
  ]){
    const {response,counters}=responseChunks([bytes('{}')],
      {'Content-Length':header});
    await assert.rejects(readBoundedFirestoreJson(response),pattern);
    assert.equal(counters().pulled<=1,true);
  }
});
test('reject invalid UTF-8, partial UTF-8 and malformed payloads',async()=>{
  for(const chunks of [
    [Uint8Array.from([0xc3,0x28])],
    [Uint8Array.from([0x7b,0x22,0x61,0x22,0x3a,0xc3])],
    [bytes('{"broken":')]
  ]){
    const {response}=responseChunks(chunks);
    await assert.rejects(readBoundedFirestoreJson(response),
      /invalid_firestore_response/);
  }
});
test('missing stream, wrong chunk types and invalid reader limit fail closed',async()=>{
  await assert.rejects(readBoundedFirestoreJson({
    headers:new Headers(),body:null
  }),/invalid_firestore_response/);
  const {response}=responseChunks(['not-a-byte-chunk']);
  await assert.rejects(readBoundedFirestoreJson(response),
    /invalid_firestore_response/);
  await assert.rejects(readBoundedFirestoreJson(new Response('{}'),
    {limit:2000001}),/invalid_read_limit/);
});
test('reject invalid JSON and response stream errors without considering inventory empty',async()=>{
  const partial=new Response(new ReadableStream({
    start(controller){
      controller.enqueue(bytes('{"items":['));
      controller.error(Error('simulated_network_disconnect'));
    }
  }));
  await assert.rejects(readBoundedFirestoreJson(partial),
    /simulated_network_disconnect/);
  await assert.rejects(readBoundedFirestoreJson(new Response('NOT_JSON')),
    /invalid_firestore_response/);
  await assert.rejects(readBoundedFirestoreJson(new Response('')),
    /invalid_firestore_response/);
});
