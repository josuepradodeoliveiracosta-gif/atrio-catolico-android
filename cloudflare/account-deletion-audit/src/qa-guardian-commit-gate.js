/**
 * QA ONLY: intercept actual Guardian V2 Firestore commit operations.
 * No active Worker imports this file; no Firebase, Cloudflare or IAM binding.
 * This test adapter deliberately does NOT expose create/update/delete methods.
 *
 * Never treat this as a production authorization layer. Workers using their
 * original Firestore adapter bypass it; verification is injected by QA tests.
 */
const UIDS=new Set(['qa-freeze-alice','qa-freeze-bob']);
const ROOT='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents';
const REL=/^posts\/[A-Za-z0-9_-]{1,128}(?:\/replies\/[A-Za-z0-9_-]{1,128})?$/;
const CASE=/^(?:guardian_cases|guardian_audit|guardiao_quarantine)\/[A-Za-z0-9_-]{1,128}$/;
const NOTICE=/^guardian_notices\/([A-Za-z0-9_-]{1,128})\/items\/[A-Za-z0-9_-]{1,128}$/;

function checkedUid(uid){
  if(!UIDS.has(uid))throw Error('qa_untrusted_guardian_owner');
  return uid;
}
function strField(x,key){return x?.fields?.[key]?.stringValue||'';}

async function inspectWrites(db,writes) {
  if(!Array.isArray(writes)||writes.length<2||writes.length>12)
    throw Error('qa_invalid_guardian_batch');
  const owners=new Set(),docPaths=[];
  let hasCase=false,hasNotice=false;
  for(const w of writes){
    if(!w || typeof w!=='object' ||
       Number(Boolean(w.update))+Number(Boolean(w.delete))+Number(Boolean(w.verify))!==1)
      throw Error('qa_invalid_guardian_write');
    const name=w.update?.name||w.delete||w.verify;
    if(typeof name!=='string'||!name.startsWith(ROOT+'/'))
      throw Error('qa_guardian_unexpected_path');
    const relative=name.slice(ROOT.length+1);
    const notice=NOTICE.exec(relative);
    if(notice){
      hasNotice=true;owners.add(checkedUid(notice[1]));
      if(!w.update)throw Error('qa_guardian_unexpected_write');
    }else if(CASE.test(relative)){
      if(relative.startsWith('guardian_cases/'))hasCase=true;
      if(!w.update)throw Error('qa_guardian_unexpected_write');
    }else if(REL.test(relative)){
      docPaths.push({relative,write:w});
    }else throw Error('qa_guardian_unexpected_path');
    const fromFields=strField(w.update,'ownerUid');
    if(fromFields)owners.add(checkedUid(fromFields));
  }
  if(!hasCase||!hasNotice||owners.size!==1)
    throw Error('qa_guardian_unscoped_commit');
  const owner=[...owners][0];
  for(const {relative,write} of docPaths){
    if(write.update){
      // A restore includes the original uid. Never trust only a target path.
      if(strField(write.update,'uid')!==owner)
        throw Error('qa_guardian_document_owner_mismatch');
    } else {
      // Verify / delete of a content document must match the ticket owner.
      const document=await db.get(relative);
      if(strField(document,'uid')!==owner)
        throw Error('qa_guardian_document_owner_mismatch');
    }
  }
  return owner;
}

export function createQaGuardianCommitGate({db,barrier,actorUid=null,verifyEffect}={}){
  if(!db || typeof db.get!=='function'||typeof db.commit!=='function'||
     typeof barrier?.begin!=='function'||typeof barrier?.complete!=='function'||
     typeof verifyEffect!=='function'||
     (actorUid!==null&&!UIDS.has(actorUid)))
    throw Error('qa_invalid_guardian_adapter');
  return Object.freeze({
    resource:db.resource||ROOT,
    get:(...args)=>db.get(...args),
    scan:typeof db.scan==='function'?(...args)=>db.scan(...args):undefined,
    scanPage:typeof db.scanPage==='function'?(...args)=>db.scanPage(...args):undefined,
    async commit(writes){
      const ownerUid=await inspectWrites(db,writes);
      if(actorUid===ownerUid)throw Error('qa_guardian_self_review');
      const kind=actorUid?'guardian_review_write':'guardian_content_write';
      const scope=actorUid?{ownerUid,actorUid}:{ownerUid};
      const ticket=await barrier.begin(kind,scope);
      // On ANY failed, partial or ambiguous effect, leave the ticket open.
      const outcome=await db.commit(writes);
      const verified=await verifyEffect({
        kind,ownerUid,actorUid,writeCount:writes.length,
        // Data and moderation text are NOT exposed to the verifier.
        commitFinished:outcome!==undefined
      });
      if(verified!==true)throw Error('qa_guardian_commit_unverified');
      await barrier.complete(ticket,{verified:async()=>true});
      return outcome;
    },
    async update(){throw Error('qa_unguarded_guardian_update');},
    async create(){throw Error('qa_unguarded_guardian_create');}
  });
}
