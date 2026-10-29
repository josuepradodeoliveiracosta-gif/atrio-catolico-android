import {classify} from './policy.js';

// Shadow QA reads only. No Firestore writes, decisions, notifications or content logs.
// Explicit allowlist keeps the Firebase production project out of QA.
const QA_ID=/^atrio-catolico-qa(?:-[a-z0-9-]+)?$/;
const QA_GROUPS=['posts','replies','reports'];
export function qaShadowAllowed(env={}) {
  const id=env.GUARDIAN_FIREBASE_PROJECT_ID;
  return env.GUARDIAN_V2_TEST_MODE==='true'
    && env.GUARDIAN_V2_QA_SHADOW_READS==='true'
    && env.GUARDIAN_V2_ENABLED==='false'
    && env.GUARDIAN_V2_HOLD_ENABLED==='false'
    && typeof id==='string' && QA_ID.test(id)
    && id.length<=30 && id!=='atrio-catolico'
    && env.GUARDIAN_V2_QA_PROJECT_ID===id;
}
export async function scanQaShadow(reader,env) {
  if(!qaShadowAllowed(env))return {status:'disabled'};
  if(!reader||typeof reader.scan!=='function')throw Error('read_only_reader_required');
  const id=env.GUARDIAN_FIREBASE_PROJECT_ID;
  const prefix='projects/'+id+'/databases/(default)/documents/';
  const counts={clear:0,review:0,hold_candidate:0,warning:0,invalid:0,reports:0,error:0};
  for(const group of QA_GROUPS) {
    try {
      // At most 15 per collection and 20 minutes lookback; never scan old documents.
      const docs=await reader.scan(group,20,15);
      if(!Array.isArray(docs)||docs.length>15)throw Error('invalid_scan_limit');
      for(const d of docs) {
        if(!d?.name?.startsWith(prefix)){counts.invalid++;continue;}
        if(group==='reports'){counts.reports++;continue;}
        const fields=d.fields||{};
        const title=fields.title?.stringValue||'';
        const body=fields.body?.stringValue||'';
        const message=group==='posts'?title+' '+body:body;
        if(!message.trim()){counts.invalid++;continue;}
        const c=classify(message);
        if(c.level in counts)counts[c.level]++;
        else counts.invalid++;
      }
    }catch {
      // Do not emit source content or error details, which might include private data.
      counts.error++;
    }
  }
  return {status:'shadow_read_only',counts};
}
