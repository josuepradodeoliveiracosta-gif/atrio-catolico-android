// Test-only Worker entrypoint. Never configured in Wrangler or uploaded.
// All I/O is local D1 or explicit synthetic callbacks; no global fetch.
import {createD1OutboxLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-outbox-lab.mjs';
import {createD1DispatchLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-dispatch-lab.mjs';
import {createD1DailyBudgetLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-budget-lab.mjs';
import {createD1HttpCandidateLab,createD1HttpLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-http-lab.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
import {AUTO_CHAT} from '../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
const [alice,bob]=Object.keys(identity.accounts);
const gen=i=>'00000000-0000-4000-8000-00000000000'+i;
const check=(ok,code)=>{if(!ok)throw Error(code)};
export default {async fetch(req,env){
 if(env.LAB_ONLY!=='true'||new URL(req.url).pathname!=='/probe'||req.method!=='GET')return new Response(null,{status:404});
 try{
  // Diagnostics only: .all() exposes meta for SELECT whereas .first() does not.
  // Every measured query remains identical; never log SQL, bind values or IDs.
  const units={calls:0,rowsRead:0,rowsWritten:0};
  function meter(result){
   const m=result?.meta;
   check(Number.isSafeInteger(m?.rows_read)&&m.rows_read>=0&&Number.isSafeInteger(m?.rows_written)&&m.rows_written>=0,'missing_d1_row_meta');
   units.calls++;units.rowsRead+=m.rows_read;units.rowsWritten+=m.rows_written;
   return result;
  }
  const db={prepare(q){return {bind(...args){
   const statement=env.PUSH_DB.prepare(q).bind(...args);
   return {async run(){return meter(await statement.run())},async first(){
    const r=meter(await statement.all());return r.results[0]??null
   }};
  }}}};
  const activatedAt=Number(env.ACTIVATED_AT),created=Number(env.CREATED_AT);
  const {projectId,databaseId,roundId,ageMode}=identity;
  const noIO=async()=>{throw Error('unexpected_io')};
  const disabled=createD1HttpCandidateLab({db,fetchImpl:noIO,manualWorker:{fetch:noIO}});
  check((await disabled.tick({})).result.reason==='automation_disabled','disabled');
  // Actual WebCrypto OAuth in workerd, but no external network.
  let httpCalls=0;
  const http=createD1HttpLab({enabled:true,kind:'tick',webApiKey:'fixture',
   serviceAccount:JSON.parse(env.FIXTURE_SERVICE),fetchImpl:async(url,init)=>{
    httpCalls++;check(init.redirect==='manual'&&!!init.signal,'redirect_or_timeout');
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-token',token_type:'Bearer',expires_in:3600});
    check(url==='https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)/documents:beginTransaction','http_destination');
    check(init.headers.Authorization==='Bearer fixture-token','oauth_header');
    return Response.json({transaction:'fixture-read-only'});
   }});
  const begin=await http.transport({url:'https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)/documents:beginTransaction',
   method:'POST',redirect:'error',body:{options:{readOnly:{}}}});
  check(begin.status===200&&httpCalls===2,'http_probe');
  const event={type:'created',projectId,databaseId,chatId:AUTO_CHAT,messageId:'workerd-fixture',
   expectedCreateTime:{seconds:Math.floor(created/1000),nanoseconds:(created%1000)*1000000}};
  const candidate={status:'candidate',event,deadline:created+120000};
  const readAuthorization=async()=>{
   const accounts={},admissions={},eligibility={};
   for(const [i,uid] of [alice,bob].entries()){
    accounts[uid]={uid,email:identity.accounts[uid],emailVerified:true,disabled:false};
    admissions[uid]={status:'active',email:identity.accounts[uid],roundId,generation:gen(i),admittedAt:created-2000,expiresAt:null};
    eligibility[uid]={status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',updatedAt:created-3000,reviewExpiresAt:created+300000};
   }
   return {now:Date.now(),creation:event.expectedCreateTime,snapshot:{projectId,databaseId,chatId:AUTO_CHAT,messageId:event.messageId,managedBoundary:false,
    config:{enabled:true,qaSimpleDirectEnabled:true,minorPolicyApproved:true,version:'2026-11-v1',safetyReviewVersion:'2026-11-safety-v1',
     pushPilot:{enabled:true,projectId,databaseId,roundId,ageMode,expiresAt:null}},
    room:{status:'accepted',lastMessageId:event.messageId,lastSenderUid:bob,participants:[alice,bob],requesterUid:alice,recipientUid:bob,unreadRequester:1,unreadRecipient:0},
    message:{uid:bob,kind:'text',createdAt:created},accounts,admissions,eligibility,blocked:{[alice]:false,[bob]:false},muted:false,deviceEligible:true,receipt:null,pending:null}};
  };
  const outbox=createD1OutboxLab({db,enabled:true,activatedAt,readAuthorization});
  const reserve=createD1DailyBudgetLab({db,enabled:true});
  check(await reserve('discovery'),'discovery_reservation');
  const pubs=await Promise.all([outbox.publish(candidate),outbox.publish(candidate)]);
  const winner=pubs.find(x=>x.status==='published_lab');
  check(pubs.filter(x=>x.status==='published_lab').length===1,'atomic_publication');
  let signals=0;
  const dispatch=createD1DispatchLab({db,enabled:true,outbox,reserveAttempt:()=>reserve('work'),
   listDevices:async()=>[{token:'synthetic-not-an-fcm-token',time:created,path:'users/'+alice+'/pushDevices/fake',updateTime:new Date(created).toISOString()}],
   sendRefresh:async m=>{signals++;check(m.data.signal==='refresh'&&Number.parseInt(m.android.ttl)<=60,'refresh');
    return Response.json({name:'projects/'+projectId+'/messages/synthetic'})}});
  const results=await Promise.all([dispatch(winner.eventKey),dispatch(winner.eventKey)]);
  check(signals===1&&results.filter(x=>x.transportStatus==='accepted_simulated').length===1,'exclusive_dispatch');
  const n=await outbox.readNotice(alice);
  check(n.status==='notice_lab'&&n.messageId===event.messageId,'notice');
  check((await outbox.readNotice(bob)).reason==='no_notice','recipient');
  return Response.json({status:'passed',signals,httpCalls,units,eventKey:winner.eventKey});
 }catch(e){return Response.json({status:'failed',reason:String(e.message).slice(0,100)},{status:500})}
}};
