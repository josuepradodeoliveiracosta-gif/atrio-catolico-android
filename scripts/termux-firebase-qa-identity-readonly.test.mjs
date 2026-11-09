import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFirebaseQaIdentity} from './termux-firebase-qa-identity-readonly.mjs';

const project='atrio-catolico-qa-geral';
const appId='1:123456789:android:abc12345';
const token='mock-only-not-an-oauth-token-123456789';
const projectPath='projects/'+project;
const appPath=projectPath+'/androidApps/'+appId;
const dataProject=()=>({name:projectPath,projectId:project,projectNumber:'123456789',state:'ACTIVE'});
const dataApp=()=>({name:appPath,projectId:project,appId,
  packageName:'br.com.atriocatolico.chatqa',state:'ACTIVE'});
function fixture({projectData=dataProject(),appData=dataApp(),
                  failStatus=0,malformed=false,network=false}={}) {
  const calls=[];
  const fetcher=async (url,opts)=>{
    calls.push({url,opts});
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.cache,'no-store');
    assert.equal(opts.headers.Authorization,'Bearer '+token);
    assert.ok(opts.signal);
    assert.ok([ 'https://firebase.googleapis.com/v1beta1/'+projectPath,
                'https://firebase.googleapis.com/v1beta1/'+appPath ].includes(url));
    if(network)throw Error('network-failure');
    if(failStatus)return new Response('',{status:failStatus});
    if(malformed)return new Response('not-json',{status:200});
    return Response.json(url.endsWith('/'+appId)?appData:projectData);
  };
  return {calls,fetcher};
}
const run=(f,expectedAppId=appId)=>inspectFirebaseQaIdentity({
  expectedAppId,tokenProvider:async()=>token,fetcher:f.fetcher
});

test('confirma identidades com somente dois GETs de metadados QA',async()=>{
  const f=fixture();
  const result=await run(f);
  assert.equal(f.calls.length,2);
  assert.equal(result.status,'firebase_qa_identity_readonly_confirmed');
  assert.equal(result.firebase_android_app_id,appId);
  assert.equal(result.cloud_metadata_verified,true);
  for(const flag of ['fcm_verified_here','firestore_rules_verified_here',
    'authentication_verified_here','config_file_verified_here','deploy_performed',
    'production_contacted'])assert.equal(result[flag],false);
  assert.equal(JSON.stringify(result).includes(token),false);
  assert.equal(JSON.stringify(result).includes('apiKeyId'),false);
});

test('rejeita appId inválido e login indisponível sem qualquer GET',async()=>{
  for(const id of [undefined,'','1:123:web:badbeef',
                   '1:123:android:bad/../../projects/atrio-catolico']){
    const f=fixture();
    await assert.rejects(run(f,id),/qa_firebase_identity_expected_app_id_required/);
    assert.equal(f.calls.length,0);
  }
  const f=fixture();
  await assert.rejects(inspectFirebaseQaIdentity({
    expectedAppId:appId,tokenProvider:async()=>{throw Error('secret-data');},
    fetcher:f.fetcher
  }),/qa_firebase_identity_local_cli_login_unavailable/);
  assert.equal(f.calls.length,0);
});

test('projeto errado, numero diferente ou excluido impede segundo GET',async()=>{
  const changes=[
    {name:'projects/atrio-catolico'},
    {projectId:'atrio-catolico'},
    {projectNumber:'999999999'},
    {state:'DELETED'}
  ];
  for(const patch of changes){
    const f=fixture({projectData:{...dataProject(),...patch}});
    await assert.rejects(run(f),/qa_firebase_identity_qa_project_metadata_mismatch/);
    assert.equal(f.calls.length,1);
  }
});

test('app com projeto, pacote, ID ou estado divergente e bloqueado',async()=>{
  const changes=[
    {name:'projects/atrio-catolico/androidApps/'+appId},
    {projectId:'atrio-catolico'},
    {appId:'1:123456789:android:deadbeef'},
    {packageName:'br.com.atriocatolico'},
    {state:'DELETED'}
  ];
  for(const patch of changes){
    const f=fixture({appData:{...dataApp(),...patch}});
    await assert.rejects(run(f),/qa_firebase_identity_qa_android_app_metadata_mismatch/);
    assert.equal(f.calls.length,2);
  }
});

test('rede, acesso negado e resposta inválida falham sem vazamento',async()=>{
  for(const props of [{network:true},{failStatus:403},{malformed:true}]){
    const f=fixture(props);
    await assert.rejects(run(f),/qa_firebase_identity_(network_error|access_denied|invalid_response)/);
    assert.equal(f.calls.length,1);
  }
});
