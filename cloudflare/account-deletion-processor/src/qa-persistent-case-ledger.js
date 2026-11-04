/**
 * LOCAL QA ONLY. A persistent SQLite journal binds a synthetic UID to one
 * deletion request, ordered checkpoints and a fencing epoch.
 *
 * An interrupted lease cannot resume automatically: a separate synthetic
 * reconciler must explicitly approve recovery after independent readback.
 * No external API, credential, Cloudflare D1 or production identity.
 */
import {DatabaseSync} from 'node:sqlite';
import {realpathSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import {CONTROLLED_DELETION_PHASES} from './controlled-executor.js';

const PROJECT='demo-atrio-v11';
const UIDS=new Set(['qa-delete-alice','qa-delete-candidate',
  'qa-delete-neighbor','qa-delete-observer']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TABLE='qa_controlled_case_ledger';
const FIELDS='uid,case_id,epoch,state,completed_json,updated_ms';
const REVIEW_TABLE='qa_signed_reviewer_receipts';
const REVIEW_FIELDS='nonce,uid,case_id,epoch,purpose,phase,created_ms';
const DDL=[
  'CREATE TABLE IF NOT EXISTS '+TABLE+' (',
  "uid TEXT PRIMARY KEY NOT NULL CHECK(uid IN ('qa-delete-alice','qa-delete-candidate',"+
  "'qa-delete-neighbor','qa-delete-observer')),",
  'case_id TEXT NOT NULL, epoch INTEGER NOT NULL CHECK(epoch>=1),',
  "state TEXT NOT NULL CHECK(state IN ('active','recovery_approved','complete')),",
  'completed_json TEXT NOT NULL, updated_ms INTEGER NOT NULL CHECK(updated_ms>0)) STRICT'
].join(' ');
const deny=reason=>{throw Error('qa_persistent_ledger_'+reason);};

function allowedDb(db){
  if(!(db instanceof DatabaseSync))deny('sqlite_required');
  const list=db.prepare('PRAGMA database_list').all();
  if(list.length!==1||list[0].name!=='main'||!list[0].file)
    deny('durable_unattached_database_required');
  const file=list[0].file;
  let path,folder;
  try{path=realpathSync(file);folder=realpathSync(dirname(path));}
  catch{deny('unknown_database_path');}
  if(file!==path||basename(path)!=='ledger.sqlite'||
     !folder.startsWith(join(tmpdir(),'atrio-qa-delete-ledger-'))||
     !/^atrio-qa-delete-ledger-[A-Za-z0-9]{6,}$/.test(basename(folder)))
    deny('non_qa_database_path');
  const dirStat=statSync(folder),fileStat=statSync(path);
  if(!dirStat.isDirectory()||!fileStat.isFile()||
     (dirStat.mode&0o077)!==0||(fileStat.mode&0o077)!==0)
    deny('insecure_database_permissions');
  const objects=db.prepare(
    "SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
  ).all();
  const expected=new Map([[TABLE,FIELDS],[REVIEW_TABLE,REVIEW_FIELDS]]);
  if(objects.length>expected.size||objects.some(x=>
    !expected.has(x.name)||x.type!=='table'))
    deny('unexpected_schema');
  for(const item of objects){
    const names=db.prepare('PRAGMA table_info('+item.name+')').all()
      .map(x=>x.name).join(',');
    if(names!==expected.get(item.name))deny('schema_drift');
  }
}
function validCase(ctx){
  if(!ctx||Object.getPrototypeOf(ctx)!==Object.prototype||
     !UIDS.has(ctx.uid)||typeof ctx.caseId!=='string'||!UUID.test(ctx.caseId))
    deny('unapproved_case');
}
function decode(value){
  let items;
  try{items=JSON.parse(value);}catch{deny('invalid_checkpoint');}
  if(!Array.isArray(items)||
     items.length>CONTROLLED_DELETION_PHASES.length||
     items.some((x,i)=>x!==CONTROLLED_DELETION_PHASES[i]))
    deny('invalid_checkpoint');
  return items;
}
function checked(row,ctx){
  if(row.case_id!==ctx.caseId)deny('case_id_changed');
  if(!Number.isSafeInteger(row.epoch)||row.epoch<1||
     !Number.isSafeInteger(row.updated_ms)||row.updated_ms<1||
     !['active','recovery_approved','complete'].includes(row.state))
    deny('invalid_row');
  const done=decode(row.completed_json);
  if((row.state==='complete')!==
     (done.length===CONTROLLED_DELETION_PHASES.length))
    deny('invalid_completion');
  return done;
}
function transaction(db,fn){
  db.exec('BEGIN IMMEDIATE');
  try{const result=fn();db.exec('COMMIT');return result;}
  catch(error){db.exec('ROLLBACK');throw error;}
}

export function createQaPersistentDeletionLedger({projectId,db}={}){
  if(projectId!==PROJECT)deny('real_project_denied');
  allowedDb(db);
  db.exec(DDL);
  const ready=()=>allowedDb(db);
  const read=uid=>db.prepare('SELECT '+FIELDS+' FROM '+TABLE+' WHERE uid=?')
    .get(uid)||null;
  return Object.freeze({
    async acquire(ctx){
      validCase(ctx);ready();
      return transaction(db,()=>{
        const row=read(ctx.uid);
        if(!row){
          db.prepare('INSERT INTO '+TABLE+
            " (uid,case_id,epoch,state,completed_json,updated_ms) VALUES (?,?,1,'active','[]',?)")
            .run(ctx.uid,ctx.caseId,Date.now());
          return {epoch:1,completed:[]};
        }
        const completed=checked(row,ctx);
        if(row.state==='active')deny('active_case_needs_review');
        if(row.state==='complete')return {epoch:row.epoch,completed};
        if(row.epoch>=Number.MAX_SAFE_INTEGER)deny('epoch_exhausted');
        const result=db.prepare('UPDATE '+TABLE+
          " SET epoch=epoch+1,state='active',updated_ms=? WHERE uid=? AND case_id=? AND epoch=? AND state='recovery_approved'")
          .run(Date.now(),ctx.uid,ctx.caseId,row.epoch);
        if(result.changes!==1)deny('recovery_race');
        return {epoch:row.epoch+1,completed};
      });
    },
    async check(ctx){
      validCase(ctx);ready();
      if(!Number.isSafeInteger(ctx.epoch)||ctx.epoch<1)return false;
      const row=read(ctx.uid);
      if(!row||row.case_id!==ctx.caseId)return false;
      const done=checked(row,ctx);
      return row.epoch===ctx.epoch&&
        (row.state==='active'||(row.state==='complete'&&
         done.length===CONTROLLED_DELETION_PHASES.length));
    },
    async complete(ctx){
      validCase(ctx);ready();
      if(!Number.isSafeInteger(ctx.epoch)||ctx.epoch<1||
         typeof ctx.phase!=='string')return false;
      return transaction(db,()=>{
        const row=read(ctx.uid);
        if(!row||row.case_id!==ctx.caseId||row.epoch!==ctx.epoch||
           row.state!=='active')return false;
        const done=checked(row,ctx);
        if(CONTROLLED_DELETION_PHASES[done.length]!==ctx.phase)return false;
        const next=[...done,ctx.phase];
        const state=next.length===CONTROLLED_DELETION_PHASES.length?
          'complete':'active';
        const result=db.prepare('UPDATE '+TABLE+
          " SET completed_json=?,state=?,updated_ms=? WHERE uid=? AND case_id=? AND epoch=? AND state='active' AND completed_json=?")
          .run(JSON.stringify(next),state,Date.now(),ctx.uid,ctx.caseId,
            ctx.epoch,row.completed_json);
        return result.changes===1;
      });
    },
    async approveRecovery(ctx,{independentReview}={}){
      validCase(ctx);ready();
      if(typeof independentReview!=='function')deny('review_required');
      const before=read(ctx.uid);
      if(!before)deny('case_missing');
      const done=checked(before,ctx);
      if(before.state!=='active')deny('case_not_interrupted');
      const snapshot=Object.freeze({uid:ctx.uid,caseId:ctx.caseId,
        epoch:before.epoch,completed:Object.freeze([...done])});
      if(await independentReview(snapshot)!==true)deny('review_rejected');
      ready();
      return transaction(db,()=>{
        const row=read(ctx.uid);
        if(!row)deny('case_lost');
        checked(row,ctx);
        if(row.epoch!==before.epoch||row.state!=='active'||
           row.completed_json!==before.completed_json)
          deny('review_stale');
        const result=db.prepare('UPDATE '+TABLE+
          " SET state='recovery_approved',updated_ms=? WHERE uid=? AND case_id=? AND epoch=? AND state='active' AND completed_json=?")
          .run(Date.now(),ctx.uid,ctx.caseId,before.epoch,before.completed_json);
        if(result.changes!==1)deny('review_race');
        return {status:'qa_recovery_approved',productionApproved:false,
          externalEffectsVerified:false};
      });
    },
    async status(ctx){
      validCase(ctx);ready();
      const row=read(ctx.uid);
      if(!row)return null;
      const done=checked(row,ctx);
      return Object.freeze({state:row.state,epoch:row.epoch,
        completed:Object.freeze([...done]),productionReady:false});
    }
  });
}
