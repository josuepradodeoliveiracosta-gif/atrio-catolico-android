// Guardião V2: ativação controlada da política Firestore via GitHub OIDC.
// O Termux usa apenas 'gh workflow run'; nenhuma credencial Google é copiada.
// Não altera emergencyStop, allowHold, regras, casos ou conteúdo de usuários.
const REPO='josuepradodeoliveiracosta-gif/atrio-catolico-android';
const WORKFLOW=REPO+'/.github/workflows/guardiao-v2-moderator-runner.yml@refs/heads/main';
const URL='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents/guardian_config/policy';
const NAME='projects/atrio-catolico/databases/(default)/documents/guardian_config/policy';
const fail=reason=>{throw Error('guardian_v2_policy_'+reason);};

function requireContext(e){
  if(e.GITHUB_REPOSITORY!==REPO ||
     e.GITHUB_REF!=='refs/heads/main' ||
     e.GITHUB_WORKFLOW_REF!==WORKFLOW ||
     e.GITHUB_EVENT_NAME!=='workflow_dispatch' ||
     e.GITHUB_RUN_ATTEMPT!=='1' ||
     e.GUARDIAN_V2_CONFIRM_POLICY_ACTIVATION!=='true' ||
     e.GUARDIAN_V2_WRITER_ENABLED!=='true' ||
     e.GUARDIAN_V2_WRITER_APPROVED!=='true' ||
     e.GUARDIAN_V2_HOLD_ENABLED!=='false' ||
     e.GUARDIAN_V2_WRITER_SERVICE_ACCOUNT!=='guardian-v2-writer@atrio-catolico.iam.gserviceaccount.com' ||
     typeof e.WIF_ACCESS_TOKEN!=='string'||e.WIF_ACCESS_TOKEN.length<20)
    fail('context_denied');
}

async function checkedRequest(url,method,access,body){
  let response;
  try {
    response=await fetch(url,{method,headers:{
      Authorization:'Bearer '+access,
      Accept:'application/json',
      'Content-Type':'application/json'
    },body:body?JSON.stringify(body):undefined,redirect:'error',
    signal:AbortSignal.timeout(12000)});
  }catch{fail('network_unavailable');}
  // Erros da API podem conter dados internos: nunca imprimir corpo ou URL.
  if(response.status!==200){
    if([401,403].includes(response.status))fail('iam_denied');
    if(response.status===404)fail('policy_missing');
    if([409,412].includes(response.status))fail('concurrent_policy_change');
    fail('firestore_http_'+String(response.status));
  }
  let data;
  try {
    const text=await response.text();
    if(text.length>50000)fail('response_too_large');
    data=JSON.parse(text);
  }catch(e){
    if(e?.message==='guardian_v2_policy_response_too_large')throw e;
    fail('invalid_response');
  }
  if(!data||typeof data!=='object'||data.name!==NAME ||
     typeof data.updateTime!=='string')fail('invalid_policy_document');
  return data;
}

export async function activatePolicy(e=process.env){
  requireContext(e);
  const doc=await checkedRequest(URL,'GET',e.WIF_ACCESS_TOKEN);
  const fields=doc.fields||{};
  const required=['enabled','emergencyStop','allowHold'];
  if(required.some(k=>typeof fields[k]?.booleanValue!=='boolean') ||
     fields.emergencyStop.booleanValue!==false ||
     fields.allowHold.booleanValue!==false ||
     (fields.autonomousWriteEnabled!==undefined &&
      typeof fields.autonomousWriteEnabled.booleanValue!=='boolean'))
    fail('blocked_by_safety_policy');
  if(fields.enabled.booleanValue===true &&
     fields.autonomousWriteEnabled?.booleanValue===true)
    return 'ALREADY_ENABLED';

  const u=new URL(URL);
  u.searchParams.append('updateMask.fieldPaths','enabled');
  u.searchParams.append('updateMask.fieldPaths','autonomousWriteEnabled');
  u.searchParams.set('currentDocument.updateTime',doc.updateTime);
  const patch={name:NAME,fields:{
    enabled:{booleanValue:true},
    autonomousWriteEnabled:{booleanValue:true}
  }};
  const updated=await checkedRequest(u.toString(),'PATCH',e.WIF_ACCESS_TOKEN,patch);
  if(updated.fields?.enabled?.booleanValue!==true ||
     updated.fields?.autonomousWriteEnabled?.booleanValue!==true ||
     updated.fields?.allowHold?.booleanValue!==false ||
     updated.fields?.emergencyStop?.booleanValue!==false)
    fail('unexpected_postcondition');
  return 'ENABLED_NONPUNITIVE';
}

if(process.argv[1] && import.meta.url==='file://'+process.argv[1]){
  activatePolicy().then(status=>console.log('GUARDIAN_V2_POLICY',status))
    .catch(e=>{
      console.error('GUARDIAN_V2_POLICY_DENIED',
        /^guardian_v2_policy_[a-z0-9_]+$/.test(e?.message||'')
          ?e.message:'guardian_v2_policy_failed_closed');
      process.exitCode=1;
    });
}
