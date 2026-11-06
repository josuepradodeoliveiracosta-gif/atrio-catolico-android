import {test} from 'node:test';
import assert from 'node:assert/strict';
import gateway from './production-gateway.js';

// All token fields are fabricated for an offline unit test; this is NOT
// a Firebase credential, and no real Firestore/Cloudflare call is allowed.
const uid='fake_qa_administrator';
const payload={
  iss:'https://securetoken.google.com/atrio-catolico',
  aud:'atrio-catolico',sub:uid,iat:1,exp:4102444800
};
const fakeToken='fake.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+
                '.'+'x'.repeat(100);
const request=()=>new Request('https://example.invalid/admin/status',{
  method:'GET',headers:{authorization:'Bearer '+fakeToken}
});
const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json'}
});

async function mockedNetwork(handler,run){
  const original=globalThis.fetch;
  globalThis.fetch=handler;
  try{return await run();}finally{globalThis.fetch=original;}
}

test('gateway Firestore uses supported manual redirects and validates admin with ID token',async()=>{
  const seen=[];
  await mockedNetwork(async(url,init)=>{
    seen.push(url);
    assert.equal(init.redirect,'manual','Cloudflare Workers rejects redirect:error');
    assert.equal(init.method,'GET');
    assert.equal(init.headers.authorization,'Bearer '+fakeToken);
    assert.ok(url.startsWith(
      'https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents/'
    ));
    if(url.endsWith('/admins/'+uid))
      return json({fields:{enabled:{booleanValue:true}}});
    if(url.endsWith('/guardian_config/policy'))
      return json({fields:{enabled:{booleanValue:false},emergencyStop:{booleanValue:true}}});
    throw Error('unexpected endpoint');
  },async()=>{
    const res=await gateway.fetch(request(),{GUARDIAN_V2_ADMIN_WRITES_ENABLED:'false'});
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.status,'ready');
    assert.equal(body.administrativeWritesEnabled,false);
    assert.equal(body.emergencyStop,true);
  });
  assert.equal(seen.length,2);
});

test('Firestore 302 with external Location never follows or forwards the token',async()=>{
  let calls=0;
  await mockedNetwork(async(url,init)=>{
    calls++;
    assert.ok(url.endsWith('/admins/'+uid));
    assert.equal(init.redirect,'manual');
    return new Response(null,{status:302,
      headers:{Location:'https://untrusted.invalid/collect'}});
  },async()=>{
    const res=await gateway.fetch(request(),{GUARDIAN_V2_ADMIN_WRITES_ENABLED:'true'});
    assert.equal(res.status,403,'admin check must fail closed');
    assert.equal((await res.json()).status,'forbidden');
  });
  assert.equal(calls,1,'must not fetch the Location destination');
});

test('policy read redirect after authorized admin is an unavailable response',async()=>{
  let calls=0;
  await mockedNetwork(async(url,init)=>{
    calls++;
    assert.equal(init.redirect,'manual');
    if(url.endsWith('/admins/'+uid))
      return json({fields:{enabled:{booleanValue:true}}});
    if(url.endsWith('/guardian_config/policy'))
      return new Response(null,{status:307,
        headers:{Location:'https://evil.invalid/steal-token'}});
    throw Error('unexpected endpoint');
  },async()=>{
    const res=await gateway.fetch(request(),{GUARDIAN_V2_ADMIN_WRITES_ENABLED:'true'});
    assert.equal(res.status,503);
    assert.equal((await res.json()).status,'config_unavailable');
  });
  assert.equal(calls,2);
});

test('Firestore permission denial remains closed without redirect',async()=>{
  await mockedNetwork(async(url,init)=>{
    assert.equal(init.redirect,'manual');
    return json({error:'permission denied'},403);
  },async()=>{
    const res=await gateway.fetch(request(),{});
    assert.equal(res.status,403);
  });
});
