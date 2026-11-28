// Original offline prototype, inspired by review workflows in Ozone.
// No I/O, identity verification, persistence, notifications or enforcement.
export const APPEAL_VERSION='guardian-appeals-offline-1';
const id=v=>typeof v==='string'&&/^fixture_[A-Za-z0-9_-]{1,64}$/.test(v);
const exact=(v,ks)=>v!==null&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const note=(v,min,max)=>typeof v==='string'&&v.length<=max&&v.trim().length>=min&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const outcomes=['recommend_reconsideration','recommend_maintain','insufficient_evidence'];
const keys=['caseId','owner','originalReviewer','assignedReviewer','originalStatus','state','revision','updatedAt','appealNote','appealedAt','reviewNote','outcome','resolvedAt'];
function validRecord(r,now){
 if(!exact(r,keys)||!id(r.caseId)||!id(r.owner)||!['held','removed'].includes(r.originalStatus)||!integer(r.revision)||!integer(r.updatedAt)||r.updatedAt>now)return false;
 if(r.originalReviewer!==null&&(!id(r.originalReviewer)||r.originalReviewer===r.owner))return false;
 if(r.originalStatus==='removed'&&r.originalReviewer===null)return false;
 if(r.assignedReviewer!==null&&(!id(r.assignedReviewer)||r.assignedReviewer===r.owner||r.assignedReviewer===r.originalReviewer))return false;
 if(r.state==='not_requested')return r.assignedReviewer===null&&r.appealNote===null&&r.appealedAt===null&&r.reviewNote===null&&r.outcome===null&&r.resolvedAt===null;
 if(!note(r.appealNote,10,500)||!integer(r.appealedAt)||r.appealedAt>r.updatedAt)return false;
 if(r.state==='submitted'||r.state==='reviewing')return (r.state==='submitted'||r.assignedReviewer!==null)&&r.reviewNote===null&&r.outcome===null&&r.resolvedAt===null;
 return r.state==='resolved'&&r.assignedReviewer!==null&&note(r.reviewNote,5,300)&&outcomes.includes(r.outcome)&&integer(r.resolvedAt)&&r.resolvedAt>=r.appealedAt&&r.resolvedAt===r.updatedAt;
}
const deny=reason=>({ok:false,reason,version:APPEAL_VERSION,remoteAuthorized:false,record:null,audit:null,notice:null});
function validContext(c){return exact(c,['environment','project','uid','role','authenticated','active','fresh'])&&c.environment==='offline-fixture'&&c.project==='guardian-v2-qa-fixture'&&id(c.uid)&&['owner','moderator'].includes(c.role)&&c.authenticated===true&&c.active===true&&c.fresh===true;}
// ctx, record, now and assignment are trusted harness snapshots, NEVER HTTP fields.
// CAS is simulated: future storage adapter MUST atomically verify the prior revision,
// identity, assignment, source decision revision, and persist case/audit/notice together.
export function transitionAppeal(ctx,record,request,now){
 try{
  if(!validContext(ctx))return deny('identity_denied');
  if(!integer(now)||!validRecord(record,now))return deny('record_denied');
  if(!request||typeof request!=='object'||!Object.hasOwn(Object.getOwnPropertyDescriptor(request,'operation')||{},'value'))return deny('request_denied');
  const op=request.operation;
  const fields={submit:['operation','caseId','expectedRevision','note'],start:['operation','caseId','expectedRevision'],resolve:['operation','caseId','expectedRevision','note','outcome']};
  if(typeof op!=='string'||!Object.hasOwn(fields,op)||!exact(request,fields[op])||request.caseId!==record.caseId)return deny('request_denied');
  if(request.expectedRevision!==record.revision||record.revision===Number.MAX_SAFE_INTEGER)return deny('revision_conflict');
  if(now<=record.updatedAt)return deny('clock_conflict');
  const owner=ctx.role==='owner'&&ctx.uid===record.owner;
  const reviewer=ctx.role==='moderator'&&ctx.uid===record.assignedReviewer&&ctx.uid!==record.owner&&ctx.uid!==record.originalReviewer;
  let changes,event;
  if(op==='submit'){
   if(!owner||record.state!=='not_requested'||!note(request.note,10,500))return deny('submit_denied');
   changes={state:'submitted',appealNote:request.note.trim(),appealedAt:now};event='appeal_submitted';
  }else if(op==='start'){
   if(!reviewer||record.state!=='submitted')return deny('review_denied');
   changes={state:'reviewing'};event='review_started';
  }else{
   if(!reviewer||record.state!=='reviewing'||!note(request.note,5,300)||!outcomes.includes(request.outcome))return deny('resolution_denied');
   changes={state:'resolved',reviewNote:request.note.trim(),outcome:request.outcome,resolvedAt:now};event='review_resolved';
  }
  const next={...record,...changes,revision:record.revision+1,updatedAt:now};
  if(!validRecord(next,now))return deny('transition_invalid');
  return {ok:true,version:APPEAL_VERSION,remoteAuthorized:false,enforcementAuthorized:false,expectedRevision:record.revision,record:next,audit:{caseId:record.caseId,revision:next.revision,event,actor:ctx.uid,at:now},notice:{recipient:record.owner,caseId:record.caseId,revision:next.revision,event}};
 }catch{return deny('invalid_input');}
}
// Assignment is a trusted test fixture injected by the harness, not a public operation.
// Exposes only the owner's or assigned reviewer's necessary view; no raw source evidence.
export function appealView(ctx,r,now){
 try{
  if(!validContext(ctx)||!integer(now)||!validRecord(r,now))return null;
  if(!(ctx.role==='owner'&&ctx.uid===r.owner)&&!(ctx.role==='moderator'&&ctx.uid===r.assignedReviewer&&ctx.uid!==r.originalReviewer&&ctx.uid!==r.owner))return null;
  return {caseId:r.caseId,state:r.state,originalStatus:r.originalStatus,revision:r.revision,appealNote:r.appealNote,appealedAt:r.appealedAt,reviewNote:r.reviewNote,outcome:r.outcome,resolvedAt:r.resolvedAt,remoteAuthorized:false};
 }catch{return null;}
}
