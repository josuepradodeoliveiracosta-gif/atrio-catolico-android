/**
 * QA ONLY — conservative source inventory of privileged write *candidates*.
 * This is a change-detection tripwire, not a JavaScript parser, IAM or a
 * distributed freeze. No production Worker imports this module.
 *
 * Methods can be added in helpers, dynamic dispatch or external modules;
 * a human must review the ENTIRE data-flow, not just passing this inventory.
 */
const REGISTRY=Object.freeze([
  {kind:'network_fetch',pattern:/\bfetch\s*\(/g},
  {kind:'d1_prepare',pattern:/\.prepare\s*\(/g},
  {kind:'firestore_commit',pattern:/\bdb\.commit\s*\(/g},
  {kind:'cloudinary_signed',pattern:/\bcloudSigned\s*\(/g},
  {kind:'firestore_photo_mutator',pattern:/\bfirestore(?:Put|Delete)\s*\(/g},
  {kind:'fcm_send_helper',pattern:/\bsend\s*\(/g},
  {kind:'invalid_device_cleanup',pattern:/\bcleanupInvalidDevice\s*\(/g}
]);
export const QA_WORKERS=Object.freeze([
  'avatar-worker','guardian-worker','push-worker'
]);
function isCode(line) {
  const trimmed=line.trim();
  return trimmed!=='' && !trimmed.startsWith('//') &&
    !trimmed.startsWith('*') && !trimmed.startsWith('/*');
}
/** Snapshots are syntactic review alarms, NOT permission for a Worker to write. */
export function extractQaWorkerSinks(worker,source) {
  if(!QA_WORKERS.includes(worker)||typeof source!=='string'||source.length===0)
    throw Error('qa_invalid_source');
  const lines=source.split('\n');
  const entries=[];
  for(let index=0;index<lines.length;index++){
    const raw=lines[index];
    if(!isCode(raw))continue;
    const code=raw.trim().replace(/\s+/g,' ');
    for(const rule of REGISTRY){
      rule.pattern.lastIndex=0;
      const matches=[...code.matchAll(rule.pattern)];
      for(const _ of matches) {
        // Exclude only the declaration of the matched helper itself.
        // A new call INSIDE a one-line function must still be detected.
        const declared={
          cloudinary_signed:/^(?:export\s+)?(?:async\s+)?function\s+cloudSigned\s*\(/,
          firestore_photo_mutator:/^(?:export\s+)?(?:async\s+)?function\s+firestore(?:Put|Delete)\s*\(/,
          fcm_send_helper:/^(?:export\s+)?(?:async\s+)?function\s+send\s*\(/,
          invalid_device_cleanup:/^(?:export\s+)?(?:async\s+)?function\s+cleanupInvalidDevice\s*\(/
        };
        if(rule.kind==='network_fetch'&&/^(?:async\s+)?fetch\s*\(/.test(code))
          continue;
        if(declared[rule.kind]?.test(code))continue;
        entries.push({worker,kind:rule.kind,code});
      }
    }
  }
  return entries.sort((a,b)=>a.kind.localeCompare(b.kind,'en')||
    a.code.localeCompare(b.code,'en'));
}
export function compareQaWorkerSinks(observed,approved) {
  if(!Array.isArray(observed)||!Array.isArray(approved) ||
    !observed.every(x=>QA_WORKERS.includes(x?.worker)&&typeof x.code==='string'&&
      typeof x.kind==='string')||
    !approved.every(x=>QA_WORKERS.includes(x?.worker)&&typeof x.code==='string'&&
      typeof x.kind==='string'))
    throw Error('qa_invalid_sink_manifest');
  const key=x=>JSON.stringify([x.worker,x.kind,x.code]);
  const tally=entries=>{
    const out=new Map();
    for(const entry of entries) {
      const k=key(entry);
      out.set(k,(out.get(k)||0)+1);
    }
    return out;
  };
  const a=tally(observed),b=tally(approved);
  const added=[...a].filter(([k,v])=>v>(b.get(k)||0)).map(([k])=>k);
  const missing=[...b].filter(([k,v])=>v>(a.get(k)||0)).map(([k])=>k);
  return {reviewNeeded:added.length>0||missing.length>0,
    newlyObserved:added,missingFromSource:missing,
    totalObserved:observed.length,totalApproved:approved.length,
    // A matching snapshot is never evidence of privileged-write guarding.
    productionProtected:false};
}
