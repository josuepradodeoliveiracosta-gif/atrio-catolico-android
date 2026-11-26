// Read-only canonical authorization adapter, laboratory only.
// No default fetch, credentials, deployment or caller-controlled URLs.
import {createFreeSnapshotLab} from './qa-automatic-free-snapshot-lab.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
import {AUTO_CHAT} from '../../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
const root='https://firestore.googleapis.com/v1/projects/'+identity.projectId+'/databases/'+identity.databaseId+'/documents';
const token=x=>typeof x==='string'&&/^[A-Za-z0-9+/=_-]{1,4096}$/.test(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const key=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const fail=()=>{throw Error('d1_read_authorization_unavailable')};
const uids=Object.keys(identity.accounts);
export function createD1ReadAuthorizationLab({transport,lookupAccounts}={}){
 if(typeof transport!=='function'||typeof lookupAccounts!=='function')fail();
 return async function readAuthorization({event,eventKey}={}){
  if(event?.projectId!==identity.projectId||event.databaseId!==identity.databaseId||
     event.chatId!==AUTO_CHAT||event.type!=='created'||!id(event.messageId)||!key(eventKey))fail();
  let calls=0,authCalls=0,transaction;
  const invoke=async req=>{
   if(++calls>5||req.method!=='POST'||req.redirect!=='error')fail();
   const suffix=req.url.startsWith(root)?req.url.slice(root.length):'';
   if(![':beginTransaction',':rollback',':batchGet',...uids.map(u=>'/users/'+u+':runQuery')].includes(suffix))fail();
   if(suffix===':beginTransaction'){
    if(JSON.stringify(req.body)!=='{"options":{"readOnly":{}}}')fail();
   }else if(!transaction||req.body?.transaction!==transaction)fail();
   return transport(req);
  };
  const begin=await invoke({url:root+':beginTransaction',method:'POST',redirect:'error',body:{options:{readOnly:{}}}});
  if(begin?.status!==200||!token(begin.body?.transaction))fail();
  transaction=begin.body.transaction;
  let snapshot;
  try{
   snapshot=await createFreeSnapshotLab({transport:invoke,lookupAccounts:async requested=>{
    if(++authCalls!==1||requested.length!==uids.length||!uids.every(u=>requested.includes(u)))fail();
    return lookupAccounts(requested);
   }})({transaction,event,eventKey});
   // Never mix the previous experimental Firestore outbox with D1.
   if(snapshot.transaction!==transaction||snapshot.outbox!==null||snapshot.retry!==null)fail();
  }finally{
   const closed=await invoke({url:root+':rollback',method:'POST',redirect:'error',body:{transaction}});
   if(closed?.status!==200)fail();
  }
  return {creation:snapshot.creation,now:snapshot.now,snapshot:snapshot.snapshot};
 };
}
