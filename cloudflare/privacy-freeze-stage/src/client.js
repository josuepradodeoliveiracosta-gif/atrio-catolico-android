/**
 * Staging Service Binding client. Pure HTTP-over-binding (never global fetch).
 * Do not import into deployed production Workers until IAM and routing review.
 */
import {
  STAGE_HOST,STAGE_ID,STAGE_ROLES,stageSignature,
  stageNonceOk,stageFixtureUid,strictStageKey
} from './protocol.js';

const routes=Object.freeze({
  admit:'/v1/admit',drain:'/v1/drain',
  finalize:'/v1/finalize',close:'/v1/close',status:'/v1/status'
});
const deny=()=>{throw Error('qa_stage_client_denied');};
function validate(role,op,payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))deny();
  const keys=Object.keys(payload).sort().join(',');
  if(op==='admit'){
    if(!['avatar','guardian','push'].includes(role))deny();
    const required=role==='push'?'actorUid,recipientUid':'ownerUid';
    if(keys!==required||Object.values(payload).some(v=>!stageFixtureUid(v))||
       (role==='push'&&payload.actorUid===payload.recipientUid))deny();
  }else if(['drain','finalize','status'].includes(op)){
    if(role!=='admin'||keys!=='uid'||!stageFixtureUid(payload.uid))deny();
  }else if(op==='close'){
    if(role!=='reconciler'||keys!=='fixtureEvidence,operationId'||
       payload.fixtureEvidence!=='demo-confirmed'||
       typeof payload.operationId!=='string'||
       !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.operationId))
      deny();
  }else deny();
}
export function createStageServiceClient({
  binding,role,secret,clock=Date.now,createNonce=()=>crypto.randomUUID()
}={}){
  if(typeof binding?.fetch!=='function'||!Object.hasOwn(STAGE_ROLES,role)||
     !strictStageKey(secret)||typeof clock!=='function'||
     typeof createNonce!=='function')deny();
  return Object.freeze({
    async request(op,payload){
      validate(role,op,payload);
      const timestamp=clock(),nonce=createNonce();
      if(!Number.isSafeInteger(timestamp)||timestamp<1e12||
         !stageNonceOk(nonce))deny();
      const body=JSON.stringify(payload),path=routes[op];
      if(!path||body.length>512)deny();
      const signature=await stageSignature(secret,
        {role,timestamp,nonce,path,body});
      const response=await binding.fetch(new Request(STAGE_HOST+path,{
        method:'POST',
        headers:{'Content-Type':'application/json',
          'x-atrio-role':role,'x-atrio-time':String(timestamp),
          'x-atrio-nonce':nonce,'x-atrio-signature':signature},
        body
      }));
      if(!(response instanceof Response)||!response.ok)deny();
      const result=await response.json();
      if(!result||typeof result.status!=='string'||
         !/^stage_(admitted|draining|frozen|reconciled|status)$/.test(result.status))
        deny();
      return result;
    }
  });
}
export const STAGE_BINDING_READINESS=Object.freeze({
  productionIntegrated:false,
  publicUrlUsed:false,
  stagingOnly:true,
  IAMFullyVerified:false,
  productionDataSupported:false
});
