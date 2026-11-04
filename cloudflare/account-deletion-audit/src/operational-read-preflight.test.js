import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOperationalDeletionReadSources}
  from './operational-read-preflight.js';

const uid='qa-alice',oauthToken='synthetic_backend_oauth_token_123456789';
const base='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents';
const doc='projects/atrio-catolico/databases/(default)/documents';
const now=new Date('2026-11-03T18:00:00.000Z');
const at='2026-11-03T15:00:00.000Z';

function fakeFirestore({badRequest=false,extraCollection=false,
  failQuery=false,requestChangedOnSecondRead=false}={}){
  const calls=[];
  let requestReads=0;
  const fetcher=async(url,options={})=>{
    const address=String(url),method=options.method;
    calls.push({address,method});
    assert.equal(options.headers.Authorization,'Bearer '+oauthToken);
    if(address===base+'/account_deletion_requests/'+uid&&method==='GET'){
      requestReads++;
      return Response.json({name:doc+'/account_deletion_requests/'+uid,
        fields:{status:{stringValue:badRequest?'completed':'requested'},
          source:{stringValue:'android'},
          requestedAt:{timestampValue:requestChangedOnSecondRead &&
            requestReads===2?'2026-11-03T16:00:00.000Z':at}}});
    }
    if(address===base+'/profiles/'+uid&&method==='GET')
      return Response.json({name:doc+'/profiles/'+uid});
    if(method==='GET'&&address.includes('?pageSize=100')){
      assert.ok(address.includes('/users/'+uid+'/extraCustom?'));
      return Response.json({documents:[{
        name:doc+'/users/'+uid+'/extraCustom/one'
      }]});
    }
    if(method==='GET'&&address.startsWith(base+'/'))
      return new Response('{}',{status:404});
    if(method==='POST'&&address.endsWith(':listCollectionIds')){
      return Response.json({collectionIds:extraCollection&&
        address===base+'/users/'+uid+':listCollectionIds'
          ? ['extraCustom']:[]});
    }
    if(method==='POST'&&address===base+':runQuery'){
      if(failQuery)return new Response('{}',{status:503});
      const query=JSON.parse(options.body).structuredQuery;
      const field=query.where.fieldFilter.field.fieldPath;
      const collection=query.from[0].collectionId;
      if(collection==='reports'&&field==='reporterUid')
        return Response.json([{readTime:at,document:{
          name:doc+'/reports/qa-report',fields:{reporterUid:{stringValue:uid}}
        }}]);
      return Response.json([{readTime:at}]);
    }
    throw Error('unexpected_network_path');
  };
  return {fetcher,calls};
}
async function inspect({
  fetcher,assertAuthorizedRead=async()=>true,signal,maxReads
}={}){
  return inspectOperationalDeletionReadSources({
    uid,oauthToken,fetcher,assertAuthorizedRead,now,signal,maxReads
  });
}
test('composes genuine read-only Firestore adapter paths without enabling deletion',async()=>{
  const io=fakeFirestore();
  const result=await inspect(io);
  assert.equal(result.status,'read_only_review_required');
  assert.equal(result.accountRequestReadFromFirestore,true);
  assert.equal(result.firestoreOwnedRootDocumentsAndDescendants,1);
  assert.equal(result.firestoreRelationalReferences,1);
  assert.equal(result.relationalKinds.moderation_retention,1);
  assert.equal(result.queriedRelationalScopeCount,12);
  // Four stage checks + one final consistency check, and per-RPC guards
  // before and after every remote read.
  assert.equal(result.authorizationRechecks,5+2*io.calls.length);
  assert.equal(io.calls.filter(x=>x.address.includes(
    '/account_deletion_requests/')).length,2);
  assert.ok(result.unresolvedScopes.includes('firebase_auth_and_fcm_registration'));
  for(const flag of ['transactionalSnapshotVerified','allAccountDataDiscovered',
    'thirdPartyRetentionReviewed','operatorIdentityIndependentlyVerified',
    'liveDeploymentConnected','destructiveOperationsEnabled',
    'accountDeletionAuthorized','googlePlayReleaseAuthorized'])
    assert.equal(result[flag],false);
  assert.ok(io.calls.length>=20);
  assert.ok(io.calls.every(x=>x.method==='GET'||
    (x.method==='POST'&&(x.address.endsWith(':listCollectionIds')||
      x.address.endsWith(':runQuery')))));
  assert.doesNotMatch(JSON.stringify(result),
    /qa-alice|qa-report|synthetic_backend|account_deletion_requests/);
});
test('discovers previously unknown owned subcollections and still refuses authorization',async()=>{
  const io=fakeFirestore({extraCollection:true});
  const result=await inspect(io);
  assert.equal(result.firestoreOwnedRootDocumentsAndDescendants,2);
  assert.equal(result.unexpectedDirectSubcollectionCount,1);
  assert.equal(result.accountDeletionAuthorized,false);
});
test('missing authorization is fail-closed with zero data reads',async()=>{
  const io=fakeFirestore();
  await assert.rejects(inspect({...io,assertAuthorizedRead:async()=>false}),
    /operator_authorization_lost/);
  assert.equal(io.calls.length,0);
});
test('authorization loss after request blocks further private reads',async()=>{
  const io=fakeFirestore();
  let n=0;
  await assert.rejects(inspect({
    ...io,assertAuthorizedRead:async()=>++n<3
  }),/operator_authorization_lost/);
  // The request was sent but its response was not admitted after revocation.
  assert.equal(io.calls.length,1);
});
test('revocation during an owned tree scan prevents the next private read',async()=>{
  const io=fakeFirestore({extraCollection:true});
  let revoked=false;
  const fetcher=async(...args)=>{
    const response=await io.fetcher(...args);
    if(io.calls.length===7)revoked=true;
    return response;
  };
  await assert.rejects(inspect({
    fetcher,assertAuthorizedRead:async()=>!revoked
  }),/operator_authorization_lost/);
  assert.equal(io.calls.length,7);
});

