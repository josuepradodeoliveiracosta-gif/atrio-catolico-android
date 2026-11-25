// Variante em memória sobre o Worker de Conversas da #358, para a prova #199.
// O gerador, banco e flags do candidato histórico continuam separados.
import {renderQaWorker} from './chat-qa-build.mjs';
import {conversationPushIdentity as identity}
  from '../../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';

function replaceOnce(content, anchor, replacement) {
  if (content.split(anchor).length !== 2) throw Error('chat_push_pilot_anchor_changed');
  return content.replace(anchor, () => replacement);
}

const pilotChecks = `
const qaPilot = ${JSON.stringify(identity)};
const qaPilotAccountValid = account => !!account && account.disabled !== true
  && Object.hasOwn(qaPilot.accounts, account.localId)
  && account.emailVerified === true && account.email === qaPilot.accounts[account.localId];
const qaPilotFuture = field => typeof field?.timestampValue === 'string'
  && Date.parse(field.timestampValue) > Date.now();

// Firestore represents an explicit null with nullValue; missing fields remain closed.
const qaPilotContinuousOrFuture = field => field?.nullValue === null || qaPilotFuture(field);

function qaPilotTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  const parts = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:[.]([0-9]{1,9}))?Z$/.exec(value);
  return parts ? parts[1]+'.'+(parts[2] ?? '').padEnd(9,'0')+'Z' : null;
}

function qaPilotAdmitted(admission, eligibility, uid) {
  const generation = stringField(admission,'generation');
  const admittedAt = timeField(admission,'admittedAt');
  const grantTime = qaPilotTimestamp(admission?.fields?.admittedAt?.timestampValue);
  const eligibilityTime = qaPilotTimestamp(eligibility?.updateTime);
  // Uma versão de elegibilidade posterior exige nova concessão explícita de push.
  // updateTime é metadado do Firestore, com precisão superior a Date em JavaScript.
  return typeof generation === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(generation)
    && admittedAt > 0 && admittedAt <= Date.now()
    && grantTime !== null && eligibilityTime !== null && eligibilityTime < grantTime
    && stringField(admission,'status') === 'active'
    && stringField(admission,'roundId') === qaPilot.roundId
    && qaPilotContinuousOrFuture(admission?.fields?.expiresAt)
    && stringField(admission,'email') === qaPilot.accounts[uid];
}

async function qaPilotAccountsValid(token, sender, recipient) {
  const response = await qaNoRedirectFetch(
    'https://identitytoolkit.googleapis.com/v1/projects/'+PROJECT+'/accounts:lookup', {
      method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({localId:[sender,recipient]})
    });
  if (!response.ok) return false;
  const {users} = await response.json();
  return Array.isArray(users) && users.length === 2 &&
    new Set(users.map(account => account?.localId)).size === 2 &&
    users.every(account => qaPilotAccountValid(account)
      && (account.localId===sender || account.localId===recipient));
}

async function qaPilotAllowsNotice(token, sender, recipient, event) {
  if (!Object.hasOwn(qaPilot.accounts,sender) || !Object.hasOwn(qaPilot.accounts,recipient) ||
      sender===recipient || event.kind!=='chat_message' || !uidPart(event.chatId) ||
      !uidPart(event.messageId)) return false;
  try {
    const [settings,from,to,fromEligibility,toEligibility,pending,room,mute,message] = await qaReadAuthorizationDocs(token,[
      'app_config/conversations',
      'users/'+enc(sender)+'/chatPushAdmission/current',
      'users/'+enc(recipient)+'/chatPushAdmission/current',
      'users/'+enc(sender)+'/chatAgeEligibility/current',
      'users/'+enc(recipient)+'/chatAgeEligibility/current',
      'users/'+enc(recipient)+'/chatPushPending/current',
      'chats/'+enc(event.chatId),
      'users/'+enc(recipient)+'/chatBox/'+enc(event.chatId),
      'chats/'+enc(event.chatId)+'/messages/'+enc(event.messageId)
    ]);
    const round = settings?.fields?.pushPilot?.mapValue;
    if (!boolField(round,'enabled') || stringField(round,'projectId')!==PROJECT
        || stringField(round,'databaseId')!==qaPilot.databaseId
        || stringField(round,'ageMode')!==qaPilot.ageMode
        || stringField(round,'roundId')!==qaPilot.roundId
        || !qaPilotContinuousOrFuture(round?.fields?.expiresAt)
        || !qaPilotAdmitted(from,fromEligibility,sender)
        || !qaPilotAdmitted(to,toEligibility,recipient)) return false;
    const allowedFields=['kind','conversationId','messageId','senderUid','unread','roundId','expiresAt',
      'senderGeneration','recipientGeneration'];
    if (Object.keys(pending?.fields ?? {}).some(field=>!allowedFields.includes(field))
        || stringField(pending,'kind')!=='chat_message' || !boolField(pending,'unread')
        || stringField(pending,'roundId')!==qaPilot.roundId
        || stringField(pending,'conversationId')!==event.chatId
        || stringField(pending,'messageId')!==event.messageId
        || stringField(pending,'senderUid')!==sender
        || stringField(pending,'senderGeneration')!==stringField(from,'generation')
        || stringField(pending,'recipientGeneration')!==stringField(to,'generation')
        || !qaPilotFuture(pending?.fields?.expiresAt)) return false;
    // Um aviso regravado com gerações novas ainda precisa apontar para uma mensagem nova.
    const createdAt=timeField(message,'createdAt');
    if (createdAt<=timeField(from,'admittedAt') || createdAt<=timeField(to,'admittedAt')
        || Object.hasOwn(message?.fields ?? {},'deletedForAll')) return false;
    const muted=mute?.fields?.muted;
    if (muted!==undefined && muted.booleanValue!==false) return false;
    if (stringField(room,'status')!=='accepted'
        || stringField(room,'lastMessageId')!==event.messageId
        || stringField(room,'lastSenderUid')!==sender) return false;
    const participants=room?.fields?.participants?.arrayValue?.values;
    if (!Array.isArray(participants) || participants.length!==2 ||
        !participants.some(item=>item?.stringValue===sender) ||
        !participants.some(item=>item?.stringValue===recipient)) return false;
    const requester=stringField(room,'requesterUid');
    const receiver=stringField(room,'recipientUid');
    const recipientIsRequester=requester===recipient && receiver===sender;
    if (!recipientIsRequester && !(requester===sender && receiver===recipient)) return false;
    const unread=room?.fields?.[recipientIsRequester ? 'unreadRequester' : 'unreadRecipient']?.integerValue;
    return typeof unread==='string' && /^[1-9][0-9]*$/.test(unread) &&
      await qaPilotAccountsValid(token,sender,recipient);
  } catch { return false; }
}
async function qaConversationNoticeAllowed(token, sender, recipient, event, agePolicy) {
  return await qaChatPushPreSendAllowed(token,sender,recipient,null,agePolicy)
    && await qaChatPolicyPreSendAllowed(token,sender,recipient,event)
    && await qaChatMessagePreSendAllowed(token,sender,event)
    && await qaPilotAllowsNotice(token,sender,recipient,event);
}

async function qaLogFcmSendResponse(status, messageId) {
  try {
    let hash = 'missing';
    if (messageId && !messageId.includes('/')) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(messageId));
      hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    console.info({
      event: 'fcm_send_response',
      utc: new Date().toISOString(),
      fcm_http_status: status,
      fcm_message_id_sha256: hash,
    });
  } catch {
    // A coleta de diagnóstico não muda o resultado nem a reserva de envio.
  }
}

// O UID vem da sessão autenticada. O cliente não escolhe o aviso nem o destino.
async function qaReadConversationNotice(request, env, configured) {
  if (env.PUSH_ENABLED!=='true') return response(503,'disabled');
  if (!configured) return response(503,'not_configured');
  let stage='notice_auth';
  try {
    const recipient=await verifyIdentity(request,env,PROJECT);
    if (!recipient) return response(401,'unauthorized');
    stage='notice_oauth';
    const token=await oauth(env,PROJECT);
    stage='notice_firestore';
    const pending=await firestoreGet(token,'users/'+enc(recipient)+'/chatPushPending/current');
    const sender=stringField(pending,'senderUid');
    const event={
      kind:stringField(pending,'kind'),
      chatId:stringField(pending,'conversationId'),
      messageId:stringField(pending,'messageId'),
    };
    if (!await qaConversationNoticeAllowed(token,sender,recipient,event,env.ATRIO_QA_AGE_POLICY))
      return response(404,'no_notice');
    return Response.json({conversationId:event.chatId,messageId:event.messageId,senderUid:sender},
      {headers:{'Cache-Control':'no-store'}});
  } catch { qaPilotDiagnostic(stage,0); return response(503,'notice_unavailable'); }
}

`;

