/**
 * QA ONLY: allow the actual Guardian paged scanner to persist ONLY its
 * fixed global scan checkpoints. The existing QA Guardian commit gate still
 * controls ALL user-related writes and their SQLite freeze tickets.
 *
 * This is not imported by live Workers and does not enable server IAM.
 */
import {createQaGuardianCommitGate} from './qa-guardian-commit-gate.js';

const ROOT='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents';
const SCANS=Object.freeze({
  'guardian_runtime/scan_posts':{group:'posts',field:'createdAt'},
  'guardian_runtime/scan_replies':{group:'replies',field:'createdAt'},
  'guardian_runtime/scan_reports':{group:'reports',field:'createdAt'},
  'guardian_runtime/scan_post_edits':{group:'posts',field:'updatedAt'}
});
const FIELDS='cursorName,cursorTime,mode,windowEnd,windowStart';
const iso=s=>typeof s==='string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(s) &&
  Number.isFinite(Date.parse(s));
const deny=reason=>{throw Error('qa_guardian_checkpoint_'+reason);};
function read(fields,key){
  const field=fields?.[key];
  if(!field||typeof field!=='object'||Array.isArray(field)||
     Object.keys(field).join(',')!=='stringValue'||
     typeof field.stringValue!=='string')deny('invalid_fields');
  return field.stringValue;
}
function checkCheckpoint(path,fields){
  const scan=SCANS[path];
  if(!scan)deny('unlisted_path');
  if(!fields || Object.keys(fields).sort().join(',')!==FIELDS)
    deny('invalid_fields');
  const mode=read(fields,'mode');
  const start=read(fields,'windowStart');
  const end=read(fields,'windowEnd');
  const name=read(fields,'cursorName');
  const time=read(fields,'cursorTime');
  if(!['running','complete'].includes(mode) || !iso(start) ||
     !iso(end)||Date.parse(start)>Date.parse(end)||
     (!name)!==(!time)|| (mode==='complete'&&name!==''))
    deny('invalid_state');
  if(name){
    if(!iso(time)||Date.parse(time)<Date.parse(start)||
       Date.parse(time)>Date.parse(end))
      deny('invalid_cursor');
    const suffix=name.startsWith(ROOT+'/')?name.slice(ROOT.length+1):'';
    const pathMatch=scan.group==='replies'
      ?/^posts\/[A-Za-z0-9_-]{1,128}\/replies\/[A-Za-z0-9_-]{1,128}$/
      :new RegExp('^'+scan.group+'/[A-Za-z0-9_-]{1,128}$');
    if(!pathMatch.test(suffix))deny('invalid_cursor');
  }
  return Object.freeze({mode,start,end,name,time});
}
function checkTransition(before,after){
  if(before.mode==='complete'){
    if(after.mode!=='running'||after.name!==''||
       Date.parse(after.end)<Date.parse(before.end))
      deny('invalid_transition');
  }else{
    if(after.start!==before.start||after.end!==before.end ||
       (after.mode==='running'&&after.name===before.name))
      deny('invalid_transition');
  }
}
export function createQaGuardianPagedCheckpointGate({db,barrier,verifyEffect}={}){
  if(!db || db.resource!==ROOT || typeof db.get!=='function' ||
     typeof db.scanPage!=='function'||typeof db.create!=='function'||
     typeof db.update!=='function'||typeof db.commit!=='function' ||
     typeof verifyEffect!=='function'||
     typeof barrier?.begin!=='function')
    deny('invalid_qa_fixture');
  const content=createQaGuardianCommitGate({db,barrier,verifyEffect});
  return Object.freeze({
    resource:ROOT,
    get:content.get,
    commit:content.commit,
    scanPage:(group,options)=>{
      if(!['posts','replies','reports'].includes(group)||
         !['createdAt','updatedAt'].includes(options?.field)||
         (options.field==='updatedAt'&&group!=='posts'))
        deny('invalid_scan');
      return db.scanPage(group,options);
    },
    async create(path,fields){
      const to=checkCheckpoint(path,fields);
      if(to.mode!=='running'||to.name!=='')deny('invalid_create');
      if(await db.get(path))deny('checkpoint_exists');
      return db.create(path,fields);
    },
    async update(path,fields,expectedVersion){
      const to=checkCheckpoint(path,fields);
      if(typeof expectedVersion!=='string'||!expectedVersion)
        deny('missing_version');
      const previous=await db.get(path);
      if(!previous||previous.updateTime!==expectedVersion)
        deny('stale_version');
      const from=checkCheckpoint(path,previous.fields);
      checkTransition(from,to);
      return db.update(path,fields,expectedVersion);
    }
  });
}
export const QA_GUARDIAN_CHECKPOINT_READINESS=Object.freeze({
  productionIntegrated:false,privilegedWorkerProtected:false,
  scope:'only four fixed QA scan checkpoints'
});
