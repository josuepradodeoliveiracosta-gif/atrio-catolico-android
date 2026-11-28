// Executable local QA integration. Node >=22.13, in-memory SQLite, synthetic data only.
// Never imported by the deployed Worker or Android app. No network or credentials.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {classify,decide} from '../../cloudflare/guardian-worker/src/policy.js';
import {evaluateFinancialGate,LIMITS} from './financial-gate.mjs';
import {evaluateAuthorization} from './authorization-policy.mjs';
import {classifyRisk} from './risk-classification.mjs';
import {dashboardFixture} from './qa-dashboard-bridge.mjs';
import {previewModeration} from './integration-preview.mjs';
import {transitionAppeal,appealView} from './appeals-review.mjs';
const fix=v=>typeof v==='string'&&/^fixture_[A-Za-z0-9_-]{1,64}$/.test(v);
const exact=(v,k)=>v!==null&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===k.length&&k.every(x=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,x)||{},'value'));
const deny=reason=>({ok:false,reason,remoteAuthorized:false,punishmentAuthorized:false});
const pass=o=>({ok:true,...o,remoteAuthorized:false,punishmentAuthorized:false});
const hash=s=>createHash('sha256').update(s).digest('hex');
const revision=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
const date=(ms,zone)=>new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
const scope={environment:'offline-fixture',project:'guardian-v2-qa-fixture'};
const ctx=(uid,role)=>({...scope,uid,role,authenticated:true,active:true,fresh:true});
export function createLocalQaRuntime(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE budget(kind TEXT, window TEXT, used INTEGER NOT NULL CHECK(used>=0), PRIMARY KEY(kind,window));
 CREATE TABLE receipts(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
 CREATE TABLE latest(path TEXT PRIMARY KEY, revision TEXT NOT NULL);
 CREATE TABLE cases(id TEXT PRIMARY KEY, level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 3), action TEXT NOT NULL CHECK(action IN ('warn','review')));
 CREATE TABLE appeals(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
 CREATE TABLE audit(id TEXT PRIMARY KEY, event TEXT NOT NULL);
 CREATE TABLE notices(id TEXT PRIMARY KEY, event TEXT NOT NULL);`);
 function transaction(fn){
  try{db.exec('BEGIN IMMEDIATE');const r=fn();db.exec(r.ok?'COMMIT':'ROLLBACK');return r;}
  catch{try{db.exec('ROLLBACK');}catch{}return deny('transaction_denied');}
 }
 function budget(now,events){
  const windows={reads:date(now,'America/Los_Angeles'),writes:date(now,'America/Los_Angeles'),deletes:date(now,'America/Los_Angeles'),storageBytes:'all',workerRequests:date(now,'UTC')};
  const usage=Object.fromEntries(Object.keys(LIMITS).map(k=>[k,db.prepare('SELECT used FROM budget WHERE kind=? AND window=?').get(k,windows[k])?.used??0]));
  const estimate={reads:events+8,writes:4,deletes:0,storageBytes:16384,workerRequests:1,workerCpuMs:8,newPaidService:false,additionalProducts:false,artifactUpload:false};
  const financial=evaluateFinancialGate({firebasePlan:'Spark',firebaseBillingEnabled:false,workerPlan:'Free',githubPublic:true,standardRunner:true,paidExtras:false,observedAt:now,firestoreDay:windows.reads,workerDay:windows.workerRequests,usage,reserved:Object.fromEntries(Object.keys(LIMITS).map(k=>[k,0]))},estimate,now);
  return {financial,charge(){for(const k of Object.keys(LIMITS))db.prepare('INSERT INTO budget VALUES(?,?,?) ON CONFLICT(kind,window) DO UPDATE SET used=used+excluded.used').run(k,windows[k],estimate[k]);}};
 }
 function triage(f){return transaction(()=>{
  if(!exact(f,['now','auth','policy','source','events'])||!Number.isSafeInteger(f.now)||f.now<300000||!exact(f.source,['ownerUid','targetPath','revision','eligible'])||!fix(f.source.ownerUid)||!revision(f.source.revision)||Date.parse(f.source.revision)>f.now||!exact(f.auth,['environment','project','role','uid','authenticated','active','sessionFresh','identitySeparated'])||!fix(f.auth.uid)||!exact(f.policy,['enabled','autonomousWriteEnabled','emergencyStop','allowHold','revision'])||f.auth.uid===f.source.ownerUid||typeof f.source.targetPath!=='string'||!/^posts\/fixture_[A-Za-z0-9_-]{1,64}(?:\/replies\/fixture_[A-Za-z0-9_-]{1,64})?$/.test(f.source.targetPath)||!Array.isArray(f.events)||f.events.length<1||f.events.length>50)return deny('fixture_denied');
  const space=f.source.targetPath.split('/')[1],id='guard_'+hash('atrio-guardian-v2:'+f.source.targetPath+'@'+f.source.revision).slice(0,32);
  const b=budget(f.now,f.events.length);
  if(!b.financial.allowed)return deny('budget_denied');
  const proposal={operation:'propose_case',caseId:id,expectedRevision:f.source.revision,expectedPolicyRevision:f.policy?.revision,status:'review'};
  if(!evaluateAuthorization(f.auth,proposal,f.source,f.policy,b.financial).allowed)return deny('authorization_denied');
  const events=[],findings=[],actions=[];
  for(const e of f.events){
   if(!exact(e,['eventId','atMs','kind','context','body'])||!fix(e.eventId)||!Number.isSafeInteger(e.atMs)||e.atMs<=f.now-300000||e.atMs>f.now||typeof e.body!=='string'||e.body.length>4000)return deny('event_denied');
   const g={actor:f.source.ownerUid,source:'forum',space};
   const finding=classify(e.body,{});actions.push(decide(finding));
   events.push({...g,eventId:e.eventId,atMs:e.atMs,kind:e.kind,context:e.context,contentTag:'fixture_'+hash(e.body).slice(0,48)});
   findings.push({...g,findingId:e.eventId,atMs:e.atMs,rule:finding.rule,level:finding.level,confidence:finding.confidence});
  }
  const risk=classifyRisk({...scope,role:'triage',authenticated:true,active:true,sessionFresh:true,scopeApproved:true,emergencyStop:false},events,[],findings,f.now);
  if(!risk.ok||risk.results.length!==1)return deny('risk_denied');
  const level=risk.results[0].level,action=level===0?'clear':level>=2||actions.includes('review')?'review':'warn';
  if(!Number.isInteger(level)||level<0||level>3||risk.results[0].punishmentAuthorized!==false||!evaluateAuthorization(f.auth,{...proposal,status:action==='warn'?'warned':'review'},f.source,f.policy,b.financial).allowed)return deny('risk_denied');
  const fp=hash(JSON.stringify([events,findings]));
  const prev=db.prepare('SELECT fingerprint,result FROM receipts WHERE id=?').get(id);
  if(prev)return prev.fingerprint===fp?pass({...JSON.parse(prev.result),duplicate:true}):deny('revision_conflict');
  const latest=db.prepare('SELECT revision FROM latest WHERE path=?').get(f.source.targetPath);
  if(latest&&latest.revision>=f.source.revision)return deny('stale_revision');
  const result={level,action,caseCreated:level>0};
  b.charge();
  db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(id,fp,JSON.stringify(result));
  db.prepare('INSERT INTO latest VALUES(?,?) ON CONFLICT(path) DO UPDATE SET revision=excluded.revision').run(f.source.targetPath,f.source.revision);
  if(level>0){db.prepare('INSERT INTO cases VALUES(?,?,?)').run(id,level,action);db.prepare('INSERT INTO audit VALUES(?,?)').run(id,action);db.prepare('INSERT INTO notices VALUES(?,?)').run(id,action);}
  return pass({...result,duplicate:false});
 });}
 function moderation(c,rows,now){
  try{const projection=dashboardFixture(c,rows,now);const q=previewModeration(c,rows,now);return projection&&q.ok?pass({groups:q.groups,reports:q.reports,projection}):deny('queue_denied');}catch{return deny('queue_denied');}
 }
 function seedAppeal(record,now){return transaction(()=>{
  if(record?.state!=='not_requested'||!appealView(ctx(record.owner,'owner'),record,now))return deny('fixture_denied');
  db.prepare('INSERT INTO appeals VALUES(?,?,?)').run(record.caseId,record.revision,JSON.stringify(record));return pass({state:record.state});
 });}
 function appeal(c,request,now){return transaction(()=>{
  if(!request||!Object.hasOwn(Object.getOwnPropertyDescriptor(request,'caseId')||{},'value')||!fix(request.caseId))return deny('fixture_denied');
  const row=db.prepare('SELECT revision,data FROM appeals WHERE id=?').get(request.caseId);if(!row)return deny('appeal_denied');
  const r=transitionAppeal(c,JSON.parse(row.data),request,now);if(!r.ok||r.enforcementAuthorized!==false)return deny(r.reason||'appeal_denied');
  const changed=db.prepare('UPDATE appeals SET revision=?,data=? WHERE id=? AND revision=?').run(r.record.revision,JSON.stringify(r.record),request.caseId,row.revision);
  if(changed.changes!==1)return deny('revision_conflict');
  const id=request.caseId+':'+r.record.revision;
  db.prepare('INSERT INTO audit VALUES(?,?)').run(id,r.audit.event);db.prepare('INSERT INTO notices VALUES(?,?)').run(id,r.notice.event);
  return pass({state:r.record.state,revision:r.record.revision});
 });}
 function assign(c,id,expectedRevision,reviewer,now){return transaction(()=>{
  // Explicit synthetic coordinator; never an application or Firebase role.
  if(!exact(c,['environment','project','uid','role','authenticated','active','fresh'])||c.environment!==scope.environment||c.project!==scope.project||c.uid!=='fixture_coordinator'||c.role!=='moderator'||c.authenticated!==true||c.active!==true||c.fresh!==true||!fix(id)||!fix(reviewer)||reviewer===c.uid||!Number.isSafeInteger(now))return deny('assignment_denied');
  const row=db.prepare('SELECT revision,data FROM appeals WHERE id=?').get(id);if(!row||row.revision!==expectedRevision||row.revision===Number.MAX_SAFE_INTEGER)return deny('revision_conflict');
  const record=JSON.parse(row.data);
  if(record.state!=='submitted'||record.assignedReviewer!==null||c.uid===record.owner||c.uid===record.originalReviewer||reviewer===record.owner||reviewer===record.originalReviewer||now<=record.updatedAt)return deny('assignment_denied');
  const next={...record,assignedReviewer:reviewer,revision:row.revision+1,updatedAt:now};
  if(!appealView(ctx(reviewer,'moderator'),next,now))return deny('assignment_denied');
  if(db.prepare('UPDATE appeals SET revision=?,data=? WHERE id=? AND revision=?').run(next.revision,JSON.stringify(next),id,row.revision).changes!==1)return deny('revision_conflict');
  db.prepare('INSERT INTO audit VALUES(?,?)').run(id+':'+next.revision,'reviewer_assigned');
  db.prepare('INSERT INTO notices VALUES(?,?)').run(id+':'+next.revision,'reviewer_assigned');
  return pass({state:next.state,revision:next.revision});
 });}
 function view(c,id,now){try{if(!fix(id))return null;const row=db.prepare('SELECT data FROM appeals WHERE id=?').get(id);return row?appealView(c,JSON.parse(row.data),now):null;}catch{return null;}}
 function stats(){return Object.fromEntries(['cases','audit','notices','appeals','receipts','budget'].map(t=>[t,db.prepare('SELECT COUNT(*) AS n FROM '+t).get().n]));}
 return Object.freeze({triage,moderation,seedAppeal,appeal,assign,view,stats,close:()=>db.close()});
}
