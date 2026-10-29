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