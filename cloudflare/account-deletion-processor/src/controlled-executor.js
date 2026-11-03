/**
 * Controlled deletion state machine — CANDIDATE, NOT DEPLOYED.
 *
 * The module has no credentials, HTTP entrypoint, SDK imports or provider
 * adapters. The only accepted scope is a disposable Firebase Emulator
 * account; do not connect this to production. A production operator needs
 * reviewed IAM, legal retention decisions, and durable fencing in every
 * deployed Worker BEFORE adapting this contract to live accounts.
 *
 * All side effects are delegated to independently authenticated adapters;
 * "true" returned by a test double is not proof of real-world deletion.
 */
const PROJECT='demo-atrio-v11';
const UID=/^qa-delete-[a-z0-9-]{1,60}$/;
const CASE=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CONTROLLED_DELETION_PHASES=Object.freeze([
  'freeze_writes',
  'purge_firestore',
  'purge_media_and_d1',
  'revoke_fcm',
  'verify_before_auth',
  'delete_auth_last',
  'verify_final'
]);
function deny(reason){throw Error('controlled_deletion_denied:'+reason);}
function exactTrue(value,reason){if(value!==true)deny(reason);}
function ensureBackend(b){
  const methods={
    approvals:['confirm'],ledger:['acquire','check','complete'],
    freeze:['enable','verify'],firestore:['purge','assess'],
    media:['purge','empty'],fcm:['revoke','empty'],
    auth:['remove','exists']
  };
  for(const [key,names] of Object.entries(methods))
    for(const method of names)
      if(typeof b?.[key]?.[method]!=='function')
        deny('missing_backend_'+key+'_'+method);
}
function validateCheckpoint(value){
  if(!value || !Number.isSafeInteger(value.epoch) || value.epoch<1 ||
     !Array.isArray(value.completed) ||
     value.completed.length>CONTROLLED_DELETION_PHASES.length)
    deny('invalid_checkpoint');
  for(let i=0;i<value.completed.length;i++)
    if(value.completed[i]!==CONTROLLED_DELETION_PHASES[i])
      deny('non_prefix_or_duplicate_checkpoint');
  return value;
}
function isEmptyReport(r){
  return r && Object.getPrototypeOf(r)===Object.prototype &&
    r.allKnownScopesScanned===true &&
    r.foreignReferencesResolved===true &&
    r.retentionAdjudicated===true &&
    r.remaining===0 && r.unknownScopes===0;
}
/**
 * Adapter contracts:
 *  approvals.confirm({uid,caseId}) must confirm authenticated, independently
 *    authorized decisions bound to the ORIGINAL immutable request and case.
 *  ledger.acquire/check/complete must be durable, per UID and fenced by epoch.
 *  freeze.verify must attest ALL currently deployed privileged write paths,
 *    not merely a Firestore marker.
 *  firestore.assess must freshly scan all owned AND foreign references and
 *    adjudicate moderation/retention, without trusting the deletion journal.
 *  media.empty and fcm.empty must independently verify provider state.
 *  auth.remove is only ever called after those independent verifications.
 *
 * Neither this contract nor passing fixtures proves such adapters exist.
 */
export function createControlledQaDeletionExecutor({projectId,backend}={}){
  if(projectId!==PROJECT)deny('not_disposable_project');
  ensureBackend(backend);
  return Object.freeze({
    async run({uid,caseId}={}){
      if(typeof uid!=='string'||!UID.test(uid) ||
         typeof caseId!=='string'||!CASE.test(caseId))
        deny('invalid_qa_case');
      const ctx=Object.freeze({uid,caseId});
      // No account mutation is attempted without a fresh admission.
      exactTrue(await backend.approvals.confirm(ctx),'approval_missing');
      const lease=validateCheckpoint(await backend.ledger.acquire(ctx));
      const fenced=Object.freeze({...ctx,epoch:lease.epoch});
      const authorize=async()=>{
        exactTrue(await backend.ledger.check(fenced),'stale_lease');
        exactTrue(await backend.approvals.confirm(ctx),'approval_revoked');
      };
      const freezeIsActive=async()=>{
        exactTrue(await backend.freeze.verify(fenced),
          'distributed_freeze_unverified');
      };
      const clean=async()=>{
        await freezeIsActive();
        if(!isEmptyReport(await backend.firestore.assess(fenced)))
          deny('firestore_residual_or_unknown');
        exactTrue(await backend.media.empty(fenced),'media_residual_or_unknown');
        exactTrue(await backend.fcm.empty(fenced),'fcm_residual_or_unknown');
        await authorize();
      };
      const actions={
        freeze_writes:async()=>backend.freeze.enable(fenced),
        purge_firestore:async()=>backend.firestore.purge(fenced),
        purge_media_and_d1:async()=>backend.media.purge(fenced),
        revoke_fcm:async()=>backend.fcm.revoke(fenced),
        verify_before_auth:async()=>{},
        delete_auth_last:async()=>{
          // The original gate must remain in effect, including on retries
          // where a previous remote Auth deletion timed out after succeeding.
          await clean();
          const existingAuth=await backend.auth.exists(fenced);
          if(existingAuth===true){
            await authorize();
            await freezeIsActive();
            await backend.auth.remove(fenced);
          }else if(existingAuth!==false){
            deny('auth_presence_unknown');
          }
        },
        verify_final:async()=>{}
      };
      const verify=async phase=>{
        switch(phase){
          case 'freeze_writes':
            return await backend.freeze.verify(fenced)===true;
          case 'purge_firestore':
            return isEmptyReport(await backend.firestore.assess(fenced))===true;
          case 'purge_media_and_d1':
            return await backend.media.empty(fenced)===true;
          case 'revoke_fcm':
            return await backend.fcm.empty(fenced)===true;
          case 'verify_before_auth':
            await clean();return true;
          case 'delete_auth_last':
          case 'verify_final':
            await clean();return await backend.auth.exists(fenced)===false;
          default:deny('unknown_phase');
        }
      };
      for(let i=0;i<CONTROLLED_DELETION_PHASES.length;i++){
        const phase=CONTROLLED_DELETION_PHASES[i];
        await authorize();
        // The persisted checkpoint is not a substitute for a current fence.
        if(i>0)await freezeIsActive();
        if(i<lease.completed.length){
          exactTrue(await verify(phase),'completed_phase_no_longer_valid');
          continue;
        }
        // On an explicitly reviewed recovery (epoch > 1), the preceding
        // remote operation may have committed but its checkpoint may have
        // been lost. FIRST independently verify the phase; a confirmed
        // effect must not be repeated. This never applies on first acquire,
        // and a false/unknown readback is not accepted as completion.
        // Each adapter must provide genuinely independent provider evidence.
        if(lease.epoch>1 && await verify(phase)===true){
          await authorize();
          exactTrue(await backend.ledger.complete({...fenced,phase}),
            'checkpoint_not_committed');
          continue;
        }
        // Re-check after any previous asynchronous read and before side
        // effects. Every adapter must enforce its own fence too.
        await authorize();
        await actions[phase]();
        await authorize();
        exactTrue(await verify(phase),'phase_not_reconciled');
        await authorize();
        exactTrue(await backend.ledger.complete({...fenced,phase}),
          'checkpoint_not_committed');
      }
      return Object.freeze({
        state:'isolated_qa_deletion_reconciled',
        completed:CONTROLLED_DELETION_PHASES.length,
        productionAuthorized:false,
        externalProvidersHomologated:false,
        googlePlayAuthorized:false
      });
    }
  });
}
