/**
 * Item 13 / #199 — triagem, decisão e recurso de denúncia de DM/grupo.
 * SOMENTE candidato de QA com dados fictícios; endpoint NÃO montado.
 * Não altera histórico, não aplica sanção nem concede fila global.
 *
 * Compõe com o serviço de consulta por caso da #445, sem mudar seu contrato.
 * O chamador injeta Firebase Admin Firestore e verifyIdToken(token, true).
 */
import {randomUUID} from 'node:crypto';

const TYPES=Object.freeze({
  direct:{collection:'chat_reports',target:'chatId'},
  group:{collection:'chat_group_reports',target:'groupId'}
});
const CASE=/^[A-Za-z0-9_-]{1,530}$/;
const UID=/^[A-Za-z0-9_-]{1,128}$/;
const FIELDS={
  direct:'chatId|createdAt|messageId|reason|reportedText|reporterUid',
  group:'createdAt|groupId|messageId|reason|reportedText|reporterUid'
};
const matchKeys=(v,expected)=>v && !Array.isArray(v) &&
  Object.keys(v).sort().join('|')===expected;
const validNote=v=>typeof v==='string' && v===v.trim() && v.length>=5 && v.length<=300;
const millis=v=>typeof v?.toMillis==='function'?v.toMillis():NaN;
const has=d=>d?.exists===true;
const nowMs=(clock)=>{
  const now=clock();
  if(!Number.isSafeInteger(now))throw Error('case_workflow_clock_invalid');
  return now;
};
function validReport(channel,caseId,data) {
  const type=TYPES[channel];
  return matchKeys(data,FIELDS[channel]) &&
    UID.test(data.reporterUid??'') &&
    CASE.test(data[type.target]??'') &&
    CASE.test(data.messageId??'') &&
    caseId===data.reporterUid+'__'+data[type.target]+'__'+data.messageId &&
    validNote(data.reason) &&
    typeof data.reportedText==='string' && data.reportedText.length>=1 &&
    data.reportedText.length<=1500 &&
    Number.isFinite(millis(data.createdAt));
}
function validGrant(grant,uid,now) {
  return matchKeys(grant,'moderatorUid|reviewExpiresAt|status') &&
    grant.moderatorUid===uid && grant.status==='active' &&
    Number.isFinite(millis(grant.reviewExpiresAt)) &&
    millis(grant.reviewExpiresAt)>now;
}
function validRequestBody(channel,caseId) {
  return Object.hasOwn(TYPES,channel) && typeof caseId==='string' && CASE.test(caseId);
}
function shortOutcome(stage){return {status:'accepted',stage};}

