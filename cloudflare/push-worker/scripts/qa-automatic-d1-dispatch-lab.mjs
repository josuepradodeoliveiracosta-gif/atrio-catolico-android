// Internal experimental dispatch. Never route client identity or event payload
// through the manual /event handler. All dependencies are explicit and trusted.
import {AUTO_CHAT} from '../../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
const uids=Object.keys(identity.accounts);
const key=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const deny=reason=>({status:'ignored',reason});
const valid=(a,c)=>a?.status==='authorized_lab'&&a.eventKey===c.eventKey&&a.claimId===c.claimId&&
 a.conversationId===AUTO_CHAT&&id(a.messageId)&&uids.includes(a.senderUid)&&uids.includes(a.recipientUid)&&
 a.senderUid!==a.recipientUid&&Number.isSafeInteger(a.expiresAt)&&a.expiresAt-Date.now()>=10000;
const same=(a,b)=>['eventKey','claimId','conversationId','messageId','senderUid','recipientUid','expiresAt'].every(k=>a[k]===b[k]);
const eligible=(list,uid)=>{
 if(!Array.isArray(list)||list.length!==1)return null;
 const d=list[0],prefix='users/'+uid+'/pushDevices/';
 if(typeof d?.token!=='string'||d.token.length<20||d.token.length>4096||
    typeof d.path!=='string'||!d.path.startsWith(prefix)||!id(d.path.slice(prefix.length))||
    typeof d.updateTime!=='string'||!Number.isFinite(Date.parse(d.updateTime))||
    !Number.isSafeInteger(d.time)||d.time<=Date.now()-60*86400000||d.time>Date.now()+60000)return null;
 return d;
};
const sameDevice=(a,b)=>!!a&&!!b&&['token','path','updateTime','time'].every(k=>a[k]===b[k]);
export function createD1DispatchLab({enabled=false,db,outbox,listDevices,sendRefresh,reserveAttempt}={}){
 if(typeof db?.prepare!=='function'||[outbox?.claim,outbox?.authorizeClaim,outbox?.finish,listDevices,sendRefresh,reserveAttempt].some(f=>typeof f!=='function'))throw Error('missing_lab_dependency');
 return async function dispatch(eventKey){
  if(enabled!==true||!key(eventKey))return deny('invalid_or_disabled');
  try{if(await reserveAttempt()!==true)return deny('transport_budget_unavailable')}catch{return deny('transport_budget_unavailable')}
  let c;
  try{c=await outbox.claim(eventKey)}catch{return {status:'claim_unknown_lab'}}
  if(c?.status!=='claimed_lab')return c??deny('claim_unavailable');
  if(c.eventKey!==eventKey||!uuid(c.claimId))return {status:'claim_unknown_lab'};
  let outcome='unknown',transportStatus='unavailable';
  try{
   const a=await outbox.authorizeClaim(c);
   if(!valid(a,c)){outcome='rejected_simulated';transportStatus='authorization_changed'}
   else{
    const device=eligible(await listDevices(a.recipientUid),a.recipientUid);
    if(!device){outcome='rejected_simulated';transportStatus='device_capacity_or_unavailable'}
    else{
     // Same marker as the manual Worker, same binding required by composition.
     // Never delete this marker or retry after an ambiguous reservation.
     const marker='chat:'+a.conversationId+':'+a.messageId+':'+a.recipientUid;
     const r=await db.prepare('INSERT OR IGNORE INTO delivered (event_key,created_at) VALUES (?,?)').bind(marker,Date.now()).run();
     if(r?.success===true&&r.meta?.changes===0){outcome='rejected_simulated';transportStatus='duplicate'}
     else if(r?.success===true&&r.meta?.changes===1){
      const current=eligible(await listDevices(a.recipientUid),a.recipientUid);
      const b=await outbox.authorizeClaim(c);
      if(!sameDevice(device,current)||!valid(b,c)||!same(a,b)){
       outcome='rejected_simulated';transportStatus='authorization_or_device_changed';
      }else{
       const ttl=Math.min(60,Math.floor((b.expiresAt-Date.now())/1000));
       if(ttl>=10){
        const res=await sendRefresh({token:current.token,data:{signal:'refresh'},android:{priority:'HIGH',ttl:ttl+'s'}});
        // Only an explicit success receipt for this project counts as acceptance.
        const prefix='projects/'+identity.projectId+'/messages/';
        if(res?.ok===true){
         const body=await res.json();
         if(typeof body?.name==='string'&&body.name.startsWith(prefix)&&body.name.length>prefix.length&&
            body.name.length<=prefix.length+512&&!/\s|\//.test(body.name.slice(prefix.length))){
          outcome='accepted_simulated';transportStatus='accepted_simulated';
         }
        }else if(Number.isInteger(res?.status)&&res.status>=400&&res.status<500&&res.status!==429){
         outcome='rejected_simulated';transportStatus='rejected_simulated';
        }
       }
      }
     }
    }
   }
  }catch{/* uncertain reservation, send or response is terminal unknown */}
  try{
   const result=await outbox.finish({...c,outcome});
   return {...result,transportStatus}; // durable terminal state may be unknown
  }catch{return {status:'finish_unknown_lab',transportStatus}}
 };
}
