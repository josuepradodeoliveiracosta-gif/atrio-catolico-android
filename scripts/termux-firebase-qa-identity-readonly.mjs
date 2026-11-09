#!/usr/bin/env node
// Identidade Firebase do QA real: somente dois GETs em metadados publicos do projeto QA.
// Executar no Termux autenticado com Firebase CLI; nunca publica Rules, tokens ou APKs.
import {fileURLToPath} from 'node:url';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';

const PROJECT='atrio-catolico-qa-geral';
const PACKAGE='br.com.atriocatolico.chatqa';
const BASE='https://firebase.googleapis.com/v1beta1/';
const PROJECT_PATH='projects/'+PROJECT;
const fail=code=>{throw Error('qa_firebase_identity_'+code);};

async function readOnly(path,token,fetcher) {
  // Não aceitar URLs fornecidas pelo servidor nem navegar para outros projetos.
  if(path!==PROJECT_PATH && !/^projects\/atrio-catolico-qa-geral\/androidApps\/1:[0-9]+:android:[a-fA-F0-9]+$/.test(path))
    fail('endpoint_denied');
  let response;
  try {
    response=await fetcher(BASE+path,{
      method:'GET',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(12000)
    });
  }catch{fail('network_error');}
  if(!response?.ok)fail('access_denied');
  let data;
  try {
    const raw=await response.text();
    if(raw.length>65536)fail('response_oversize');
    data=JSON.parse(raw);
  }catch(e){
    if(e?.message==='qa_firebase_identity_response_oversize')throw e;
    fail('invalid_response');
  }
  if(!data||typeof data!=='object'||Array.isArray(data))fail('invalid_response');
  return data;
}

export async function inspectFirebaseQaIdentity({
  expectedAppId,
  tokenProvider=accessTokenFromExistingFirebaseCli,
  fetcher=fetch
}={}) {
  if(typeof expectedAppId!=='string'||
     !/^1:[0-9]+:android:[a-fA-F0-9]+$/.test(expectedAppId))
    fail('expected_app_id_required');
  const senderId=expectedAppId.split(':')[1];
  let token;
  try {token=await tokenProvider();} catch {fail('local_cli_login_unavailable');}
  if(typeof token!=='string'||token.length<20||token.length>12000)
    fail('local_cli_login_unavailable');

  // A primeira consulta precisa provar a identidade do projeto.
  const project=await readOnly(PROJECT_PATH,token,fetcher);
  if(project.name!==PROJECT_PATH||project.projectId!==PROJECT||
     String(project.projectNumber)!==senderId||project.state!=='ACTIVE')
    fail('qa_project_metadata_mismatch');
  // Só então conferir o aplicativo explicitamente nomeado: nunca listar apps
  // de outros projetos ou obter google-services.json pela API.
  const appPath=PROJECT_PATH+'/androidApps/'+expectedAppId;
  const app=await readOnly(appPath,token,fetcher);
  if(app.name!==appPath||app.appId!==expectedAppId||
     app.projectId!==PROJECT||app.packageName!==PACKAGE||app.state!=='ACTIVE')
    fail('qa_android_app_metadata_mismatch');
  return {
    status:'firebase_qa_identity_readonly_confirmed',
    firebase_project_id:PROJECT,
    firebase_project_number:senderId,
    firebase_android_app_id:expectedAppId,
    android_package:PACKAGE,
    api_calls:'GET project + GET androidApp',
    cloud_metadata_verified:true,
    config_file_verified_here:false,
    firestore_rules_verified_here:false,
    authentication_verified_here:false,
    fcm_verified_here:false,
    deploy_performed:false,
    production_contacted:false
  };
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==2)fail('arguments_denied');
    const data=await inspectFirebaseQaIdentity({
      expectedAppId:process.env.ATRIO_CHAT_QA_APP_ID
    });
    console.log(JSON.stringify(data,null,2));
  }catch(e) {
    console.error(/^qa_firebase_identity_[a-z0-9_]+$/.test(e?.message||'')
      ?e.message:'qa_firebase_identity_failed_closed');
    process.exitCode=1;
  }
}
