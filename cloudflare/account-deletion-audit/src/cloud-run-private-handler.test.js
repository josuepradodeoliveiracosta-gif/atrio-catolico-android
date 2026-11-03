import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {createPrivateReviewHttpHandler}
  from './cloud-run-private-handler.js';

const seed='q'.repeat(140)+'.'+'a'.repeat(110)+'.'+'b'.repeat(70);
const sample={
  status:'read_only_review_required',
  privateBackendCodePrepared:true,
  runtimeServiceAccountNameMatched:true,
  accountDeletionAuthorized:false,
  googlePlayReleaseAuthorized:false,
  destructiveOperationsEnabled:false,
  cloudRunInvokerIamReviewed:false,
  readOnlyIamRolesIndependentlyVerified:false,
  firestoreOwnedRootDocumentsAndDescendants:2,
  ownedNestedCollectionCount:1,unexpectedDirectSubcollectionCount:0,
  firestoreRelationalReferences:1,queriedRelationalScopeCount:12,
  authorizationRechecks:50,
  relationalKinds:{moderation_retention:1},
  unresolvedScopes:['firebase_auth_and_fcm_registration','cloudinary_objects_and_all_delivery_types'],
  uid:'must-never-leak',privateToken:'secret-should-not-leak'
};
async function withServer(reader,fn){
  const server=createServer(createPrivateReviewHttpHandler({reader}));
  server.requestTimeout=10000;
  server.headersTimeout=5000;
  try{
    await new Promise((ok,fail)=>{
      server.once('error',fail);
      server.listen(0,'127.0.0.1',ok);
    });
    return await fn('http://127.0.0.1:'+server.address().port);
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
}
const request=(origin,body,opts={})=>fetch(origin+'/v1/review',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body),...opts
});
test('private HTTP response only contains approved counts and permanent safety flags',async()=>{
  let inspected=0;
  await withServer({async inspect(body){
    inspected++;assert.equal(body.uid,'qa-alice');
    assert.equal(body.idToken,seed);
    return sample;
  }},async origin=>{
    const result=await request(origin,{uid:'qa-alice',idToken:seed});
    assert.equal(result.status,200);
    assert.match(result.headers.get('cache-control'),/no-store/);
    assert.equal(result.headers.get('x-content-type-options'),'nosniff');
    const doc=await result.json();
    assert.equal(doc.firestoreRelationalReferences,1);
    assert.equal(doc.accountDeletionAuthorized,false);
    assert.equal(doc.googlePlayReleaseAuthorized,false);
    assert.equal(doc.cloudRunInvokerIamReviewed,false);
    assert.doesNotMatch(JSON.stringify(doc),/must-never-leak|secret-should-not-leak|qa-alice|q{30}/);
  });
  assert.equal(inspected,1);
});
test('unknown paths, wrong methods, malformed body and extra fields never reach reader',async()=>{
  let called=0;
  await withServer({async inspect(){called++;return sample;}},async origin=>{
    const get=await fetch(origin+'/v1/review');
    assert.equal(get.status,404);
    const other=await fetch(origin+'/v1/delete',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:'{}'
    });
    assert.equal(other.status,404);
    for(const [body,contentType] of [
      ['not-json','application/json'],['{}','application/json'],
      [JSON.stringify({uid:'qa-alice',idToken:seed,execute:true}),'application/json'],
      [JSON.stringify({uid:'../someone',idToken:seed}),'application/json'],
      [JSON.stringify({uid:'qa-alice',idToken:seed}),'text/plain'],
      ['x'.repeat(8300),'application/json']
    ]){
      const response=await fetch(origin+'/v1/review',{
        method:'POST',headers:{'Content-Type':contentType},
        body
      });
      assert.notEqual(response.status,200);
    }
  });
  assert.equal(called,0);
});
test('backend errors and malformed reports do not expose credentials',async()=>{
  for(const result of [
    {...sample,accountDeletionAuthorized:true},
    {...sample,relationalKinds:{'secret.uid':1}},
    {...sample,unresolvedScopes:['uid=private']},
    {...sample,firestoreRelationalReferences:-1},
    null
  ]){
    await withServer({async inspect(){return result;}},async origin=>{
      const res=await request(origin,{uid:'qa-alice',idToken:seed});
      assert.equal(res.status,403);
      assert.deepEqual(await res.json(),{error:'review_unavailable'});
    });
  }
  await withServer({async inspect(){throw Error('secret_uid_qa-alice');}},
    async origin=>{
      const res=await request(origin,{uid:'qa-alice',idToken:seed});
      assert.equal(res.status,403);
      assert.doesNotMatch(await res.text(),/qa-alice|secret_uid/);
    });
});
test('Terraform private Cloud Run contract has no anonymous Invoker, public ingress or mutation IAM',()=>{
  const tf=readFileSync(new URL(
    '../../../ops/cloud-run-private-review/infra/main.tf',import.meta.url),'utf8');
  for(const statement of [
    'INGRESS_TRAFFIC_INTERNAL_ONLY',
    'invoker_iam_disabled = false',
    'roles/datastore.viewer',
    'roles/firebaseauth.viewer',
    'roles/run.invoker',
    'google_cloud_run_v2_service_iam_binding',
    'google_service_account',
    'max_instance_count = 1',
    'prevent_destroy = true'
  ]) assert.ok(tf.includes(statement),statement);
  assert.match(tf,/^\s*deletion_protection\s*=\s*true\s*$/m);
  assert.match(tf,/^\s*invoker_iam_disabled\s*=\s*false\s*$/m);
  assert.match(tf,/^\s*ingress\s*=\s*"INGRESS_TRAFFIC_INTERNAL_ONLY"\s*$/m);
  for(const forbidden of [
    'allUsers','allAuthenticatedUsers',
    'roles/datastore.user','roles/datastore.admin',
    'roles/firebaseauth.admin','roles/editor','roles/owner',
    'INGRESS_TRAFFIC_ALL','invoker_iam_disabled = true'
  ])assert.ok(!tf.includes(forbidden),forbidden);
});


test('an abandoned HTTP client cancels the in-flight private review',async()=>{
  let started;
  const entered=new Promise(resolve=>{started=resolve;});
  let cancelled=false,confirm;
  const observed=new Promise(resolve=>{confirm=resolve;});
  await withServer({inspect(_body,{signal}){
    return new Promise(resolve=>{
      signal.addEventListener('abort',()=>{
        cancelled=true;
        confirm();
        resolve(sample);
      },{once:true});
      started();
    });
  }},async origin=>{
    const controller=new AbortController();
    const pending=request(origin,{uid:'qa-alice',idToken:seed},{
      signal:controller.signal
    }).catch(()=>null);
    await entered;
    controller.abort();
    await pending;
    // Undici reports AbortError to the client before Node emits res.close
    // on the server. Observe the actual cancellation, not a single tick.
    await Promise.race([
      observed,
      new Promise((_,reject)=>{
        const timer=setTimeout(()=>reject(
          Error('qa_server_disconnect_not_observed')),2000);
        observed.then(()=>clearTimeout(timer));
      })
    ]);
  });
  assert.equal(cancelled,true);
});
