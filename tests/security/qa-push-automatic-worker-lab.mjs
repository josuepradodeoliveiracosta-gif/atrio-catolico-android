// Test-only bridge; never imported by a Worker build, deployed, or exposed as a route.
// Generated Worker policy/transport is exercised unchanged, except for the
// event identity boundary: a process-local WeakMap binds the trusted canonical
// actor after OIDC verification + exclusive claim. No fabricated Firebase JWT.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {renderConversationPushPilotWorker} from '../../cloudflare/push-worker/scripts/conversation-push-pilot.mjs';
import {renderQaSchema} from '../../cloudflare/push-worker/scripts/chat-qa-build.mjs';
import {createAutomaticServiceContract,AUTO_AUDIENCE} from '../../cloudflare/push-worker/scripts/qa-automatic-service-contract.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';

const project=identity.projectId;
const host=process.env.FIRESTORE_EMULATOR_HOST??'';
const demo='demo-atrio-v11';
assert.match(host,/^127\.0\.0\.1:\d+$/);
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST??'',/^127\.0\.0\.1:\d+$/);
assert.equal(process.env.GCLOUD_PROJECT,demo);
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const kid='automatic-fixture',subject='123456789012345678901';
const email='fixture@'+project+'.iam.gserviceaccount.com';
const jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'};
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
export function labBearer(extra={}){
 const now=Math.floor(Date.now()/1000);
 const prefix=b64({alg:'RS256',kid,typ:'JWT'})+'.'+b64({
  iss:'https://accounts.google.com',aud:AUTO_AUDIENCE,sub:subject,email,email_verified:true,
  iat:now,exp:now+300,...extra});
 return 'Bearer '+prefix+'.'+sign('RSA-SHA256',Buffer.from(prefix),privateKey).toString('base64url');
}
const originalSource=renderConversationPushPilotWorker(readFileSync(
 new URL('../../cloudflare/push-worker/src/index.js',import.meta.url),'utf8'));
const anchor="const uid=await verifyIdentity(request,env);\n      if(!uid) return response(401,'unauthorized');\n      stage='event_oauth';";
assert.equal(originalSource.split(anchor).length,2,'event identity boundary changed');
const labSource=originalSource.replace(anchor,anchor.replace('const uid=await verifyIdentity(request,env);','const uid=labActors.get(request);'))+
 '\nconst labActors=new WeakMap();\nexport function bindLabActor(request,uid){labActors.set(request,uid);return request;}\n';
const {default:worker,bindLabActor}=await import('data:text/javascript;base64,'+Buffer.from(labSource).toString('base64'));
const originalFetch=globalThis.fetch;
const remoteRoot='projects/'+project+'/databases/(default)/documents';
const demoRoot='projects/'+demo+'/databases/(default)/documents';

