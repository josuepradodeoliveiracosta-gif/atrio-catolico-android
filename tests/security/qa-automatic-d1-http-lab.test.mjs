import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {createD1HttpLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-http-lab.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
const project=identity.projectId,root='projects/'+project+'/databases/(default)/documents',fs='https://firestore.googleapis.com/v1/'+root;
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const serviceAccount={project_id:project,client_email:'atrio-qa-general-push@'+project+'.iam.gserviceaccount.com',private_key:keys.privateKey.export({type:'pkcs8',format:'pem'})};
const begin={url:fs+':beginTransaction',method:'POST',redirect:'error',body:{options:{readOnly:{}}}};
const lookup=['qa-nav-alice','qa-nav-bob'];
const user=uid=>({localId:uid,email:identity.accounts[uid],emailVerified:true,validSince:'1'});
const fixture=(kind='tick',over={})=>{
 const calls=[],fcmBodies=[],flags={redirect:false,failOAuth:false,badAuth:false,wrongUser:false};
 const fetchImpl=async(url,init)=>{
  calls.push(url);assert.equal(init.redirect,'manual');assert.ok(init.signal);
  if(url==='https://oauth2.googleapis.com/token'){
   const a=new URLSearchParams(init.body).get('assertion'),[h,p,s]=a.split('.');
   assert.ok(verify('RSA-SHA256',Buffer.from(h+'.'+p),keys.publicKey,Buffer.from(s,'base64url')));
   assert.equal(JSON.parse(Buffer.from(p,'base64url')).iss,serviceAccount.client_email);
   if(flags.failOAuth)return Response.json({}, {status:403});
   return Response.json({access_token:'fixture-access',token_type:'Bearer',expires_in:3600});
  }
  if(flags.redirect)return new Response(null,{status:302,headers:{location:'https://evil.invalid'}});
  if(url.includes('/accounts:lookup?key='))return Response.json({users:[flags.wrongUser?user(lookup[1]):{...user(lookup[0]),validSince:flags.badAuth?'9999999999':'1'}]});
  assert.equal(init.headers.Authorization,'Bearer fixture-access');
  if(url.endsWith('/accounts:lookup'))return Response.json({users:lookup.map(user)});
  if(url.endsWith('pushDevices?pageSize=6'))return Response.json({documents:[{name:root+'/users/'+lookup[0]+'/pushDevices/one',updateTime:new Date().toISOString(),fields:{token:{stringValue:'synthetic-not-an-fcm-token'},updatedAt:{timestampValue:new Date().toISOString()}}}]});
  if(url.endsWith('/messages:send')){
   assert.equal(init.method,'POST');assert.equal(init.headers['Content-Type'],'application/json');
   const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body),['message']);
   assert.deepEqual(body.message.data,{signal:'refresh'});assert.equal(body.message.android.priority,'HIGH');
   assert.ok(Number.parseInt(body.message.android.ttl)>=10&&Number.parseInt(body.message.android.ttl)<=60);
   fcmBodies.push(body);
   return Response.json({name:'projects/'+project+'/messages/fixture'});
  }
  return Response.json({transaction:'fixture-token'});
 };
 return {calls,fcmBodies,flags,http:createD1HttpLab({enabled:true,kind,fetchImpl,serviceAccount,webApiKey:'fixture',...over})};
};
test('fixed service account, OAuth signature, one token per invocation',async()=>{
 const f=fixture();
 assert.equal((await f.http.transport(begin)).status,200);
 assert.equal((await f.http.lookupAccounts(lookup))[lookup[0]].uid,lookup[0]);
 assert.equal((await f.http.listDevices(lookup[0])).length,1);
 const res=await f.http.sendRefresh({token:'synthetic-not-an-fcm-token',data:{signal:'refresh'},android:{priority:'HIGH',ttl:'60s'}},Date.now()+61000);
 assert.equal((await res.json()).name,'projects/'+project+'/messages/fixture');
 assert.equal(f.calls.filter(x=>x.includes('oauth2')).length,1);
 assert.equal(f.http.usage().actualExternalAttempts,5);
 assert.equal(f.fcmBodies.length,1);assert.equal(f.http.usage().fcmAttempted,true);
 await assert.rejects(f.http.sendRefresh({token:'synthetic-not-an-fcm-token',data:{signal:'refresh'},android:{priority:'HIGH',ttl:'60s'}}));
});
test('wrong project, writes, unbounded read and disabled credential fail before I/O',async()=>{
 const f=fixture();
 for(const r of [{...begin,url:fs+':commit'},{...begin,url:fs.replace(project,'prod')+':beginTransaction'},
  {...begin,body:{options:{readWrite:{}}}},{...begin,url:fs+':batchGet',body:{documents:[root+'/users/other/private/x'],transaction:'fixture-token'}}])
  await assert.rejects(f.http.transport(r));
 assert.equal(f.calls.length,0);
 for(const over of [{enabled:false},{serviceAccount:{...serviceAccount,client_email:'other@'+project+'.iam.gserviceaccount.com'}}]){
  const g=fixture('tick',over);await assert.rejects(g.http.transport(begin));assert.equal(g.calls.length,0);
 }
});
test('redirect and OAuth error never retry',async()=>{
 const f=fixture();f.flags.redirect=true;
 await assert.rejects(f.http.transport(begin));assert.equal(f.calls.length,2);
 const g=fixture();g.flags.failOAuth=true;
 await assert.rejects(g.http.transport(begin));await assert.rejects(g.http.transport(begin));assert.equal(g.calls.length,1);
});
test('actual fetch attempts capped independent of logical meter',async()=>{
 const f=fixture('notice');
 for(let i=0;i<9;i++)await f.http.transport(begin);
 await assert.rejects(f.http.transport(begin));assert.equal(f.calls.length,10);
});
test('recipient claims do not authenticate; provider must confirm exact unrevoked user',async()=>{
 const f=fixture('notice'),now=Math.floor(Date.now()/1000);
 const bearer=(p=project)=>'Bearer '+Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({aud:p,iss:'https://securetoken.google.com/'+p,sub:lookup[0],email:identity.accounts[lookup[0]],email_verified:true,firebase:{sign_in_provider:'password'},iat:now-5,exp:now+300,auth_time:now-30})).toString('base64url')+'.fixture';
 const req=a=>new Request('https://qa.invalid/notice',{headers:{Authorization:a}});
 assert.equal(await f.http.verifyIdentity(req(bearer('prod'))),null);assert.equal(f.calls.length,0);
 assert.equal(await f.http.verifyIdentity(req(bearer())),lookup[0]);
 f.flags.wrongUser=true;assert.equal(await f.http.verifyIdentity(req(bearer())),null);
 f.flags.wrongUser=false;f.flags.badAuth=true;assert.equal(await f.http.verifyIdentity(req(bearer())),null);
});

