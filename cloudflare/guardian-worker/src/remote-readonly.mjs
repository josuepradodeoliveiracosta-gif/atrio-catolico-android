// GitHub Actions only: no service-account JSON, writes, or sensitive logs.
import {Firestore} from './firestore.js';
import {scanQaShadow} from './shadow-qa.js';
import {validateRemoteQa,validateShadowOutcome} from './remote-gate.js';
async function main(){
  const id=validateRemoteQa(process.env);
  const db=new Firestore(process.env.QA_ACCESS_TOKEN,id);
  const env={
    GUARDIAN_V2_TEST_MODE:'true',
    GUARDIAN_V2_ENABLED:'false',
    GUARDIAN_V2_HOLD_ENABLED:'false',
    GUARDIAN_V2_QA_SHADOW_READS:'true',
    GUARDIAN_FIREBASE_PROJECT_ID:id,
    GUARDIAN_V2_QA_PROJECT_ID:id
  };
  const r=await scanQaShadow({scan:(...args)=>db.scanQa(...args)},env);
  const counts=validateShadowOutcome(r);
  console.log('guardian_qa_readonly_counts',JSON.stringify(counts));
}
main().catch(()=>{console.error('guardian_qa_remote_unavailable');process.exitCode=1;});
