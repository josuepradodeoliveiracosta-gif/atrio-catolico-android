// Pure discovery contract for a future Workers Free cron. Not a route or a
// scheduled handler. No network, credentials, writes, timer, or deployment.
const project='atrio-catolico-qa-general';
const chat='qa-nav-alice__qa-nav-bob';
const path='chats/'+chat;
const ids=new Set(['qa-nav-alice','qa-nav-bob']);
const time=v=>Number.isSafeInteger(v)&&v>0;
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const stamp=v=>Number.isSafeInteger(v?.seconds)&&v.seconds>0&&
 Number.isInteger(v.nanoseconds)&&v.nanoseconds>=0&&v.nanoseconds<1e9;
const ms=v=>v.seconds*1000+Math.floor(v.nanoseconds/1e6);
const stop=reason=>({status:'ignored',reason});

// Inputs must come from a trusted server-side REST adapter, not HTTP callers.
// Activation fence is persisted and set at activation, never at cold start.
// Room and message are hints only; publication must reread both transactionally.
export function discoverFreeCandidate({enabled=false,projectId,databaseId,activatedAt,readTime,room,message}={}){
 if(enabled!==true)return stop('automation_disabled');
 if(projectId!==project||databaseId!=='(default)'||!time(activatedAt)||
    !time(readTime)||activatedAt>readTime)return stop('invalid_environment');
 if(room?.path!==path||room.status!=='accepted'||!validId(room.lastMessageId)||
    !ids.has(room.lastSenderUid)||!Array.isArray(room.participants)||
    room.participants.length!==2||!room.participants.every(uid=>ids.has(uid))||
    new Set(room.participants).size!==2||!ids.has(room.requesterUid)||
    !ids.has(room.recipientUid)||room.requesterUid===room.recipientUid)
  return stop('invalid_room');
 const unread=room.lastSenderUid===room.requesterUid?room.unreadRecipient:room.unreadRequester;
 if(!Number.isSafeInteger(unread)||unread<=0)return stop('no_unread_message');
 if(message?.path!==path+'/messages/'+room.lastMessageId||message.uid!==room.lastSenderUid||
    !['text','post'].includes(message.kind)||Object.hasOwn(message,'deletedForAll')||
    !stamp(message.createTime)||!time(message.createdAt))
  return stop('invalid_message');
 const created=ms(message.createTime);
 if(!time(created)||created<=activatedAt||message.createdAt<=activatedAt||
    created>readTime||message.createdAt>readTime)
  return stop('outside_activation_window');
 const deadline=Math.min(created,message.createdAt)+120000;
 if(deadline-readTime<10000)return stop('insufficient_original_window');
 return {status:'candidate',event:{type:'created',projectId,databaseId,chatId:chat,
  messageId:room.lastMessageId,expectedCreateTime:{seconds:message.createTime.seconds,
   nanoseconds:message.createTime.nanoseconds}},deadline};
}
