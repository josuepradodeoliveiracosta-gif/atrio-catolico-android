// One bounded, private invocation. No scheduler, default credentials, network
// or deployed route. SDK/Worker callbacks are charged conservatively by
// contract; real transport must enforce actual HTTP attempts as well.
import {createD1DailyBudgetLab,createD1InvocationBudgetLab} from './qa-automatic-d1-budget-lab.mjs';
import {createD1ReadAuthorizationLab} from './qa-automatic-d1-read-lab.mjs';
import {createD1ModeLab} from './qa-automatic-d1-mode-lab.mjs';
import {createFreeRestDiscoveryLab} from './qa-automatic-free-rest-lab.mjs';
import {AUTO_CHAT} from '../../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
const stop=reason=>({status:'ignored',reason});
const keyFor=async e=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(JSON.stringify([identity.roundId,AUTO_CHAT,e.messageId])))),b=>b.toString(16).padStart(2,'0')).join('');
export function createMeteredD1Lab({db,enabled=false,activatedAt,transport,lookupAccounts,
 manualWorker,verifyIdentity,listDevices,sendRefresh}={}){
 if(typeof db?.prepare!=='function'||typeof manualWorker?.fetch!=='function'||
 [transport,lookupAccounts,verifyIdentity,listDevices,sendRefresh].some(x=>typeof x!=='function'))throw Error('missing_lab_dependency');
 const ready=env=>enabled===true&&Number.isSafeInteger(activatedAt)&&activatedAt>0&&env?.PUSH_DB===db&&
  env.PUSH_ENABLED==='true'&&!!env.FIREBASE_WEB_API_KEY&&!!env.FIREBASE_SERVICE_ACCOUNT_JSON;
 function invocation(kind,env){
  const meter=createD1InvocationBudgetLab(kind);
  const measuredDb={prepare(sql){
   return {bind(...params){return {
    async first(){meter.chargeD1();return db.prepare(sql).bind(...params).first()},
    async run(){
     meter.chargeD1({finish:sql.startsWith("UPDATE qa_auto_d1_outbox_lab SET state=CASE WHEN")});
     return db.prepare(sql).bind(...params).run();
    }
   }}};
  }};
  const scopedEnv={...env,PUSH_DB:measuredDb};
  const reserve=createD1DailyBudgetLab({db:measuredDb,enabled:true});
  const measuredTransport=async req=>{meter.chargeExternal();return transport(req)};
  const readAuthorization=createD1ReadAuthorizationLab({transport:measuredTransport,lookupAccounts:async uids=>{
   meter.chargeExternal(uids.length);return lookupAccounts(uids);
  }});
  // Work is reserved before either publication or claim. The dispatch callback
  // spends that same reservation exactly once rather than a second daily slot.
  let workReserved=false,dispatchUsed=false;
  const activeWorker=createD1ModeLab({db:measuredDb,mode:'automatic',activatedAt,manualWorker,
   verifyIdentity:async(...args)=>{meter.chargeExternal();return verifyIdentity(...args)},
   readAuthorization,listDevices:async uid=>{meter.chargeExternal();return listDevices(uid)},
   sendRefresh:async message=>{meter.chargeExternal();return sendRefresh(message)},
   reserveAttempt:async()=>{if(!workReserved||dispatchUsed)return false;dispatchUsed=true;return true}
  });
  const discover=createFreeRestDiscoveryLab({transport:measuredTransport,reserveDiscovery:()=>reserve('discovery')});
  return {meter,scopedEnv,reserve,measuredDb,activeWorker,discover,
   async reserveWork(){if(workReserved)return false;workReserved=await reserve('work');return workReserved}};
 }
 return Object.freeze({
  async tick(env){
   if(!ready(env))return {result:stop('automation_disabled'),usage:null};
   const i=invocation('tick',env);
   let result;
   try{
    // No external work if the persistent mode/epoch is not current.
    const a=await i.measuredDb.prepare('SELECT activated_at,enabled FROM qa_auto_d1_activation_lab WHERE singleton=1').bind().first();
    if(a?.enabled!==1||a.activated_at!==activatedAt)result=stop('mode_unavailable');
    else{
     const c=await i.discover({enabled:true,projectId:identity.projectId,activatedAt});
     if(c.status!=='candidate')result=c;
     else{
      const k=await keyFor(c.event);
      const r=await i.measuredDb.prepare('SELECT state FROM qa_auto_d1_outbox_lab WHERE event_key=?').bind(k).first();
      if(r&&r.state!=='pending_transport')result=stop('not_pending');
      else if(!await i.reserveWork())result=stop('work_budget_unavailable');
      else{
       // Pending recovery is exact key only; claim revalidates creation,
       // deadline, activation and current authorization. Never reopen claims.
       const pub=r?{status:'published_lab',eventKey:k}:await i.activeWorker.publish(c,i.scopedEnv);
       result=pub.status==='published_lab'&&pub.eventKey===k?
        await i.activeWorker.dispatch(k,i.scopedEnv):pub;
      }
     }
    }
   }catch{result=stop('invocation_unavailable')}
   return {result,usage:i.meter.snapshot()};
  },
  async notice(request,env){
   const unavailable=()=>Response.json({status:'notice_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
   const u=new URL(request.url);
   if(!ready(env)||request.method!=='GET'||u.pathname!=='/notice'||u.search)return {response:unavailable(),usage:null};
   const i=invocation('notice',env);
   let response;
   try{response=await i.reserve('notice')?await i.activeWorker.fetch(request,i.scopedEnv):unavailable()}
   catch{response=unavailable()}
   return {response,usage:i.meter.snapshot()};
  }
 });
}