export function renderConversationPushPilotWorker(mainWorker) {
  let code = renderQaWorker(mainWorker, 'atrio-catolico-qa-geral');
  const replace = (anchor, replacement) => {
    code = replaceOnce(code, anchor, replacement);
  };
  replace("const PROJECT = 'atrio-catolico-qa-geral';",
    "const PROJECT = '" + identity.projectId + "';\n" + pilotChecks);
  replace('.bind("atrio-qa-geral").first()', '.bind("atrio-qa-conversations-pilot").first()');
  replace("!['eligible','declared_18_plus'].includes(env.ATRIO_QA_AGE_POLICY)",
    "env.ATRIO_QA_AGE_POLICY !== qaPilot.ageMode");
  replace("!['chat_message','group_message'].includes(data.type)",
    "data.type !== 'chat_message'");
  replace("if(!account || account.disabled || !uidPart(account.localId)) return null;",
    "if(!qaPilotAccountValid(account)) return null;");
  replace("https://www.googleapis.com/auth/firebase.messaging'",
    "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/identitytoolkit'");
  replace("(request.method==='POST' && qaPath==='/event')))",
    "(request.method==='POST' && qaPath==='/event') || " +
    "(request.method==='GET' && qaPath==='/notice' && !new URL(request.url).search)))");
  replace("    const path = new URL(request.url).pathname;",
    "    if (qaPath==='/notice') return qaReadConversationNotice(request,env,configured);\n" +
    "    const path = new URL(request.url).pathname;");
  // Um GET em lote e um lookup do Auth adicionais por rechecagem.
  replace("const checksPerPass=event.kind==='group_message' ? 4 : 6;", 'const checksPerPass=8;');
  replace(`await qaChatPushPreSendAllowed(token,uid,recipient,
            event.kind==='group_message' ? event.groupId : null,env.ATRIO_QA_AGE_POLICY) &&
          await qaChatPolicyPreSendAllowed(token,uid,recipient,event) &&
          await qaChatMessagePreSendAllowed(token,uid,event)
`, 'await qaConversationNoticeAllowed(token,uid,recipient,event,env.ATRIO_QA_AGE_POLICY)\n');
  replace('token:device, data:{uid,kind,...extras},\n      android:{priority:\'HIGH\',ttl:\'3600s\'},',
    "token:device, data:{signal:'refresh'},\n      android:{priority:'HIGH',ttl:'60s'},");
  const receiptOutcome = `              transportFailure=true;
              break;
            }
            accepted++;
          } else {`;
  replace(receiptOutcome, `              await qaLogFcmSendResponse(result.status);
              transportFailure=true;
              break;
            }
            accepted++;
            await qaLogFcmSendResponse(result.status, receipt.name.slice(prefix.length));
          } else {`);
  // Instrument only the generated QA pilot. No raw error, URL, token, body,
  // identity, private key, document path or request headers are logged.
  replace("const qaNoRedirectFetch = (url, init={}) => fetch(url,{...init,redirect:'error'});", 
    'const qaPilotDiagnostic = (stage,status) => {\n'+
    "  if (!['auth_http','oauth_http','firestore_http','fcm_http','other_http','notice_auth','notice_oauth','notice_firestore','event_auth','event_oauth','event_firestore'].includes(stage)) return;\n"+
    "  try { console.warn({event:'qa_push_diagnostic',stage,status:Number.isInteger(status)&&status>=100&&status<=599?status:0}); } catch {}\n"+
    '};\n'+
    'const qaNoRedirectFetch = async (url, init={}) => {\n'+
    '  const origin = new URL(url).origin;\n'+
    "  const stage = origin==='https://oauth2.googleapis.com'?'oauth_http':origin==='https://identitytoolkit.googleapis.com'?'auth_http':origin==='https://firestore.googleapis.com'?'firestore_http':origin==='https://fcm.googleapis.com'?'fcm_http':'other_http';\n"+
    "  try { const r=await fetch(url,{...init,redirect:'error'}); if(!r.ok && !(stage==='firestore_http' && r.status===404)) qaPilotDiagnostic(stage,r.status); return r; }\n"+
    "  catch(error) { qaPilotDiagnostic(stage,0); throw error; }\n"+
    '};');
  replace("    if(Number(request.headers.get('content-length')||'0')>512)\n      return response(413,'too_large');\n    try {",
    "    if(Number(request.headers.get('content-length')||'0')>512)\n      return response(413,'too_large');\n    let stage='event_auth';\n    try {");
  replace("      const uid=await verifyIdentity(request,env);\n      if(!uid) return response(401,'unauthorized');\n      const token=await oauth(env);",
    "      const uid=await verifyIdentity(request,env);\n      if(!uid) return response(401,'unauthorized');\n      stage='event_oauth';\n      const token=await oauth(env);\n      stage='event_firestore';");
  replace("      // Não registrar ID tokens, chaves, UID, FCM tokens nem payloads em logs.\n      return response(503,'unavailable');",
    "      // Diagnóstico de etapa fixo, nunca dados da requisição.\n      qaPilotDiagnostic(stage,0);\n      return response(503,'unavailable');");
  return code;
}
