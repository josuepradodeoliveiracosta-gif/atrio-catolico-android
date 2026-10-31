export function validateRemoteQa(env={}) {
  const id=env.QA_FIREBASE_PROJECT_ID;
  if(env.GUARDIAN_QA_REMOTE_READY!=='true')throw Error('remote_qa_not_authorized');
  if(typeof id!=='string'||!/^(atrio-catolico-qa)(?:-[a-z0-9-]+)?$/.test(id)||id.length>30)
    throw Error('invalid_qa_project');
  if(id!==env.QA_APPROVED_PROJECT_ID)throw Error('unapproved_qa_project');
  if(typeof env.QA_ACCESS_TOKEN!=='string'||env.QA_ACCESS_TOKEN.length<20)
    throw Error('qa_credentials_unavailable');
  return id;
}
export function validateShadowOutcome(result) {
  if(result?.status!=='shadow_read_only'||!result.counts||result.counts.error!==0)
    throw Error('qa_query_failed');
  const c=result.counts;
  if(!['clear','review','hold_candidate','warning','reports'].every(k=>
      Number.isSafeInteger(c[k]) && c[k]>=0))throw Error('qa_counts_invalid');
  if(c.clear+c.review+c.hold_candidate+c.warning+c.reports===0)
    throw Error('qa_synthetic_fixtures_missing');
  return c;
}
