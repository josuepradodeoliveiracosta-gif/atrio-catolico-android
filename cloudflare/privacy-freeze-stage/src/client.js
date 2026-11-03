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
  finalize:'/v1/finalize',close:'/v1/close',status:'/v1/status',
  caseOpen:'/v1/case/open',caseStatus:'/v1/case/status',
  caseAttest:'/v1/case/attest',caseAdvance:'/v1/case/advance',
  canary:'/v1/canary'
});
const deny=()=>{throw Error('qa_stage_client_denied');};
function validate(role,op,payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))deny();
  const keys=Object.keys(payload).sort().join(',');
  if(op==='canary'){
    const expected=role==='avatar'?'qa-freeze-alice':
      role==='guardian'?'qa-freeze-bob':
      role==='push'?'qa-freeze-alice':null;
    if(!expected||keys!=='runId,uid'||
       payload.uid!==expected||payload.runId!=='qa-hosted-20261103-a')deny();
  }else if(op==='admit'){
    if(!['avatar','guardian','push'].includes(role))deny();
    // Only two synthetic UIDs can be part of a broadcast QA admission.
    const broadcast=role==='push'&&keys==='actorUid,recipientUids';
    if(broadcast) {
      const members=payload.recipientUids;
      if(!stageFixtureUid(payload.actorUid)||!Array.isArray(members)||
         members.length!==1||!stageFixtureUid(members[0])||
         members[0]===payload.actorUid)deny();
    }else{
      const required=role==='push'?'actorUid,recipientUid':'ownerUid';
      if(keys!==required||Object.values(payload).some(v=>!stageFixtureUid(v))||
         (role==='push'&&payload.actorUid===payload.recipientUid))deny();
    }
  }else if(['drain','finalize','status'].includes(op)){
    if(role!=='admin'||keys!=='uid'||!stageFixtureUid(payload.uid))deny();
  }else if(op==='close'){
    if(role!=='reconciler'||keys!=='fixtureEvidence,operationId'||
       payload.fixtureEvidence!=='demo-confirmed'||
       typeof payload.operationId!=='string'||
       !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.operationId))
      deny();
  }else if(op==='caseOpen'||op==='caseStatus'){
    if(role!=='admin'||keys!=='caseId,uid'||
       !stageFixtureUid(payload.uid)||!stageNonceOk(payload.caseId))deny();
  }else if(op==='caseAttest'){
    if(!['avatar','guardian','push','reconciler'].includes(role)||
       keys!=='caseId,fixtureEvidence,phase,uid'||
       !stageFixtureUid(payload.uid)||!stageNonceOk(payload.caseId)||
       !['firestore_reconciled','avatar_d1_reconciled','fcm_reconciled',
          'before_auth_verified','auth_emulator_deleted','final_qa_verified']
         .includes(payload.phase)||
       payload.fixtureEvidence!=='qa-synthetic-only-reviewed')deny();
  }else if(op==='caseAdvance'){
    if(role!=='reconciler'||
       keys!=='caseId,expectedStep,fixtureEvidence,uid'||
       !stageFixtureUid(payload.uid)||!stageNonceOk(payload.caseId)||
       !Number.isSafeInteger(payload.expectedStep)||
       payload.expectedStep<0||payload.expectedStep>5||
       payload.fixtureEvidence!=='qa-synthetic-only-reviewed')deny();
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
         !/^stage_(admitted|draining|frozen|reconciled|status|case_open|case_status|case_attested|case_advanced|canary_completed)$/.test(result.status))
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
