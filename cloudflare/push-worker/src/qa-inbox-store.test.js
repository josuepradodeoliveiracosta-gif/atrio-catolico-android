import test from 'node:test';
import assert from 'node:assert/strict';
import {createQaInboxFirestore} from './qa-inbox-store.js';
const root='projects/atrio-catolico-qa-general/databases/(default)/documents';
const stamp='2026-11-25T12:00:00.000Z';

test('transaction orders batchGet results and commits atomically to QA only',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const path=new URL(url).pathname;
    assert.ok(path.startsWith('/v1/'+root));
    assert.equal(options.headers.Authorization,'Bearer synthetic-token');
    const body=JSON.parse(options.body);
    calls.push({path,body});
    if(path.endsWith(':beginTransaction'))return Response.json({transaction:'synthetic-tx'});
    if(path.endsWith(':batchGet'))return Response.json([
      {missing:body.documents[1],readTime:stamp},
      {found:{name:body.documents[0],fields:{status:{stringValue:'pending'}}},readTime:stamp}
    ]);
    if(path.endsWith(':commit'))return Response.json({writeResults:[]});
    assert.fail('Unexpected '+path);
  });
  const db=createQaInboxFirestore('synthetic-token');
  await db.runTransaction(async tx=>{
    const chat=db.doc('chats/a__b'),receipt=db.doc('serverInboxMessageRequests/synthetic');
    const [room,old]=await tx.getAll(chat,receipt);
    assert.equal(room.get('status'),'pending');
    assert.equal(old.exists,false);
    tx.update(chat,{status:'accepted',updatedAt:room.readTime});
    tx.set(db.doc('serverInboxOwners/a'),{revisions:{legacy:'revision'}},{merge:true});
    tx.create(receipt,{fingerprint:'synthetic'});
  });
  assert.equal(calls.length,3);
  const commit=calls[2].body;
  assert.equal(commit.transaction,'synthetic-tx');
  assert.equal(commit.writes.length,3);
  assert.deepEqual(commit.writes[0].currentDocument,{exists:true});
  assert.deepEqual(commit.writes[0].updateMask.fieldPaths,['status','updatedAt']);
  assert.equal(commit.writes[0].update.fields.updatedAt.timestampValue,stamp);
  assert.deepEqual(commit.writes[1].updateMask.fieldPaths,['revisions.legacy']);
  assert.deepEqual(commit.writes[2].currentDocument,{exists:false});
});

test('failed commit rolls back; read-only transaction never writes',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url)=>{
    const op=new URL(url).pathname.split(':').at(-1);
    calls.push(op);
    if(op==='beginTransaction')return Response.json({transaction:'synthetic-tx'});
    if(op==='commit')return new Response(null,{status:409});
    if(op==='rollback')return Response.json({});
    assert.fail('Unexpected '+op);
  });
  const db=createQaInboxFirestore('synthetic-token');
  await assert.rejects(db.runTransaction(async tx=>tx.update(db.doc('chats/a__b'),{status:'accepted'})));
  assert.deepEqual(calls,['beginTransaction','commit','rollback']);
  calls.length=0;
  await assert.rejects(db.runTransaction(async tx=>tx.update(db.doc('chats/a__b'),{status:'accepted'}),{readOnly:true}));
  assert.deepEqual(calls,['beginTransaction','rollback']);
});
