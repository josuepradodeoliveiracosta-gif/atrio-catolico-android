/**
 * Plano de exclusão NÃO DESTRUTIVO, somente para fixtures no emulador.
 * NÃO importa serviço de produção, Admin SDK, chaves nem Cloudinary.
 * Cada exclusão real precisa de backend com identidade própria,
 * execução idempotente, retenção legal e revisão humana.
 */
const UID=/^[A-Za-z0-9_-]{1,128}$/;
const DEMO='demo-atrio-v11';

export function planDeletionReview({projectId,uid,request}) {
  if(projectId!==DEMO)throw Error('qa_only_no_production_access');
  if(typeof uid!=='string'||!UID.test(uid))throw Error('invalid_uid');
  if(!request||request.uid!==uid||request.status!=='requested'||
     !['android','web'].includes(request.source)||
     typeof request.requestedAt!=='string'||!Number.isFinite(Date.parse(request.requestedAt)))
    throw Error('unverified_request');
  const direct=[
    'profiles/'+uid,'public_profiles/'+uid,'profile_photos/'+uid,
    'badges/'+uid,'badge_requests/'+uid,'users/'+uid
  ];
  const nested=['likedPosts','savedPosts','followedPosts','pushDevices','notifications']
    .map(x=>'users/'+uid+'/'+x+'/*');
  return Object.freeze({
    projectId:DEMO,uid,mode:'DRY_RUN_ONLY',deletionAuthorized:false,
    accountAuth:'REVIEW_LAST_AFTER_ALL_OTHER_DATA',
    directDocuments:direct,
    nestedCollections:nested,
    ownerQueries:['posts (field uid)','posts/*/replies (collection group uid)',
      'reactions, reports and guardian records (review cross-account references)'],
    externalServices:['Cloudinary original and pending avatars','FCM device tokens'],
    safetyHolds:['verify ownership independently','review community content and retention',
      'enumerate every nested Firestore collection','export approved audit trail',
      'approve retries and idempotency','sign off on founder/admin account handling'],
    firestoreWrites:0,identityDeletes:0,cloudinaryDeletes:0
  });
}
