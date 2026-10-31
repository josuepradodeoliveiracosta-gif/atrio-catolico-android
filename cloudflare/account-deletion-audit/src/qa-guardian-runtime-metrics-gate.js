/**
 * QA ONLY: the Guardian Cron writes one global, aggregate-only
 * guardian_runtime/last_scan telemetry document. No account fields, content,
 * IAM, network, actual Cloudflare Cron or live Firebase write is enabled.
 *
 * User-owned moderation documents remain governed by the separate
 * Guardian commit gate and its durable fixture barrier. This layer accepts
 * ONLY the global metrics path and only the exact schema used by the Worker.
 */
import {createQaGuardianPagedCheckpointGate}
  from './qa-guardian-paged-checkpoint-gate.js';

const PATH='guardian_runtime/last_scan';
const KEYS=['backlogGroups','changed','error','pausedGroups','review','scannedAt','warn'];
const COUNTERS=KEYS.filter(key=>key!=='scannedAt');
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const deny=code=>{throw Error('qa_guardian_metrics_'+code);};
function checkTime(s){
  if(typeof s!=='string'||!ISO.test(s)||
     !Number.isFinite(Date.parse(s)))deny('invalid_timestamp');
  return Date.parse(s);
}
function checkFields(path,fields){
  if(path!==PATH)deny('path_denied');
  if(!fields||typeof fields!=='object'||Array.isArray(fields)||
     Object.keys(fields).sort().join(',')!==KEYS.join(','))
    deny('invalid_schema');
  const stamp=fields.scannedAt;
  if(!stamp||typeof stamp!=='object'||Array.isArray(stamp)||
     Object.keys(stamp).join(',')!=='timestampValue')
    deny('invalid_timestamp');
  const time=checkTime(stamp.timestampValue);
  for(const key of COUNTERS){
    const field=fields[key];
    if(!field||typeof field!=='object'||Array.isArray(field)||
       Object.keys(field).join(',')!=='integerValue'||
       typeof field.integerValue!=='string'||
       !/^(0|[1-9][0-9]{0,3})$/.test(field.integerValue)||
       Number(field.integerValue)>500)
      deny('invalid_counter');
  }
  return time;
}
/** Pure QA mirror of the exact aggregate shape in Guardian scheduled(). */
export function qaBuildGuardianScanMetrics(metrics,isoTime){
  checkTime(isoTime);
  if(!metrics||typeof metrics!=='object'||Array.isArray(metrics)||
     metrics.status==='disabled')deny('invalid_scan_result');
  const fields={scannedAt:{timestampValue:isoTime}};
  for(const k of COUNTERS){
    const v=metrics[k]??0;
    if(!Number.isInteger(v)||v<0||v>500)
      deny('invalid_counter');
    fields[k]={integerValue:String(v)};
  }
  checkFields(PATH,fields);
  return Object.freeze(fields);
}
export function createQaGuardianRuntimeMetricsGate({db,barrier,verifyEffect}={}){
  const checkpoints=createQaGuardianPagedCheckpointGate({
    db,barrier,verifyEffect
  });
  return Object.freeze({
    ...checkpoints,
    async create(path,fields){
      if(path!==PATH)return checkpoints.create(path,fields);
      const next=checkFields(path,fields);
      if(await db.get(PATH))deny('existing_metrics');
      return db.create(PATH,fields);
    },
    async update(path,fields,expectedVersion){
      if(path!==PATH)return checkpoints.update(path,fields,expectedVersion);
      const next=checkFields(path,fields);
      if(typeof expectedVersion!=='string'||!expectedVersion)
        deny('missing_version');
      const old=await db.get(PATH);
      if(!old||old.updateTime!==expectedVersion)deny('stale_version');
      const previous=checkFields(PATH,old.fields);
      if(next<previous)deny('time_rollback');
      return db.update(PATH,fields,expectedVersion);
    }
  });
}
export const QA_GUARDIAN_METRICS_READINESS=Object.freeze({
  productionIntegrated:false,
  metricsOnly:true,
  userWritesProtectedInProduction:false
});