export async function createWorkerLab(t,{db,auth,service,afterReservation=async()=>{},fcm='accepted',enabled=true}){
 assert.equal(db.projectId,demo);
 assert.equal(auth.app.options.projectId,demo);
 const contract=createAutomaticServiceContract({enabled,subject,email,resolveKey:async id=>id===kid?jwk:null});
 const sql=new DatabaseSync(':memory:');
 sql.exec(renderQaSchema('atrio-catolico-qa-geral','11111111-2222-4333-8444-555555555555')
  .replace("'atrio-qa-geral', 'atrio-catolico-qa-geral'","'atrio-qa-conversations-pilot', '"+project+"'"));
 t.after(()=>sql.close());
 const accounts=Object.fromEntries(await Promise.all(Object.keys(identity.accounts).map(async uid=>{
  const a=await auth.getUser(uid);
  return [uid,{localId:a.uid,email:a.email,emailVerified:a.emailVerified,disabled:a.disabled}];
 })));
 let sends=0,reservations=0,externalRequests=0,firestoreRequests=0,firestoreDocuments=0,d1Calls=0;
 const database={prepare(statement){
  return {bind(...params){
   return {
    async first(){return sql.prepare(statement).get(...params)},
    async run(){
     d1Calls++;
     const result=sql.prepare(statement).run(...params);
     if(/^INSERT OR IGNORE INTO delivered/.test(statement)&&result.changes===1){
      reservations++;await afterReservation();
     }
     return {meta:{changes:result.changes}};
    }
   };
  }};
 }};
 t.mock.method(console,'info',()=>{});
 t.mock.method(globalThis,'fetch',async(input,init={})=>{
  externalRequests++;
  const url=new URL(input);
  assert.equal(init.redirect,'manual');
  const headers=new Headers(init.headers);
  if(url.origin==='https://oauth2.googleapis.com'&&url.pathname==='/token')
   return Response.json({access_token:'fixture-access-token',expires_in:3600});
  if(url.origin==='https://identitytoolkit.googleapis.com'&&
      url.pathname==='/v1/projects/'+project+'/accounts:lookup'){
   assert.equal(headers.get('Authorization'),'Bearer fixture-access-token');
   const {localId}=JSON.parse(init.body);
   return Response.json({users:localId.map(uid=>accounts[uid]).filter(Boolean)});
  }
  if(url.origin==='https://fcm.googleapis.com'&&url.pathname==='/v1/projects/'+project+'/messages:send'){
   assert.equal(headers.get('Authorization'),'Bearer fixture-access-token');
   assert.deepEqual(JSON.parse(init.body),{message:{token:'synthetic-not-an-fcm-token',
    data:{signal:'refresh'},android:{priority:'HIGH',ttl:'60s'}}});
   sends++;
   if(fcm==='unknown')throw Error('simulated_transport_lost');
   if(fcm==='rejected')return Response.json({error:{code:403}},{status:403});
   return Response.json({name:'projects/'+project+'/messages/synthetic-fcm-receipt'});
  }
  firestoreRequests++;
  assert.equal(url.origin,'https://firestore.googleapis.com','all other remote requests forbidden');
  assert.ok(url.pathname.startsWith('/v1/'+remoteRoot));
  assert.equal(headers.get('Authorization'),'Bearer fixture-access-token');
  headers.set('Authorization','Bearer owner');
  const body=init.body?.replaceAll(remoteRoot,demoRoot);
  const local=await originalFetch('http://'+host+url.pathname.replace(remoteRoot,demoRoot)+url.search,
   {...init,headers,body});
  const raw=(await local.text()).replaceAll(demoRoot,remoteRoot);
  // Count returned documents, not billed reads: missing docs, index reads,
  // retries and SDK claim/finish are not included in this metric.
  try{
   const data=JSON.parse(raw);
   firestoreDocuments+=Array.isArray(data)?data.filter(x=>x.found||x.document).length:
    Array.isArray(data.documents)?data.documents.length:data.name?.startsWith(remoteRoot+'/')?1:0;
  }catch{}
  return new Response(raw,{status:local.status,headers:{'Content-Type':'application/json'}});
 });
 const env={ATRIO_GENERAL_QA_MODE:'true',ATRIO_GENERAL_QA_PROJECT:project,
  ATRIO_QA_AGE_POLICY:identity.ageMode,PUSH_ENABLED:'true',FIREBASE_WEB_API_KEY:'fixture',
  FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:project,client_email:email,
   private_key:privateKey.export({type:'pkcs8',format:'pem'})}),PUSH_DB:database};
 async function dispatchClaimed(eventKey){
   const claim=await service.claim(eventKey);
   if(claim.status!=='claimed_lab')return claim;
   let outcome='unknown',workerStatus='unavailable';
   try{
    const snap=await db.doc('qaPushAutomaticOutbox/'+claim.eventKey).get();
    const o=snap.data();
    if(o?.state==='claimed_lab'&&o.claimId===claim.claimId&&
       o.expiresAt.toMillis()>Date.now()){
     const req=bindLabActor(new Request('https://qa.invalid/event',{method:'POST',
      body:JSON.stringify({type:'chat_message',chatId:o.conversationId,messageId:o.messageId})}),o.senderUid);
     const res=await worker.fetch(req,env);
     workerStatus=(await res.json()).status;
     if(res.status===202&&workerStatus==='accepted_by_fcm')outcome='accepted_simulated';
     else if(['ignored','no_devices_or_duplicate'].includes(workerStatus))
      outcome='rejected_simulated';
     // An interruption may follow a successful send to another device.
     // Treat it and HTTP/transport errors as unknown rather than claim no delivery.
    }
   }catch{/* any unexpected result is terminal unknown */}
   const result=await service.finish({...claim,outcome});
   return {...result,workerStatus};
 }
 return {
  stats:()=>({sends,reservations}),
  metrics:()=>({externalRequests,firestoreRequests,firestoreDocuments,d1Calls}),
  seedMarker(chat,message,recipient){
   sql.prepare('INSERT INTO delivered(event_key,created_at) VALUES (?,?)')
    .run('chat:'+chat+':'+message+':'+recipient,Date.now());
  },
  async dispatch(authorization,body){
   const verified=await contract.authorize({authorization,body});
   if(verified.status!=='authenticated_lab')return verified;
   return dispatchClaimed(verified.eventKey);
  },
  // A test-only private invocation, NOT a route or authentication bypass in
  // the generated deployable Worker. No client-provided actor or recipient.
  async dispatchInternal(eventKey){
   if(!enabled||typeof eventKey!=='string'||!/^[a-f0-9]{64}$/.test(eventKey))
    return {status:'ignored',reason:'invalid_internal_dispatch'};
   return dispatchClaimed(eventKey);
  }
 };
}