export function createCaseReviewWorkflow({
  db,verifyIdToken,serverTimestamp,clock=()=>Date.now(),projectId='demo-atrio-v11'
}={}) {
  if(typeof db?.runTransaction!=='function'||typeof db?.doc!=='function'||
     typeof verifyIdToken!=='function'||typeof serverTimestamp!=='function'||
     projectId!=='demo-atrio-v11')throw Error('case_workflow_qa_only');
  async function authenticate(idToken) {
    if(typeof idToken!=='string'||idToken.length<1||idToken.length>8192)return null;
    let token;
    try{token=await verifyIdToken(idToken,true);}
    catch{return null;}
    return token?.aud===projectId && token.email_verified===true &&
      typeof token.uid==='string' && UID.test(token.uid) ? token.uid : null;
  }
  const refs=(channel,caseId)=>({
    evidence:db.doc(TYPES[channel].collection+'/'+caseId),
    state:db.doc('chatModerationCaseStates/'+channel+'/cases/'+caseId),
    assignment:db.doc('chatModerationAssignments/'+channel+'/cases/'+caseId)
  });
  const log=(tx,uid,channel,caseId,action)=>{
    // Trilha sem motivo, trecho, nota, IDs de mensagens ou dados de sessão.
    tx.create(db.doc('chatModerationWorkflowEvents/'+randomUUID()),{
      actorUid:uid,channel,caseId,action,outcome:'accepted',
      recordedAt:serverTimestamp()
    });
  };

  /**
   * triage: ausente -> triaged.
   * decide: triaged -> decided (dismissed | action_recommended).
   * review_appeal: appealed -> appeal_reviewed (upheld | revised).
   * O revisor do recurso deve ser OUTRO moderador atribuído.
   * "action_recommended" não remove mensagem nem aplica sanção.
   */
  async function moderate({idToken,channel,caseId,action,decision,note}={}) {
    if(!validRequestBody(channel,caseId)||
       !['triage','decide','review_appeal'].includes(action))return null;
    if(action==='triage'){
      if(decision!==undefined||note!==undefined)return null;
    } else if(!validNote(note) ||
      (action==='decide' && !['dismissed','action_recommended'].includes(decision)) ||
      (action==='review_appeal' && !['upheld','revised'].includes(decision)))
      return null;
    const uid=await authenticate(idToken);
    if(!uid)return null;
    const now=nowMs(clock);
    const {evidence,state,assignment}=refs(channel,caseId);
    const role=db.doc('admins/'+uid);
    return db.runTransaction(async tx=>{
      const [r,g,d,s]=await Promise.all([
        tx.get(role),tx.get(assignment),tx.get(evidence),tx.get(state)
      ]);
      if(!has(r)||r.data()?.enabled!==true||!has(g)||
         !validGrant(g.data(),uid,now)||!has(d)||
         !validReport(channel,caseId,d.data()))return null;
      const prior=s.exists?s.data():null;
      let stage;
      if(action==='triage'){
        if(prior!==null)return null;
        stage='triaged';
        tx.create(state,{
          stage,triagedBy:uid,triagedAt:serverTimestamp()
        });
      } else if(action==='decide'){
        if(prior?.stage!=='triaged'||!UID.test(prior.triagedBy??''))return null;
        stage='decided';
        tx.update(state,{
          stage,decision,decisionNote:note,decisionBy:uid,
          decidedAt:serverTimestamp()
        });
      } else {
        if(prior?.stage!=='appealed'||!UID.test(prior.decisionBy??'')||
           prior.decisionBy===uid || prior.appealBy!==d.data().reporterUid)
          return null;
        stage='appeal_reviewed';
        tx.update(state,{
          stage,appealResult:decision,appealReviewNote:note,
          appealReviewedBy:uid,appealReviewedAt:serverTimestamp()
        });
      }
      log(tx,uid,channel,caseId,action);
      return shortOutcome(stage);
    });
  }

  /** Somente o denunciante, após decisão, pode interpor um recurso único. */
  async function appeal({idToken,channel,caseId,reason}={}) {
    if(!validRequestBody(channel,caseId)||!validNote(reason))return null;
    const uid=await authenticate(idToken);
    if(!uid)return null;
    const {evidence,state}=refs(channel,caseId);
    return db.runTransaction(async tx=>{
      const [d,s]=await Promise.all([tx.get(evidence),tx.get(state)]);
      if(!has(d)||!validReport(channel,caseId,d.data())||
         d.data().reporterUid!==uid||!has(s)||
         s.data()?.stage!=='decided')return null;
      tx.update(state,{
        stage:'appealed',appealBy:uid,appealReason:reason,
        appealedAt:serverTimestamp()
      });
      log(tx,uid,channel,caseId,'appeal');
      return shortOutcome('appealed');
    });
  }

  /** Consulta de ESTADO por caso, com a mesma ACL e trilha atômica. */
  async function stateOf({idToken,channel,caseId}={}) {
    if(!validRequestBody(channel,caseId))return null;
    const uid=await authenticate(idToken);
    if(!uid)return null;
    const now=nowMs(clock);
    const {evidence,state,assignment}=refs(channel,caseId);
    const role=db.doc('admins/'+uid);
    return db.runTransaction(async tx=>{
      const [r,g,d,s]=await Promise.all([
        tx.get(role),tx.get(assignment),tx.get(evidence),tx.get(state)
      ]);
      if(!has(r)||r.data()?.enabled!==true||!has(g)||
         !validGrant(g.data(),uid,now)||!has(d)||
         !validReport(channel,caseId,d.data()))return null;
      const stage=has(s)?s.data()?.stage:'open';
      if(!['open','triaged','decided','appealed','appeal_reviewed'].includes(stage))
        return null;
      log(tx,uid,channel,caseId,'state');
      // Nada de nota, texto, identidade do denunciante ou histórico.
      return {status:'available',stage};
    });
  }
  return {moderate,appeal,stateOf};
}

/** Handler QA desmontado por padrão. Nenhum bind/Worker/trigger remoto. */
export function createCaseReviewWorkflowHttpHandler(service,{enabled=false}={}) {
  if(typeof service?.moderate!=='function'||typeof service?.appeal!=='function'||
     typeof service?.stateOf!=='function')throw Error('case_workflow_service_required');
  const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache',
    'Content-Type':'application/json; charset=utf-8'};
  const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  const unavailable=()=>respond(404,{status:'case_unavailable'});
  const routes={
    '/v1/qa/conversations/moderation/case/action':'moderate',
    '/v1/qa/conversations/moderation/case/appeal':'appeal',
    '/v1/qa/conversations/moderation/case/state':'stateOf'
  };
  return async request=>{
    if(!enabled)return respond(503,{status:'case_moderation_closed'});
    let url;
    try{url=new URL(request?.url);}catch{return respond(400,{status:'invalid_request'});}
    const method=routes[url.pathname];
    if(url.protocol!=='https:'||url.search||!method||
       request.method!=='POST'||request.headers.get('content-type')!=='application/json')
      return respond(400,{status:'invalid_request'});
    const auth=request.headers.get('authorization')||'';
    if(!/^Bearer [^\s]{1,8192}$/.test(auth))return unavailable();
    let body;
    try{
      const raw=await request.text();
      if(Buffer.byteLength(raw,'utf8')>2048)return respond(413,{status:'invalid_request'});
      body=JSON.parse(raw);
    }catch{return respond(400,{status:'invalid_request'});}
    if(!body || typeof body!=='object' || Array.isArray(body) ||
       !validRequestBody(body.channel,body.caseId))return respond(400,{status:'invalid_request'});
    const keys=Object.keys(body).sort().join('|');
    if((method==='stateOf'&&keys!=='caseId|channel')||
       (method==='appeal'&&keys!=='caseId|channel|reason')||
       (method==='moderate'&&
         !(['action|caseId|channel','action|caseId|channel|decision|note'].includes(keys))))
      return respond(400,{status:'invalid_request'});
    try{
      const result=await service[method]({...body,idToken:auth.slice(7)});
      return result?respond(200,result):unavailable();
    }catch{return respond(503,{status:'case_unavailable'});}
  };
}
