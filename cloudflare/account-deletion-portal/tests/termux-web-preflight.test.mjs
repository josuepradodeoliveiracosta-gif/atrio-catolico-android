import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseWebApp,validateSdkConfig,webPortalPreflight}
  from '../scripts/termux-web-preflight.mjs';
const app={appId:'1:123456789:web:abcdef012345',
  displayName:'Atrio Catolico - Portal de Exclusao',platform:'WEB'};
const config={apiKey:'AIza'+'A'.repeat(35),
  appId:app.appId,authDomain:'atrio-catolico.firebaseapp.com',
  projectId:'atrio-catolico'};
const success=result=>JSON.stringify({status:'success',result});

test('resolve aplicativo Web único de projeto e recusa duplicações',()=>{
  assert.deepEqual(chooseWebApp(success([app])),{appId:app.appId});
  assert.throws(()=>chooseWebApp(success([app,app])),/app_web_unico/);
  assert.throws(()=>chooseWebApp(success([
    {...app,displayName:'Outro app'}
  ])),/app_web_unico/);
});
test('configuração do Web App exige App ID e projeto correspondentes',()=>{
  assert.deepEqual(validateSdkConfig(app,success(config)),config);
  assert.throws(()=>validateSdkConfig(app,success({...config,projectId:'outro'})));
  assert.throws(()=>validateSdkConfig(app,success({...config,appId:'1:9:web:outroooo'})));
  assert.throws(()=>validateSdkConfig(app,success({...config,apiKey:'missing'})));
  assert.throws(()=>validateSdkConfig(app,success({...config,authDomain:'evil.test'})));
});
test('consulta somente leitura e build temporário são suficientes',()=>{
  const calls=[];
  const mock=argv=>{
    calls.push(argv);
    if(argv[0]==='git')return 'feature/privacy-admin-write-freeze-emulator-20261031\n';
    if(argv[1]==='apps:list')return success([app]);
    if(argv[1]==='apps:sdkconfig')return success(config);
    throw Error('mutacao_nunca_aceita');
  };
  const result=webPortalPreflight(mock);
  assert.equal(result.localPortalBuild,true);
  assert.equal(result.publiclyDeployed,false);
  assert.equal(result.actualDeletionEnabled,false);
  assert.equal(calls.length,3);
  assert.deepEqual(calls[1],['firebase','apps:list','WEB',
    '--project','atrio-catolico','--json']);
  assert.deepEqual(calls[2],['firebase','apps:sdkconfig','WEB',app.appId,
    '--project','atrio-catolico','--json']);
});
test('nega branch errada, lista inválida e retorno bruto malformado',()=>{
  const calls=[];
  assert.throws(()=>webPortalPreflight(argv=>{
    calls.push(argv);
    return 'main\n';
  }),/branch_privacidade_incorreta/);
  assert.deepEqual(calls,[['git','branch','--show-current']]);
  assert.throws(()=>chooseWebApp('invalid_json'),/resposta_cli_invalida/);
  assert.throws(()=>chooseWebApp(JSON.stringify({status:'error'})),/consulta_cli_negada/);
});
