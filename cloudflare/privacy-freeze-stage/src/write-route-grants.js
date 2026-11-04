/**
 * Strict, QA-only, route-specific grants for the 15 REVIEWED candidate
 * privileged write entrypoints. This grants admission to a synthetic D1
 * ticket, never permission to mutate Firebase, Cloudinary or FCM.
 *
 * Kept separate from deployed Workers; production remains NOT integrated.
 */
import {stageFixtureUid} from './protocol.js';

export const QA_STAGE_WRITE_ROUTES=Object.freeze({
  'avatar.upload':Object.freeze({role:'avatar',kind:'avatar_upload',
    keys:'ownerUid'}),
  'avatar.status':Object.freeze({role:'avatar',kind:'avatar_promote',
    keys:'ownerUid'}),
  'avatar.delete':Object.freeze({role:'avatar',kind:'avatar_remove',
    keys:'ownerUid'}),
  'avatar.moderate':Object.freeze({role:'avatar',kind:'avatar_moderation',
    keys:'actorUid,ownerUid'}),
  'avatar.moderation.review':Object.freeze({role:'avatar',
    kind:'avatar_moderation',keys:'actorUid,ownerUid'}),
  'guardian.admin.review':Object.freeze({role:'guardian',
    kind:'guardian_review_write',keys:'actorUid,ownerUid'}),
  'guardian.admin.resolve':Object.freeze({role:'guardian',
    kind:'guardian_review_write',keys:'actorUid,ownerUid'}),
  'guardian.scan':Object.freeze({role:'guardian',
    kind:'guardian_content_write',keys:'ownerUid'}),
  'push.thread.notice':Object.freeze({role:'push',
    kind:'push_thread_notice',keys:'actorUid,recipientUid'}),
  'push.event.fcm':Object.freeze({role:'push',
    kind:'push_fcm_send',keys:'actorUid,recipientUid'}),
  'push.broadcast.fcm':Object.freeze({role:'push',
    kind:'push_fcm_send',keys:'actorUid,recipientUids'}),
  'push.moderation.event':Object.freeze({role:'push',
    kind:'guardian_content_write',keys:'ownerUid'}),
  'push.moderation.review':Object.freeze({role:'push',
    kind:'guardian_review_write',keys:'actorUid,ownerUid'}),
  'push.queue.bots':Object.freeze({role:'push',
    kind:'guardian_content_write',keys:'ownerUid'}),
  'push.token.cleanup':Object.freeze({role:'push',
    kind:'push_cleanup_device',keys:'ownerUid'})
});

const plain=value=>value!==null&&typeof value==='object'&&
  !Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;

/**
 * Return null for every unknown role, path, account, extra key or malformed
 * fanout. Both client and Worker validate independently, before D1 nonce use.
 */
export function qaStageWriteGrant(role,payload){
  if(!plain(payload)||Object.keys(payload).sort().join(',')!=='route,scope'||
     typeof payload.route!=='string'||
     !Object.hasOwn(QA_STAGE_WRITE_ROUTES,payload.route)||
     !plain(payload.scope))return null;
  const grant=QA_STAGE_WRITE_ROUTES[payload.route],scope=payload.scope;
  if(grant.role!==role||Object.keys(scope).sort().join(',')!==grant.keys)
    return null;
  const uids=[];
  for(const [key,value] of Object.entries(scope)){
    if(key==='recipientUids'){
      if(!Array.isArray(value)||value.length!==1||
         !stageFixtureUid(value[0]))return null;
      uids.push(value[0]);
    }else{
      if(!['ownerUid','actorUid','recipientUid'].includes(key)||
         !stageFixtureUid(value))return null;
      uids.push(value);
    }
  }
  if(uids.length!==new Set(uids).size&&uids.length>1)return null;
  return Object.freeze({kind:grant.kind,scope:Object.freeze(
    {...scope,...(scope.recipientUids?{recipientUids:Object.freeze(
      [...scope.recipientUids])}:{})}
  )});
}
export const QA_STAGE_WRITE_COVERAGE=Object.freeze({
  knownCandidateRoutes:Object.keys(QA_STAGE_WRITE_ROUTES).length,
  stagingAdmissionOnly:true,productionIntegrated:false,
  allLiveWritePathsFenced:false,externalEffectApproval:false,
  deletionReleaseAuthorized:false
});
