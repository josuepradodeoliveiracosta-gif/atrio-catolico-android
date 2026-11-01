/**
 * Boundary-level QA firewall for the UNMODIFIED Guardian Firestore REST client.
 *
 * This is a fetch replacement used ONLY by local node tests. It is never
 * imported by a deployed Worker and NEVER contacts Firebase. Unlike a wrapper
 * around processDocument(), it catches a raw Firestore.commit() request at the
 * transport boundary. The existing SQLite fixture barrier authorizes the
 * entire owner/reviewer set before a simulated external write can run.
 *
 * This does NOT protect live Workers, legacy versions, service accounts, or
 * Admin SDK access. Never attach this to a production Worker.
 */
import {createQaGuardianCommitGate} from './qa-guardian-commit-gate.js';

const ROOT='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents';
const RESOURCE='projects/atrio-catolico/databases/(default)/documents';
const UID=new Set(['qa-freeze-alice','qa-freeze-bob']);
const DOC=/^(?:guardian_cases|guardian_audit|guardiao_quarantine)\/[A-Za-z0-9_-]{1,128}$/;
const TARGET=/^posts\/[A-Za-z0-9_-]{1,128}(?:\/replies\/[A-Za-z0-9_-]{1,128})?$/;
const NO_GET=/^guardian_notices\/[A-Za-z0-9_-]{1,128}\/items\/[A-Za-z0-9_-]{1,128}$/;
const deny=()=>{throw Error('qa_guardian_transport_denied');};
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json','cache-control':'no-store'}
});

function normalizeName(name) {
  if(typeof name!=='string'||!name.startsWith(RESOURCE+'/'))deny();
  const suffix=name.slice(RESOURCE.length+1);
  if(!(DOC.test(suffix)||TARGET.test(suffix)||NO_GET.test(suffix)))deny();
  return ROOT+'/'+suffix;
}
function normalizeWrite(w) {
  if(!w||typeof w!=='object'||Array.isArray(w)||
     Number(Boolean(w.update))+Number(Boolean(w.delete))+
       Number(Boolean(w.verify))!==1)deny();
  // An unknown property can mask an operation which the firewall did not see.
  if(Object.keys(w).some(k=>!['update','delete','verify','currentDocument','updateMask'].includes(k)))deny();
  if(w.update) {
    if(!w.update.fields||typeof w.update.fields!=='object'||
       typeof w.update.name!=='string')deny();
    return {...w,update:{...w.update,name:normalizeName(w.update.name)}};
  }
  return w.delete?{...w,delete:normalizeName(w.delete)}:
    {...w,verify:normalizeName(w.verify)};
}
/**
 * getDoc and commit are in-memory fixture operations. The adapter deliberately
 * has no network fallback or wildcard routing, even for GET.
 */
export function createQaGuardianFirestoreTransportFirewall({
  barrier,getDoc,commit,verifyEffect,actorUid=null
}={}) {
  if(typeof getDoc!=='function'||typeof commit!=='function'||
     typeof verifyEffect!=='function'||typeof barrier?.begin!=='function'||
     typeof barrier?.complete!=='function'||
     (actorUid!==null&&!UID.has(actorUid)))deny();
  const gated=createQaGuardianCommitGate({
    db:{resource:ROOT,get:getDoc,commit},barrier,actorUid,verifyEffect
  });
  return Object.freeze(async function firewall(input,init={}) {
    if(typeof input!=='string'||!init||typeof init!=='object')deny();
    // Absolute, single-project URL. No redirects or implied network access.
    if(!input.startsWith(ROOT))deny();
    const method=init.method||'GET';
    if(init.headers?.Authorization!=='Bearer qa-guardian-fixture-token')deny();
    if(method==='GET') {
      if(init.body!==undefined)deny();
      const path=input.slice(ROOT.length);
      if(!path.startsWith('/')||path.includes('%')||
         !DOC.test(path.slice(1))&&!TARGET.test(path.slice(1)))deny();
      const document=await getDoc(path.slice(1));
      return document?json(document):json({error:{status:'NOT_FOUND'}},404);
    }
    if(method!=='POST'||input!==ROOT+':commit'||
       typeof init.body!=='string'||init.body.length>128_000)deny();
    let payload;
    try{payload=JSON.parse(init.body);}catch{deny();}
    if(!payload||Object.keys(payload).join(',')!=='writes'||
       !Array.isArray(payload.writes)||payload.writes.length<2||
       payload.writes.length>12)deny();
    // Gate validates owner identities, moderation case + source consistency,
    // atomic multi-account admission, and post-effect reconciliation.
    const normalized=payload.writes.map(normalizeWrite);
    const outcome=await gated.commit(normalized);
    return json(outcome??{});
  });
}
export const QA_GUARDIAN_TRANSPORT_READINESS=Object.freeze({
  productionIntegrated:false,protectsActualFirestoreTransportInIsolatedTests:true,
  supportsProductionIAM:false,allowsRemoteRequests:false
});
