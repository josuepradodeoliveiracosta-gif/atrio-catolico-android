/** Candidato QA em loopback. O integrador controla montagem, Auth e IAM. */
import {createHash} from 'node:crypto';
import {
  authenticateInboxCaller,InboxAccessDenied,inboxConfigValid,validInboxAge
} from './chat-inbox-discovery-server.mjs';
import {
  inboxMutationVersionRef,prepareInboxBlockMutation
} from './chat-inbox-maintenance.mjs';
import {
  INBOX_DISCOVERY_CONTROL,INBOX_WRITE_BOUNDARY,inboxAgePath,inboxBlockPath,inboxProjectionReady
} from './chat-inbox-peer-index.mjs';

const ROUTE=/^\/v1\/qa\/conversations\/blocks\/([A-Za-z0-9_-]{1,128})$/;
const REQUEST_KEY=/^[A-Za-z0-9_-]{16,128}$/;
const ETAG=/^"(?:initial|v-[A-Za-z0-9_-]{1,128})"$/;
const METHODS='GET, PUT, DELETE';
const RESPONSE_HEADERS={
  'Cache-Control':'private, no-store, max-age=0',
  'Pragma':'no-cache','Content-Type':'application/json; charset=utf-8'
};
function response(status,body,headers={}) {
  return new Response(JSON.stringify(body),{status,headers:{...RESPONSE_HEADERS,...headers}});
}
const error=(status,code,headers)=>response(status,{error:code},headers);

async function blockState(db,{ownerUid,peerUid},command) {
  const blockRef=db.doc(inboxBlockPath(ownerUid,peerUid));
  const versionRef=inboxMutationVersionRef(db,blockRef.path);
  const refs=[
    db.doc('app_config/conversations'),db.doc(inboxAgePath(ownerUid)),
    db.doc(INBOX_DISCOVERY_CONTROL),db.doc(INBOX_WRITE_BOUNDARY),blockRef,versionRef
  ];
  const operationId=command && 'http-block-'+createHash('sha256')
    .update(JSON.stringify([ownerUid,command.requestKey])).digest('hex');
  const receiptRef=command && db.doc('serverInboxBlockRequests/'+operationId);
  if(receiptRef)refs.push(receiptRef);

  return db.runTransaction(async tx=>{
    const [cfg,age,control,boundary,ownBlock,version,receipt]=await tx.getAll(...refs);
    if(!inboxConfigValid(cfg.data())||
       !validInboxAge(age.data(),undefined,cfg.readTime.toMillis()))
      throw new InboxAccessDenied();
    if(!inboxProjectionReady(control.data(),boundary.data()))
      return {status:503,body:{error:'block_unavailable'}};
    const operationVersion=version.data()?.operationId;
    const etag=operationVersion===undefined ? '"initial"' : '"v-'+operationVersion+'"';
    if(!ETAG.test(etag))throw Error('inbox_invalid_block_version');

    const state={blocked:ownBlock.exists};
    const currentHeaders={ETag:etag};
    if(!command)return {status:200,body:state,headers:currentHeaders};

    const {expected,blocked}=command;
    const fingerprint=JSON.stringify([peerUid,blocked,expected]);
    if(receipt.exists) {
      if(receipt.get('fingerprint')!==fingerprint)
        return {status:409,body:{error:'block_operation_conflict'}};
      // A confirmação persiste, mas o estado atual pode ter mudado.
      return {status:200,headers:currentHeaders,
        body:{committed:true,replayed:true,requestedBlocked:blocked,...state}};
    }
    if(expected!==etag)return {status:409,body:{error:'block_state_changed'}};

    if(blocked!==ownBlock.exists) {
      const apply=await prepareInboxBlockMutation(db,tx,{
        ownerUid,peerUid,blocked,createdAt:cfg.readTime
      });
      apply();
    }
    tx.set(versionRef,{operationId});
    tx.create(receiptRef,{fingerprint});
    return {
      status:200,headers:{ETag:'"v-'+operationId+'"'},
      body:{committed:true,replayed:false,requestedBlocked:blocked,blocked}
    };
  },command ? {} : {readOnly:true});
}

/** O host QA fornece verifyIdToken vinculado ao Firebase Admin Auth de QA. */
export function createInboxBlockHttpHandler({db,verifyIdToken,enabled=false}={}) {
  if(typeof db?.doc!=='function'||typeof db?.runTransaction!=='function'||
     typeof verifyIdToken!=='function')throw Error('inbox_block_http_not_configured');
  return async request=>{
    if(enabled!==true)return error(503,'inbox_closed');
    let url;
    try{url=new URL(request?.url);}
    catch{return error(400,'invalid_request');}
    const peerUid=url.pathname.match(ROUTE)?.[1];
    if(!peerUid||url.search||request.body!==null)return error(400,'invalid_request');
    const method=request.method;
    if(method!=='GET'&&method!=='PUT'&&method!=='DELETE')
      return error(405,'method_not_allowed',{Allow:METHODS});
    const auth=request.headers.get('authorization')||'';
    if(!/^Bearer \S{1,8192}$/.test(auth))return error(403,'forbidden');
    let command=null;
    if(method!=='GET'){
      const requestKey=request.headers.get('idempotency-key');
      const expected=request.headers.get('if-match');
      if(!REQUEST_KEY.test(requestKey??'')||!ETAG.test(expected??''))
        return error(400,'invalid_request');
      command={requestKey,expected,blocked:method==='PUT'};
    }
    try{
      const ownerUid=await authenticateInboxCaller(verifyIdToken,auth.slice(7));
      if(ownerUid===peerUid)return error(400,'invalid_request');
      const result=await blockState(db,{ownerUid,peerUid},command);
      return response(result.status,result.body,result.headers);
    }catch(cause){
      if(cause instanceof InboxAccessDenied)return error(403,'forbidden');
      return error(503,'block_unavailable');
    }
  };
}
