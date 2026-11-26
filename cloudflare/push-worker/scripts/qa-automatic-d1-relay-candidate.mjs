// Candidate composition of the actual QA relay. Not a deployed entrypoint.
// No public tick, scheduler, migration or default network implementation.
import {createQaRelay} from '../src/qa-geral.js';
import {createD1HttpCandidateLab} from './qa-automatic-d1-http-lab.mjs';
import {createD1TrialGate,manualModeReady} from './qa-automatic-d1-trial-lab.mjs';
const disabled=()=>Response.json({status:'disabled'},{status:503,headers:{'Cache-Control':'no-store'}});
const ignored=()=>({result:{status:'ignored',reason:'trial_unavailable'},usage:null,httpUsage:null});
function config(env){
 const epoch=env?.QA_AUTO_ACTIVATED_AT;
 return typeof epoch==='string'&&/^[1-9]\d{0,15}$/.test(epoch)&&Number.isSafeInteger(Number(epoch))?Number(epoch):null;
}
const enabled=env=>env?.QA_PUSH_ENABLED==='true'&&env.QA_CONVERSATION_PUSH_ENABLED==='true'&&
 env.QA_AUTO_MODE==='automatic'&&config(env)!==null&&typeof env.QA_PUSH_DB?.prepare==='function'&&
 !!env.QA_FIREBASE_WEB_API_KEY&&!!env.QA_FIREBASE_SERVICE_ACCOUNT_JSON;
export function createQaAutomaticCandidateRelay({manualWorker,conversationsApi,fetchImpl}={}){
 if(typeof manualWorker?.fetch!=='function'||typeof fetchImpl!=='function')throw Error('missing_candidate_dependency');
 async function invocation(env,kind){
  if(!enabled(env))return null;
  const db=env.QA_PUSH_DB,activatedAt=config(env);
  const end=await createD1TrialGate({db,activatedAt})(kind);
  if(end===null||Date.now()>=end)return null;
  const flow=createD1HttpCandidateLab({db,enabled:true,activatedAt,manualWorker,
   fetchImpl:(url,init)=>{
    // No network attempt after the finite trial deadline. Prior authorization
    // and the outbox deadline still apply; no cross-store atomicity.
    if(Date.now()>=end)throw Error('trial_expired');
    return fetchImpl(url,init);
   }});
  return {flow,end,env:{PUSH_DB:db,PUSH_ENABLED:'true',FIREBASE_WEB_API_KEY:env.QA_FIREBASE_WEB_API_KEY,
   FIREBASE_SERVICE_ACCOUNT_JSON:env.QA_FIREBASE_SERVICE_ACCOUNT_JSON}};
 }
 return Object.freeze({
  async fetch(request,env){
   // Only intercept the two conversation routes already dispatched by
   // createQaRelay. The other routes retain their exact existing behavior.
   const conversation={async fetch(req,mapped){
    if(env.QA_AUTO_MODE==='manual'){
     if(!await manualModeReady(mapped.PUSH_DB))return disabled();
     return manualWorker.fetch(req,mapped);
    }
    if(!enabled(env)||new URL(req.url).pathname!=='/notice'||req.method!=='GET')return disabled();
    if(new URL(req.url).search)return disabled();
    const i=await invocation(env,'notice');
    if(!i)return disabled();
    const n=await i.flow.notice(req,i.env);
    return Date.now()<i.end?n.response:disabled();
   }};
   return createQaRelay(conversation,conversationsApi).fetch(request,env);
  },
  async tick(env){
   const i=await invocation(env,'tick');
   return i?i.flow.tick(i.env):ignored();
  }
 });
}
