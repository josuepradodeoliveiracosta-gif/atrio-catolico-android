/**
 * Dedicated *private* staging Service Binding consumer for synthetic UIDs.
 *
 * Exactly one role per independently deployed Worker, one HMAC secret
 * per role. Never bind to Firebase, Cloudinary, production Push or Avatar.
 * No public routes, workers.dev or preview endpoints. Temporary QA-only cron.
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
  // PRIVATE scheduled QA, no public route. HMAC remains scoped to this
  // Worker's existing role and secret. A fixed replay nonce limits this
  // one-run proof to a single admitted request per role.
  async scheduled(controller,env){
    const role=env?.ATRIO_QA_CONSUMER_ROLE;
    const config={
      avatar:{uid:'qa-freeze-alice',nonce:'11111111-1111-4111-8111-111111111111'},
      guardian:{uid:'qa-freeze-bob',nonce:'22222222-2222-4222-8222-222222222222'},
      push:{uid:'qa-freeze-alice',nonce:'33333333-3333-4333-8333-333333333333'}
    };
    const selected=Object.hasOwn(config,role)?config[role]:null;
    const moment=controller?.scheduledTime;
    if(controller?.cron!=='* * * * *'||
       !Number.isSafeInteger(moment)||
       moment<Date.parse('2026-11-03T00:00:00Z')||
       moment>=Date.parse('2026-11-04T00:00:00Z')||
       env?.ATRIO_QA_CONSUMER_FIXTURE!=='demo-atrio-v11'||
       typeof env?.PRIVACY_FREEZE_STAGE?.fetch!=='function'||
       !selected)return;
    try{
      const client=createStageServiceClient({
        binding:env.PRIVACY_FREEZE_STAGE,role,
        secret:env.ATRIO_QA_CONSUMER_HMAC,
        createNonce:()=>selected.nonce
      });
      await client.request('canary',{
        runId:'qa-hosted-20261103-a',uid:selected.uid
      });
    }catch{
      // No secrets, tokens, UIDs or error payloads written to logs.
      console.warn('qa_hosted_canary_not_verified');
    }
  },
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
