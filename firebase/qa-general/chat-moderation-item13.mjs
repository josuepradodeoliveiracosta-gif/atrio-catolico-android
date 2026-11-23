/**
 * Item 13 da #199 — contrato de atendimento de denúncias em QA isolado.
 * Não há rota montada, trigger, deploy ou credencial neste módulo.
 * O host confiável injeta Admin Firestore e verifyIdToken(checkRevoked=true).
 *
 * Intencionalmente não oferece listagem global nem consulta direta do APK:
 * cada abertura autorizada registra trilha no MESMO commit de leitura de caso.
 */
import {randomUUID} from 'node:crypto';

const CHANNELS=Object.freeze({
  direct:{reports:'chat_reports',target:'chatId'},
  group:{reports:'chat_group_reports',target:'groupId'}
});
const ID=/^[A-Za-z0-9_-]{1,530}$/;
const UID=/^[A-Za-z0-9_-]{1,128}$/;
const ASSIGNMENT_KEYS='moderatorUid|reviewExpiresAt|status';
const REPORT_KEYS={
  direct:'chatId|createdAt|messageId|reason|reportedText|reporterUid',
  group:'createdAt|groupId|messageId|reason|reportedText|reporterUid'
};
const has=(doc)=>doc?.exists===true;
const millis=value=>typeof value?.toMillis==='function'?value.toMillis():NaN;
const exactKeys=(data,keys)=>data && !Array.isArray(data) &&
  Object.keys(data).sort().join('|')===keys;
const requiredText=(value,min,max)=>typeof value==='string' &&
  value.length>=min&&value.length<=max;

function validReport(channel,caseId,data) {
  const target=CHANNELS[channel].target;
  if(!exactKeys(data,REPORT_KEYS[channel]) ||
     !UID.test(data.reporterUid||'') ||
     !ID.test(data[target]||'') || !ID.test(data.messageId||'') ||
     caseId!==data.reporterUid+'__'+data[target]+'__'+data.messageId ||
     !requiredText(data.reason,5,300) ||
     !requiredText(data.reportedText,1,1500) ||
     !Number.isFinite(millis(data.createdAt)))return false;
  return true;
}
function activeAssignment(data,uid,now) {
  return exactKeys(data,ASSIGNMENT_KEYS) &&
    data.status==='active'&&data.moderatorUid===uid &&
    Number.isFinite(millis(data.reviewExpiresAt)) &&
    millis(data.reviewExpiresAt)>now;
}
function validUid(uid) {return typeof uid==='string'&&UID.test(uid);}

/**
 * ACL e gravação de auditoria na mesma transação: revogação concorrente
 * provoca retry ou conflito de commit; jamais devolve um snapshot não auditado.
 * Não faz consultas a chats, chat_groups ou subcoleções de mensagens.
 */
export function createScopedModerationService({
  db,verifyIdToken,serverTimestamp,projectId='demo-atrio-v11',clock=()=>Date.now()
}={}) {
  if(typeof db?.doc!=='function'||typeof db?.runTransaction!=='function'||
     typeof verifyIdToken!=='function'||typeof serverTimestamp!=='function'||
     projectId!=='demo-atrio-v11')
    throw Error('case_moderation_qa_configuration_required');

  return {
    async open({idToken,channel,caseId}={}) {
      if(typeof idToken!=='string'||idToken.length<1||idToken.length>8192||
         !Object.hasOwn(CHANNELS,channel)||typeof caseId!=='string'||!ID.test(caseId))
        return null;
      let claims;
      try{claims=await verifyIdToken(idToken,true);}
      catch{return null;}
      const uid=claims?.uid;
      if(!validUid(uid)||claims.email_verified!==true||claims.aud!==projectId)
        return null;
      const now=clock();
      if(!Number.isSafeInteger(now))throw Error('case_moderation_clock_unavailable');

      const moderator=db.doc('admins/'+uid);
      const assignment=db.doc('chatModerationAssignments/'+channel+'/cases/'+caseId);
      const report=db.doc(CHANNELS[channel].reports+'/'+caseId);
      return db.runTransaction(async tx=>{
        const [role,grant,evidence]=await Promise.all([
          tx.get(moderator),tx.get(assignment),tx.get(report)
        ]);
        if(!has(role)||role.data()?.enabled!==true||
           !has(grant)||!activeAssignment(grant.data(),uid,now)||
           !has(evidence)||!validReport(channel,caseId,evidence.data()))
          return null;
        const d=evidence.data();
        // Sem IDs de sala ou mensagem, participante, histórico ou prévias.
        const safe={
          caseId,channel,reason:d.reason,excerpt:d.reportedText,
          reportedAt:d.createdAt.toDate().toISOString()
        };
        tx.create(db.doc('chatModerationAccessEvents/'+randomUUID()),{
          moderatorUid:uid,caseId,channel,outcome:'allowed',
          accessedAt:serverTimestamp()
        });
        return safe;
      });
    }
  };
}

/** Endpoint NÃO montado; integração em QA remota exige autorização própria. */
export function createScopedModerationHttpHandler(service,{enabled=false}={}) {
  if(typeof service?.open!=='function')throw Error('case_moderation_service_required');
  const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache',
    'Content-Type':'application/json; charset=utf-8'};
  const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  const unavailable=()=>respond(404,{status:'case_unavailable'});
  return async request=>{
    if(enabled!==true)return respond(503,{status:'case_moderation_closed'});
    let url;
    try{url=new URL(request?.url);}catch{return respond(400,{status:'invalid_request'});}
    if(url.protocol!=='https:'||url.pathname!=='/v1/qa/conversations/moderation/case'||
       url.search||request.method!=='POST'||
       request.headers.get('content-type')!=='application/json')
      return respond(400,{status:'invalid_request'});
    const auth=request.headers.get('authorization')||'';
    if(!/^Bearer [^\s]{1,8192}$/.test(auth))return unavailable();
    let body;
    try {
      const raw=await request.text();
      if(Buffer.byteLength(raw,'utf8')>2048)return respond(413,{status:'invalid_request'});
      body=JSON.parse(raw);
    } catch {return respond(400,{status:'invalid_request'});}
    if(!body||Array.isArray(body)||
       Object.keys(body).sort().join('|')!=='caseId|channel'||
       !Object.hasOwn(CHANNELS,body.channel)||!ID.test(body.caseId||''))
      return respond(400,{status:'invalid_request'});
    try{
      const found=await service.open({idToken:auth.slice(7),...body});
      return found?respond(200,{status:'available',case:found}):unavailable();
    } catch {return respond(503,{status:'case_unavailable'});}
  };
}
