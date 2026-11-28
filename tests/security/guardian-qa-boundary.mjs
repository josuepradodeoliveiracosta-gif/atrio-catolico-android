// Client-SDK transactions against the dedicated demo Rules. No Admin SDK, IAM,
// service-account token, HTTP endpoint, scheduler or automatic deployment.
// Import only from tests after initializeTestEnvironment binds to loopback.
import {doc,runTransaction,serverTimestamp} from 'firebase/firestore';
import {classify,decide} from '../../cloudflare/guardian-worker/src/policy.js';
const fix=s=>typeof s==='string'&&/^fixture_[A-Za-z0-9_-]{1,64}$/.test(s);
function demo(db) {
  if(db?.app?.options?.projectId!=='demo-atrio-guardian-boundary'||
      process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
      process.env.GOOGLE_APPLICATION_CREDENTIALS||
      process.env.GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON||
      process.env.GUARDIAN_V2_ENABLED) throw Error('demo_only');
}
export async function setQaPolicy(db,enabled) {
  demo(db);
  if(typeof enabled!=='boolean')throw Error('invalid_policy');
  const ref=doc(db,'qa_guardian_control','policy');
  return runTransaction(db,async tx=>{
    const current=await tx.get(ref);
    if(!current.exists())throw Error('policy_missing');
    if(current.data().enabled===enabled)return 'unchanged';
    tx.update(ref,{enabled});
    return 'updated';
  });
}
export async function proposeQaCase(db,id) {
  demo(db);
  if(!fix(id))throw Error('invalid_fixture');
  const policy=doc(db,'qa_guardian_control','policy'),budget=doc(db,'qa_guardian_control','budget');
  const source=doc(db,'qa_guardian_sources',id),target=doc(db,'qa_guardian_cases',id);
  return runTransaction(db,async tx=>{
    const [p,b,s,c]=await Promise.all([tx.get(policy),tx.get(budget),tx.get(source),tx.get(target)]);
    if(!p.exists()||!b.exists()||!s.exists())throw Error('missing_fixture');
    const x=p.data(),y=b.data(),z=s.data();
    if(x.enabled!==true||x.approved!==true||x.emergencyStop!==false||x.allowHold!==false)throw Error('policy_closed');
    if(z.qaFixture!==true||!fix(z.ownerUid)||!Number.isSafeInteger(z.revision)||z.revision<0||typeof z.body!=='string'||z.body.length>4000)throw Error('invalid_source');
    if(c.exists())return 'duplicate';
    if(!Number.isSafeInteger(y.used)||y.used<0||y.used>=12)throw Error('budget_exhausted');
    const action=decide(classify(z.body,{}));
    if(action==='clear')return 'clear';
    if(!['warn','review'].includes(action))throw Error('invalid_classification');
    // Both warning and review are merely proposals for independent human review.
    tx.set(target,{sourceId:id,sourceRevision:z.revision,ownerUid:z.ownerUid,status:'review',createdAt:serverTimestamp()});
    tx.set(doc(db,'qa_guardian_audit',id),{caseId:id,event:'review_requested',actor:'fixture_triage',at:serverTimestamp()});
    tx.set(doc(db,'qa_guardian_notices',id),{caseId:id,recipient:z.ownerUid,event:'review_requested',at:serverTimestamp()});
    tx.update(budget,{used:y.used+1,lastCase:id,updatedAt:serverTimestamp()});
    return 'proposed';
  });
}
