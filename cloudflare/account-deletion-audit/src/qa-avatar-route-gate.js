/**
 * QA-ONLY wrapper around the EXISTING Avatar Worker fetch handler.
 * No active Worker imports this file; no routes, secrets or D1 binding
 * are configured in production. Identity and post-effect checks are injected
 * from isolated test fixtures. Do not deploy this wrapper.
 *
 * Important: every mutation route (including /avatar/status promotion)
 * must be admitted BEFORE the real Worker entrypoint is called.
 * Unknown routes/methods are denied rather than silently bypassing the gate.
 */
import {createQaAvatarD1Binding} from './qa-avatar-d1-binding.js';
import {withQaAvatarOutboundGate} from './qa-avatar-outbound-gate.js';
const QA_UIDS=new Set(['qa-freeze-alice','qa-freeze-bob']);
const PATHS=Object.freeze({
  'POST /avatar/upload':{kind:'avatar_upload',scope:'self'},
  'POST /avatar/status':{kind:'avatar_promote',scope:'self'},
  'DELETE /avatar':{kind:'avatar_remove',scope:'self'},
  'POST /avatar/moderate':{kind:'avatar_moderation',scope:'target'},
  'POST /avatar/moderation/review':{kind:'avatar_moderation',scope:'target'},
  'GET /avatar/moderation/pending':{kind:'read_only'},
  'GET /avatar/moderation/preview':{kind:'read_only'}
});
export const QA_AVATAR_ROUTE_MAP=PATHS;
const result=(status,code)=>new Response(JSON.stringify({status:code}),{
  status,headers:{'content-type':'application/json','cache-control':'no-store'}
});

async function readBoundedTarget(request){
  const candidate=request.clone();
  const stream=candidate.body?.getReader();
  if(!stream)throw Error('qa_invalid_moderation_body');
  const chunks=[];let size=0;
  try{
    for(;;){
      const {done,value}=await stream.read();
      if(done)break;
      size+=value.byteLength;
      if(size>384)throw Error('qa_moderation_body_too_large');
      chunks.push(value);
    }
  }catch(error){
    // A cloned Request uses a tee: waiting for cancel() can remain pending
    // until the OTHER branch is consumed. Never await cancellation here.
    void stream.cancel().catch(()=>{});
    throw error;
  }finally{
    stream.releaseLock();
  }
  const raw=new Uint8Array(size);let pos=0;
  for(const chunk of chunks){raw.set(chunk,pos);pos+=chunk.length;}
  let data;
  try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw Error('qa_invalid_moderation_body');}
  if(!data||Array.isArray(data)||typeof data!=='object'||
    typeof data.uid!=='string'||!QA_UIDS.has(data.uid))
    throw Error('qa_invalid_moderation_target');
  return data.uid;
}

export function createQaAvatarRouteGate({worker,barrier,verifyUid,verifyEffect,transport}={}){
  if(typeof worker?.fetch!=='function'||typeof barrier?.begin!=='function'||
    typeof barrier?.complete!=='function'||typeof verifyUid!=='function'||
    typeof verifyEffect!=='function'||typeof transport!=='function')
    throw Error('qa_missing_route_gate_dependency');
  return Object.freeze({
    async fetch(request,env){
      if(!(request instanceof Request))return result(400,'qa_invalid_request');
      const route=PATHS[request.method+' '+new URL(request.url).pathname];
      if(!route)return result(503,'qa_uncovered_route');
      let actor;
      try{actor=await verifyUid(request,env);}
      catch{return result(503,'qa_identity_unavailable');}
      if(!QA_UIDS.has(actor))return result(401,'qa_unauthorized_fixture');
      // Read-only routes may be served by the original Worker, which verifies
      // Firebase identity independently. Any new route must be reviewed first.
      if(route.kind==='read_only'){
        try{return await worker.fetch(request,env);}
        catch{return result(503,'qa_read_failed');}
      }
      let scope;
      try{
        scope=route.scope==='self'?{ownerUid:actor}:{
          ownerUid:await readBoundedTarget(request),actorUid:actor
        };
      }catch(error){
        return result(error.message==='qa_moderation_body_too_large'?413:400,
          'qa_invalid_moderation_request');
      }
      let ticket;
      try{ticket=await barrier.begin(route.kind,scope);}
      catch{return result(423,'qa_privileged_write_blocked');}
      // The ticket intentionally remains OPEN if the Worker errors, the
      // response is ambiguous, or verification fails. Manual reconciliation
      // is necessary before marking the account frozen.
      let response;
      try{
        // The route ticket is acquired BEFORE ANY Avatar D1 write. The
        // original Worker is called unchanged with a QA-only D1 facade.
        response=await withQaAvatarOutboundGate({
          env,scope,transport,
          run:()=>worker.fetch(request,{
            ...env,AVATAR_DB:createQaAvatarD1Binding({
              db:env?.AVATAR_DB,scope,kind:route.kind
            })
          })
        });
      }catch{return result(503,'qa_mutation_unknown');}
      if(!(response instanceof Response)||!response.ok)
        return response instanceof Response?response:result(503,'qa_mutation_unknown');
      try{
        const accepted=await verifyEffect({
          kind:route.kind,scope,response:response.clone()
        });
        if(accepted!==true)return result(503,'qa_mutation_unverified');
        await barrier.complete(ticket,{verified:async()=>true});
      }catch{return result(503,'qa_mutation_unverified');}
      return response;
    }
  });
}
