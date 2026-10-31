/**
 * Dedicated *private* staging Service Binding consumer for synthetic UIDs.
 *
 * Exactly one role per independently deployed Worker, one HMAC secret
 * per role. Never bind to Firebase, Cloudinary, production Push or Avatar.
 * No public routes, workers.dev or preview endpoints. No cron/queue.
 */
import {createStageServiceClient} from './client.js';
const ROLES=['avatar','guardian','push','admin','reconciler'];
const scopes=Object.freeze({
  avatar:Object.freeze({ownerUid:'qa-freeze-alice'}),
  guardian:Object.freeze({ownerUid:'qa-freeze-bob'}),
  push:Object.freeze({actorUid:'qa-freeze-alice',
    recipientUid:'qa-freeze-bob'}),
  admin:Object.freeze({uid:'qa-freeze-alice'})
});
const forbid=(code='qa_stage_denied')=>new Response(
  JSON.stringify({status:code}),{status:403,headers:{
    'content-type':'application/json','cache-control':'no-store'
  }}
);
function validTicketId(id){
  return typeof id==='string'&&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
}
export default {
  async fetch(request,env){
    try{
      if(!request||!env||request.method!=='POST'||
         new URL(request.url).origin!=='https://qa-only.invalid'||
         !ROLES.includes(env.ATRIO_QA_CONSUMER_ROLE)||
         env.ATRIO_QA_CONSUMER_FIXTURE!=='demo-atrio-v11'||
         typeof env.PRIVACY_FREEZE_STAGE?.fetch!=='function'||
         typeof env.ATRIO_QA_CONSUMER_HMAC!=='string')
        return forbid();
      const role=env.ATRIO_QA_CONSUMER_ROLE;
      const path=new URL(request.url).pathname;
      const op=(role==='admin'&&path==='/__qa/status')?'status':
        (role==='admin'&&path==='/__qa/drain')?'drain':
        (role==='admin'&&path==='/__qa/finalize')?'finalize':
        (role==='reconciler'&&path==='/__qa/close')?'close':
        (['avatar','guardian','push'].includes(role)&&
          path==='/__qa/admit')?'admit':null;
      if(!op)return forbid();
      let payload=scopes[role];
      if(op==='close'){
        const length=request.headers.get('content-length');
        if(length!==null&&(!/^\d+$/.test(length)||Number(length)>120))
          return forbid();
        const reader=request.body?.getReader();
        if(!reader)return forbid();
        const decoder=new TextDecoder('utf-8',{fatal:true});
        let raw='',bytes=0;
        try{
          while(true){
            const {done,value}=await reader.read();
            if(done)break;
            bytes+=value.byteLength;
            if(bytes>120)return forbid();
            raw+=decoder.decode(value,{stream:true});
          }
          raw+=decoder.decode();
        }finally{reader.releaseLock();}
        let input;
        try{input=JSON.parse(raw)}catch{return forbid();}
        if(!input||Object.keys(input).join(',')!=='operationId'||
           !validTicketId(input.operationId))return forbid();
        payload={operationId:input.operationId,fixtureEvidence:'demo-confirmed'};
      }else if(request.body!==null){
        return forbid();
      }
      const client=createStageServiceClient({
        binding:env.PRIVACY_FREEZE_STAGE,
        role,secret:env.ATRIO_QA_CONSUMER_HMAC
      });
      const result=await client.request(op,payload);
      return new Response(JSON.stringify({
        status:result.status,
        ...(validTicketId(result.operationId)?
          {operationId:result.operationId}:{}),
        ...(op==='status'?{state:result.state,inFlight:result.inFlight}:{})
      }),{status:200,headers:{
        'content-type':'application/json','cache-control':'no-store'
      }});
    }catch{return forbid();}
  }
};
