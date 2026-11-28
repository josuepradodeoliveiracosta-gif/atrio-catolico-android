// Modelo OFFLINE de fila de denúncias, inspirado no Coop, sem código externo.
// A entrada é uma projeção administrativa de fixture, NÃO documentos brutos.
// Nenhum I/O, escrita, decisão disciplinar ou autorização remota.
export const QUEUE_VERSION = 'guardian-report-queue-offline-1';
export const MAX_PAGE = 100;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const id = x => typeof x === 'string' && ID.test(x);
const exact = (v,keys) => v !== null && typeof v === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(v).length === keys.length && keys.every(k=>Object.hasOwn(v,k) && Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const schema = ['collection','reportId','reporterUid','targetType','targetId','childId','status','createdAtMs','category','urgency'];
const categories = ['unclassified','spam','fraud','threat','privacy','harassment','other'];
const config = Object.freeze({reports:{post:['pending','dismissed','removed'],reply:['pending','dismissed','removed']},user_reports:{user:['pending','reviewed']},feed_reports:{post:['pending','reviewed'],comment:['pending','reviewed'],channel:['pending','reviewed']}});
const urgencyRank = {normal:0,priority:1,urgent:2};
const deny = reason=>({ok:false,reason,version:QUEUE_VERSION,remoteAuthorized:false,groups:[]});
const cmp = (a,b)=>a<b?-1:a>b?1:0;
function validate(r,now){
 if(!exact(r,schema)||typeof r.collection!=='string'||typeof r.targetType!=='string'||typeof r.urgency!=='string'||!Object.hasOwn(config,r.collection)||!Object.hasOwn(config[r.collection],r.targetType)||!config[r.collection][r.targetType].includes(r.status))return false;
 if(![r.reportId,r.reporterUid,r.targetId].every(id)||!Number.isSafeInteger(r.createdAtMs)||r.createdAtMs<0||r.createdAtMs>now)return false;
 if(!categories.includes(r.category)||!Object.hasOwn(urgencyRank,r.urgency))return false;
 if(['reply','comment'].includes(r.targetType)?!id(r.childId):r.childId!==null)return false;
 if(r.targetType==='user'&&r.targetId===r.reporterUid)return false;
 return true;
}
// category e urgency são anotações de fixture do moderador, não texto ou
// alegações do denunciante. Sem anotação, usar unclassified/normal.
// Não existe classificação automática por volume de denúncias.
export function buildReportQueue(ctx,rows,now){
 try{
 if(!exact(ctx,['environment','project','role','authenticated','active','sessionFresh'])||ctx.environment!=='offline-fixture'||ctx.project!=='guardian-v2-qa-fixture'||ctx.role!=='moderator'||ctx.authenticated!==true||ctx.active!==true||ctx.sessionFresh!==true)return deny('scope_denied');
 if(!Number.isSafeInteger(now)||now<0||!Array.isArray(rows)||rows.length>MAX_PAGE)return deny('page_denied');
 const groups=new Map(),seen=new Map();
 for(const r of rows){
  if(!validate(r,now))return deny('invalid_projection');
  const reportKey=JSON.stringify([r.collection,r.reportId]);
  const fingerprint=JSON.stringify(schema.map(k=>r[k]));
  if(seen.has(reportKey)){if(seen.get(reportKey)!==fingerprint)return deny('conflicting_report');continue;}
  seen.set(reportKey,fingerprint);
  if(r.status!=='pending')continue;
  const key=JSON.stringify([r.collection,r.targetType,r.targetId,r.childId]);
  if(!groups.has(key))groups.set(key,{collection:r.collection,targetType:r.targetType,targetId:r.targetId,childId:r.childId,urgency:'normal',oldestAtMs:r.createdAtMs,reportIds:[],reporters:new Set(),categories:new Set()});
  const g=groups.get(key);g.reportIds.push(r.reportId);g.reporters.add(r.reporterUid);g.categories.add(r.category);
  g.oldestAtMs=Math.min(g.oldestAtMs,r.createdAtMs);
  if(urgencyRank[r.urgency]>urgencyRank[g.urgency])g.urgency=r.urgency;
 }
 const out=[...groups.values()].map(({reporters,categories,...g})=>({...g,reportIds:g.reportIds.sort(cmp),categories:[...categories].sort(cmp),distinctReporters:reporters.size,reportCount:g.reportIds.length}));
 out.sort((a,b)=>urgencyRank[b.urgency]-urgencyRank[a.urgency]||a.oldestAtMs-b.oldestAtMs||cmp(JSON.stringify([a.collection,a.targetType,a.targetId,a.childId]),JSON.stringify([b.collection,b.targetType,b.targetId,b.childId])));
 return {ok:true,version:QUEUE_VERSION,remoteAuthorized:false,coverage:'page_only',groups:out};
 }catch{return deny('invalid_input');}
}