test('last-moment send gate denies FCM and expired deadline never acquires OAuth',async()=>{
 const msg={token:'synthetic-not-an-fcm-token',data:{signal:'refresh'},android:{priority:'HIGH',ttl:'60s'}};
 const denied=fixture('tick',{beforeSend:async()=>false});
 await assert.rejects(denied.http.sendRefresh(msg,Date.now()+60000));
 assert.equal(denied.calls.length,1);assert.equal(denied.http.usage().fcmAttempted,false);
 const expired=fixture();
 await assert.rejects(expired.http.sendRefresh(msg,Date.now()-1));
 assert.equal(expired.calls.length,0);
});

test('FCM recalculates remaining TTL after OAuth and the final gate',async t=>{
 const initial=Date.now();let now=initial;
 t.mock.method(Date,'now',()=>now);
 const msg={token:'synthetic-not-an-fcm-token',data:{signal:'refresh'},android:{priority:'HIGH',ttl:'60s'}};
 const f=fixture('tick',{beforeSend:async()=>{now=initial+35000;return true}});
 await f.http.sendRefresh(msg,initial+60000);
 assert.equal(f.fcmBodies[0].message.android.ttl,'25s');
 const expired=fixture('tick',{beforeSend:async()=>{now=initial+59000;return true}});
 now=initial;
 await assert.rejects(expired.http.sendRefresh(msg,initial+60000));
 assert.equal(expired.calls.length,1);assert.equal(expired.fcmBodies.length,0);
 assert.equal(expired.http.usage().fcmAttempted,false);
});
