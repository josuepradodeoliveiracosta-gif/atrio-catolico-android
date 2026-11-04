/**
 * QA ONLY: read-only adapter to the private, HMAC-authenticated Cloudflare
 * Service Binding/D1 fixture. This checks one *same synthetic UID* and case,
 * and implements freeze.verify/drained readbacks (NOT freeze.enable).
 *
 * Never pair a qa-freeze-* identity with a qa-delete-* Firebase identity:
 * the Stage and Firebase Emulator fixtures are separate trust domains.
 * Not sufficient for production provider-drain or deletion authorization.
 */
import {STAGE_ID,stageFixtureUid,stageNonceOk} from './protocol.js';
const deny=why=>{throw Error('qa_stage_fence_readback_denied:'+why);};
const plain=o=>o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.getPrototypeOf(o)===Object.prototype;
export function createQaStageFreezeReadback({projectId,client,uid,caseId}={}){
  if(projectId!==STAGE_ID||!stageFixtureUid(uid)||
     !stageNonceOk(caseId)||typeof client?.request!=='function')
    deny('invalid_fixture_configuration');
  const check=ctx=>{
    if(!plain(ctx)||Object.keys(ctx).sort().join(',')!=='caseId,epoch,uid'||
       ctx.uid!==uid||ctx.caseId!==caseId||ctx.epoch!==1)
      deny('case_or_epoch_mismatch');
  };
  const snapshot=async ctx=>{
    check(ctx);
    let before,caseInfo,after;
    try{
      // Two independent status readbacks around the case lookup. In the
      // fixture protocol a frozen state is irreversible, not an active lease.
      before=await client.request('status',{uid});
      caseInfo=await client.request('caseStatus',{uid,caseId});
      after=await client.request('status',{uid});
    }catch{deny('coordinator_unavailable_or_unverified');}
    if(!plain(before)||!plain(after)||!plain(caseInfo)||
       before.status!=='stage_status'||after.status!=='stage_status'||
       before.uid!==uid||after.uid!==uid||
       caseInfo.status!=='stage_case_status'||
       caseInfo.uid!==uid||caseInfo.caseId!==caseId||
       caseInfo.generation!==1||caseInfo.productionReady!==false||
       caseInfo.accountDeleted!==false||
       !['qa_fixture_pending','qa_fixture_complete'].includes(caseInfo.caseState)||
       !['active','draining','frozen'].includes(before.state)||
       before.state!==after.state||
       !Number.isSafeInteger(before.inFlight)||before.inFlight<0||
       before.inFlight!==after.inFlight)
      deny('inconsistent_case_or_drain');
    if(before.state==='frozen'&&before.inFlight!==0)
      deny('frozen_with_unsettled_operations');
    return Object.freeze({
      frozen:before.state==='frozen',drained:before.inFlight===0
    });
  };
  return Object.freeze({
    verify:async ctx=>(await snapshot(ctx)).frozen,
    drained:async ctx=>{
      const result=await snapshot(ctx);
      return result.frozen&&result.drained;
    },
    productionReady:false,
    destructiveOperationsAllowed:false
  });
}