test('a replaced deletion request cannot be accepted after a long inventory',async()=>{
  const io=fakeFirestore({requestChangedOnSecondRead:true});
  await assert.rejects(inspect(io),/request_changed_during_scan/);
  assert.equal(io.calls.filter(x=>x.address.includes(
    '/account_deletion_requests/')).length,2);
});

test('invalid request or query failure cannot produce partial clearance',async()=>{
  for(const opts of [{badRequest:true},{failQuery:true}]){
    const io=fakeFirestore(opts);
    await assert.rejects(inspect(io),
      /operational_read_preflight_request_not_verified|firestore_query_unavailable/);
  }
});
test('rejects wrong project, missing operator, invalid identity and token',async()=>{
  const io=fakeFirestore();
  await assert.rejects(
    inspectOperationalDeletionReadSources({uid,oauthToken,fetcher:io.fetcher,
      projectId:'other',assertAuthorizedRead:async()=>true,now}),
    /unexpected_project/);
  await assert.rejects(
    inspectOperationalDeletionReadSources({uid,oauthToken,fetcher:io.fetcher,now}),
    /missing_trusted_backend/);
  await assert.rejects(
    inspectOperationalDeletionReadSources({uid:'../bob',oauthToken,fetcher:io.fetcher,
      assertAuthorizedRead:async()=>true,now}),
    /invalid_uid/);
  await assert.rejects(
    inspectOperationalDeletionReadSources({uid,oauthToken:'bad',fetcher:io.fetcher,
      assertAuthorizedRead:async()=>true,now}),
    /invalid_backend_token/);
  assert.equal(io.calls.length,0);
});


test('cancelled account inventory does not read another document or emit a report',async()=>{
  const io=fakeFirestore(),controller=new AbortController();
  const fetcher=async(...args)=>{
    const response=await io.fetcher(...args);
    controller.abort('qa-client-closed');
    return response;
  };
  await assert.rejects(inspect({fetcher,signal:controller.signal}),
    /operational_read_preflight_read_cancelled/);
  assert.equal(io.calls.length,1);
});

test('the read budget prevents paginated inventory growth before network I/O',async()=>{
  const io=fakeFirestore();
  await assert.rejects(inspect({...io,maxReads:1}),
    /operational_read_preflight_read_budget_exceeded/);
  assert.equal(io.calls.length,1);
  await assert.rejects(inspect({...io,maxReads:321}),
    /operational_read_preflight_invalid_read_budget/);
  assert.equal(io.calls.length,1);
});

test('each Firestore RPC receives a bounded cancellation signal',async()=>{
  const io=fakeFirestore();
  const fetcher=async(url,options)=>{
    assert.equal(options.signal instanceof AbortSignal,true);
    return io.fetcher(url,options);
  };
  const result=await inspect({fetcher});
  assert.equal(result.accountDeletionAuthorized,false);
});
