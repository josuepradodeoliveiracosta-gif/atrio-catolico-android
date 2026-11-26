// Private candidate composition only; not imported by the deployed builder.
// One D1 binding for mode, outbox, and manual/automatic delivery markers.
import {createD1OutboxLab} from './qa-automatic-d1-outbox-lab.mjs';
import {createD1DispatchLab} from './qa-automatic-d1-dispatch-lab.mjs';
import {AUTO_CHAT} from '../../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
const uids=Object.keys(identity.accounts);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const json=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const stopped=()=>({status:'ignored',reason:'mode_unavailable'});
export function createD1ModeLab({db,mode='manual',activatedAt,manualWorker,verifyIdentity,
 readAuthorization,listDevices,sendRefresh,reserveAttempt}={}){
 if(typeof db?.prepare!=='function'||typeof manualWorker?.fetch!=='function'||typeof verifyIdentity!=='function')
  throw Error('missing_lab_dependency');
 if(!['manual','automatic'].includes(mode))throw Error('invalid_lab_mode');
 const enabled=mode==='automatic'&&Number.isSafeInteger(activatedAt)&&activatedAt>0;
 const outbox=createD1OutboxLab({db,enabled,activatedAt,readAuthorization});
 const dispatch=createD1DispatchLab({db,enabled,outbox,listDevices,sendRefresh,reserveAttempt});
 const query=(q,...args)=>db.prepare(q).bind(...args).first();
 async function modeCurrent(env){
  if(env?.PUSH_DB!==db||env.PUSH_ENABLED!=='true')return false;
  try{
   const row=await query("SELECT activated_at,enabled FROM qa_auto_d1_activation_lab WHERE singleton=1");
   if(mode==='automatic')return enabled&&row?.enabled===1&&row.activated_at===activatedAt;
   // Manual mode requires explicit disarm AND drainage of all live slots.
   // Operator must quiesce both runtimes before switching, not rely on this
   // read as an atomic distributed lock around a subsequent network send.
   if(row?.enabled!==0)return false;
   const live=await query("SELECT event_key FROM qa_auto_d1_outbox_lab WHERE expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER) LIMIT 1");
   return !live;
  }catch{return false}
 }
 return Object.freeze({
  async fetch(request,env){
   const url=new URL(request.url);
   if(url.search||!((request.method==='GET'&&['/health','/notice'].includes(url.pathname))||
    (request.method==='POST'&&url.pathname==='/event')))return json(404,{status:'not_found'});
   if(!await modeCurrent(env))return json(503,{status:'disabled'});
   if(mode==='manual')return manualWorker.fetch(request,env);
   // No public trigger in automatic mode, even for authenticated senders.
   if(url.pathname==='/event')return json(503,{status:'manual_disabled'});
   if(!env.FIREBASE_WEB_API_KEY||!env.FIREBASE_SERVICE_ACCOUNT_JSON)return json(503,{status:'not_configured'});
   if(url.pathname==='/health')return json(200,{status:'configured'});
   try{
    const recipient=await verifyIdentity(request,env);
    if(!uids.includes(recipient))return json(401,{status:'unauthorized'});
    if(!await modeCurrent(env))return json(503,{status:'disabled'});
    const n=await outbox.readNotice(recipient);
    if(!await modeCurrent(env))return json(503,{status:'disabled'});
    if(n?.status!=='notice_lab'||n.conversationId!==AUTO_CHAT||!id(n.messageId)||
       !uids.includes(n.senderUid)||n.senderUid===recipient)return json(404,{status:'no_notice'});
    return json(200,{conversationId:n.conversationId,messageId:n.messageId,senderUid:n.senderUid});
   }catch{return json(503,{status:'notice_unavailable'})}
  },
  // Internal methods only. No HTTP route or asserted actor.
  async publish(candidate,env){
   return mode==='automatic'&&await modeCurrent(env)?outbox.publish(candidate):stopped();
  },
  async dispatch(eventKey,env){
   return mode==='automatic'&&await modeCurrent(env)?dispatch(eventKey):stopped();
  }
 });
}
