import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync} from 'node:crypto';
import {createQaProbeScheduledLab,D1_PROBE_SCHEDULE_SCHEMA} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-probe-scheduled-lab.mjs';
const project='atrio-catolico-qa-general',root='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
function fixture(t){
 const at=Math.floor(Date.now()/60000)*60000,now=at+5000;
 t.mock.method(Date,'now',()=>now);
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(D1_PROBE_SCHEDULE_SCHEMA);
 sql.prepare('INSERT INTO qa_auto_identity_probe_lab(singleton,starts_at,ends_at) VALUES(1,?,?)').run(at,at+600000);
 const db={prepare(q){return {bind(...args){return {async run(){
  const r=sql.prepare(q.replaceAll("CAST(unixepoch('subsec')*1000 AS INTEGER)",String(now))).run(...args);
  return {success:true,meta:{changes:r.changes}};
 }}}}}};
 const env={QA_IDENTITY_PROBE_ENABLED:'true',QA_IDENTITY_PROBE_START:String(at),QA_PUSH_DB:db,QA_FIREBASE_WEB_API_KEY:'fixture',
  QA_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:project,client_email:'atrio-qa-general-push@'+project+'.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})})};
 const calls=[],logs=[];
 const run=createQaProbeScheduledLab({report:r=>logs.push(r),fetchImpl:async(url,init)=>{
  calls.push(url);
  assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-access',token_type:'Bearer',expires_in:3600});
  if(url===root+':beginTransaction')return Response.json({transaction:'fixture-tx'});
  if(url===root+':rollback')return Response.json({});
  if(url==='https://identitytoolkit.googleapis.com/v1/projects/'+project+'/accounts:lookup')return Response.json({users:[
   {localId:'qa-nav-alice',email:'alice.navegacao@qa.invalid',emailVerified:true,disabled:false},
   {localId:'qa-nav-bob',email:'bob.navegacao@qa.invalid',emailVerified:true,disabled:false}]});
  assert.fail('unexpected network');
 }});
 return {sql,env,at,now,run,calls,logs,controller:{cron:'* * * * *',scheduledTime:at}};
}
test('one-shot probe fails closed for automatic mode, wrong schedule and disabled flag',async t=>{
 const f=fixture(t);
 for(const e of [{...f.env,QA_IDENTITY_PROBE_ENABLED:'false'},{...f.env,QA_AUTO_MODE:'automatic'},{...f.env,QA_AUTO_SCHEDULE_ENABLED:'true'}])
  assert.equal((await f.run(f.controller,e)).reason,'probe_disabled');
 assert.equal((await f.run({...f.controller,scheduledTime:f.at-60000},f.env)).reason,'probe_schedule_invalid');
 assert.equal(f.calls.length,0);
 assert.equal(f.sql.prepare('SELECT consumed FROM qa_auto_identity_probe_lab').get().consumed,0);
});
test('concurrent diagnostic events execute once, at most four fixed external attempts and no FCM',async t=>{
 const f=fixture(t);
 const r=await Promise.all(Array.from({length:6},()=>f.run(f.controller,f.env)));
 assert.equal(r.filter(x=>x.status==='probe_passed').length,1);
 assert.equal(r.filter(x=>x.reason==='probe_reservation_unavailable').length,5);
 assert.deepEqual(f.calls,['https://oauth2.googleapis.com/token',root+':beginTransaction',root+':rollback','https://identitytoolkit.googleapis.com/v1/projects/'+project+'/accounts:lookup']);
 assert.equal(f.sql.prepare('SELECT consumed FROM qa_auto_identity_probe_lab').get().consumed,1);
 assert.ok(f.logs.every(x=>x.fcmAttempts===0&&x.firestoreWrites===0&&x.activationAuthorized===false));
 assert.ok(!JSON.stringify(f.logs).includes('fixture-access'));
});
test('expired window or missing row never starts probe',async t=>{
 const f=fixture(t);
 f.sql.prepare('UPDATE qa_auto_identity_probe_lab SET ends_at=?').run(f.now+1000);
 assert.equal((await f.run(f.controller,f.env)).reason,'probe_reservation_unavailable');
 f.sql.exec('DELETE FROM qa_auto_identity_probe_lab');
 assert.equal((await f.run(f.controller,f.env)).reason,'probe_reservation_unavailable');
 assert.equal(f.calls.length,0);
});
