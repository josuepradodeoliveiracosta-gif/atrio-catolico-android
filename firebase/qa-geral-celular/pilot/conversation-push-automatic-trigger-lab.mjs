// Adapter for Firebase v2 onDocumentCreated event shape; laboratory ONLY.
// No exported cloud function, registration, network or deployment configuration.
import {AUTO_CHAT} from './conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from './conversation-push-policy.mjs';
const DEMO='demo-atrio-v11';
const CREATED='google.cloud.firestore.document.v1.created';
export const LAB_DOCUMENT='chats/'+AUTO_CHAT+'/messages/{messageId}';
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const stamp=t=>Number.isSafeInteger(t?.seconds)&&t.seconds>0&&
 Number.isInteger(t.nanoseconds)&&t.nanoseconds>=0&&t.nanoseconds<1e9;
const ignore=reason=>({status:'ignored',reason});

export function createAutomaticTriggerLab({enabled=false,service}={}){
 if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||
     !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST??'')||
     process.env.GCLOUD_PROJECT!==DEMO)throw Error('automatic_trigger_emulator_only');
 if(enabled===true&&typeof service?.handle!=='function')throw Error('missing_lab_service');
 return async event=>{
  if(enabled!==true)return ignore('automation_disabled');
  const id=event?.params?.messageId;
  if(event?.type!==CREATED||event.project!==DEMO||event.database!==identity.databaseId||
     !validId(id)||typeof event.id!=='string'||event.id.length===0||event.id.length>256)
    return ignore('invalid_trigger_event');
  const path='chats/'+AUTO_CHAT+'/messages/'+id;
  if(event.document!==path||event.data?.ref?.path!==path||!stamp(event.data?.createTime))
    return ignore('invalid_trigger_document');
  // Never use event.data.data(), sender, recipient or content. The canonical
  // Firestore transaction rereads the document and binds its exact creation.
  return service.handle({type:'created',projectId:identity.projectId,databaseId:identity.databaseId,
   chatId:AUTO_CHAT,messageId:id,expectedCreateTime:{
    seconds:event.data.createTime.seconds,nanoseconds:event.data.createTime.nanoseconds}});
 };
}
