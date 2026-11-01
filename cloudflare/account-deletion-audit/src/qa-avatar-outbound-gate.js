/**
 * QA ONLY. Intercept the unchanged Avatar Worker fetch() calls during a
 * privileged mutation, using an EXPLICIT, injected fake transport.
 *
 * No live Worker imports this module. Production Firebase / Cloudinary / IAM
 * endpoints are not contacted: only a synthetic account and fake QA
 * configuration can reach the supplied fake transport.
 */
const ACCOUNTS=new Set(['qa-freeze-alice','qa-freeze-bob']);
const FIRESTORE='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents/';
const CLOUD='https://api.cloudinary.com/v1_1/qa-cloud/';
const LOOKUP='https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=qa-fake-web-key';
const ID=/^atrio-avatares\/(qa-freeze-alice|qa-freeze-bob)\/[a-f0-9-]{36}$/;
let intercepting=false;
const deny=why=>{throw Error('qa_avatar_outbound_'+why);};
const owned=(id,owner)=>typeof id==='string' && ID.test(id) &&
  id.startsWith('atrio-avatares/'+owner+'/');
const form=(body)=>body instanceof FormData?body:null;
function assertCloudinary(url,init,owner){
  const relative=url.slice(CLOUD.length);
  const method=init?.method||'GET';
  const body=form(init?.body);
  if(relative.startsWith('image/')){
    if(method!=='POST'||!body)deny('unexpected_cloudinary_action');
    const action=relative.slice('image/'.length);
    const main=action==='rename'?body.get('from_public_id'):
      body.get('public_id');
    if(!owned(main,owner))deny('cross_account_media');
    if(action==='authenticated'||action==='upload'){
      if(body.get('overwrite')!=='false'||body.get('moderation')!=='manual'||
         (action==='upload'&&body.get('type')!=='authenticated'))
        deny('unapproved_upload');
    }else if(action==='rename'){
      if(body.get('to_public_id')!==main ||
         body.get('type')!=='authenticated'||
         body.get('to_type')!=='upload'||body.get('overwrite')!=='false')
        deny('unapproved_rename');
    }else if(action==='destroy'){
      if(!['upload','authenticated'].includes(body.get('type'))||
         body.get('invalidate')!=='true')deny('unapproved_destroy');
    }else deny('unreviewed_cloudinary_action');
    // Signed requests originate from the genuine Worker helper; the fake
    // transport never sends signatures or secrets across the network.
    if(!body.get('signature')||!body.get('timestamp')||
       body.get('api_key')!=='fake-key')deny('unsigned_qa_request');
    return action;
  }
  const match=/^resources\/image\/(authenticated|upload)\/(atrio-avatares\/[^?#]+)$/.exec(relative);
  if(!match||!owned(match[2],owner))deny('cross_account_media');
  if(method==='GET'&&!init?.body)return 'media_read';
  if(method==='POST'&&match[1]==='authenticated' &&
     init?.body instanceof URLSearchParams &&
     ['approved','rejected'].includes(init.body.get('moderation_status')))
    return 'media_moderation';
  deny('unapproved_media_method');
}
function assertFirestore(url,init,scope){
  const path=url.slice(FIRESTORE.length);
  const method=init?.method||'GET';
  if(path==='admins/'+scope.actorUid &&
     scope.actorUid!==scope.ownerUid && method==='GET'&&!init?.body)
    return 'moderator_read';
  if(path!=='profile_photos/'+scope.ownerUid)
    deny('cross_account_firestore');
  if(method==='GET'&&!init?.body)return 'photo_read';
  if(method==='DELETE'&&!init?.body)return 'photo_remove';
  if(method==='PATCH'){
    let fields;
    try{fields=JSON.parse(init.body).fields;}catch{deny('invalid_firestore_payload');}
    if(!fields||Object.keys(fields).sort().join(',')!==
      'photoPublicId,photoUpdatedAt,photoUrl')deny('invalid_firestore_payload');
    const id=fields.photoPublicId?.stringValue;
    const urlValue=fields.photoUrl?.stringValue;
    const stamp=fields.photoUpdatedAt?.timestampValue;
    if(!owned(id,scope.ownerUid) ||
       typeof urlValue!=='string' ||
       !urlValue.startsWith('https://res.cloudinary.com/qa-cloud/image/upload/') ||
       !urlValue.endsWith('/'+id+'.jpg') ||
       typeof stamp!=='string'||!Number.isFinite(Date.parse(stamp)))
      deny('invalid_firestore_payload');
    return 'photo_publish';
  }
  deny('unreviewed_firestore_method');
}
export function inspectQaAvatarOutbound(url,init,scope){
  const owner=scope?.ownerUid,actor=scope?.actorUid??owner;
  if(!ACCOUNTS.has(owner)||!ACCOUNTS.has(actor))
    deny('unlisted_identity');
  if(typeof url!=='string')deny('invalid_url');
  if(url===LOOKUP){
    if(init?.method!=='POST')deny('invalid_auth_request');
    let body;
    try{body=JSON.parse(init.body);}catch{deny('invalid_auth_request');}
    if(typeof body?.idToken!=='string'||body.idToken.length<100||
       body.idToken.length>5000)deny('invalid_auth_request');
    return 'firebase_auth_lookup';
  }
  if(url.startsWith(FIRESTORE))return assertFirestore(url,init,{ownerUid:owner,actorUid:actor});
  if(url.startsWith(CLOUD))return assertCloudinary(url,init,owner);
  // Never reach google OAuth, another cloud, or a real network destination.
  deny('unapproved_network_destination');
}
function qaEnvironment(env){
  return env?.CLOUDINARY_CLOUD_NAME==='qa-cloud' &&
    env?.CLOUDINARY_API_KEY==='fake-key' &&
    env?.CLOUDINARY_API_SECRET==='fake-secret' &&
    env?.FIREBASE_WEB_API_KEY==='qa-fake-web-key' &&
    env?.FIREBASE_SERVICE_ACCOUNT_JSON==='{}' &&
    !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    !process.env.CLOUDINARY_API_SECRET &&
    !process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED;
}
export async function withQaAvatarOutboundGate({env,scope,transport,run}={}){
  if(!qaEnvironment(env))deny('unsafe_environment');
  if(typeof transport!=='function'||typeof run!=='function')
    deny('missing_mock_transport');
  if(intercepting)deny('concurrent_interception');
  intercepting=true;
  const prior=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    inspectQaAvatarOutbound(String(url),init,scope);
    return transport(url,init);
  };
  try{return await run();}
  finally{
    globalThis.fetch=prior;
    intercepting=false;
  }
}
export const QA_AVATAR_OUTBOUND_READINESS=Object.freeze({
  productionIntegrated:false,
  fakeTransportOnly:true,
  ownerBoundRemoteWritesInQa:true
});
