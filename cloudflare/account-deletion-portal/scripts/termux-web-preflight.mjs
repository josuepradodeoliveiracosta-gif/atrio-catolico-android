/**
 * Termux: verificação SOMENTE-LEITURA do Firebase Web + build temporário.
 * Não hospeda, não publica regras, não altera Auth ou solicitações.
 * Respostas da CLI (inclusive apiKey pública) não são registradas em log.
 */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPortal,publicFirebaseConfig} from './build.mjs';

const ROOT=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const PROJECT='atrio-catolico';
const DISPLAY='Atrio Catolico - Portal de Exclusao';
const BRANCH='feature/play-closed-testing-aab-20261031';
const FAILURE='verificacao_web_nao_concluida';

function exec(argv){
  try {
    return execFileSync(argv[0],argv.slice(1),{
      cwd:ROOT,encoding:'utf8',timeout:90000,
      stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024
    });
  }catch{
    throw Error('consulta_cli_falhou_ou_permissao_negada');
  }
}
function unwrap(raw){
  let value;
  try {value=typeof raw==='string'?JSON.parse(raw):raw;}
  catch{throw Error('resposta_cli_invalida');}
  if(value && typeof value==='object' && value.status==='error')
    throw Error('consulta_cli_negada');
  if(value && typeof value==='object' && Object.hasOwn(value,'result'))
    value=value.result;
  if(typeof value==='string') {
    try {value=JSON.parse(value);}
    catch{throw Error('resposta_cli_invalida');}
  }
  return value;
}
export function validateSdkConfig(app,raw){
  const value=unwrap(raw);
  // Firebase CLI: apps:sdkconfig --json retorna result.sdkConfig.
  // fileContents contem codigo de exemplo; jamais executar ou registrar.
  const config=value?.sdkConfig;
  if(!config || typeof config!=='object'||Array.isArray(config))
    throw Error('sdk_config_nao_confirmada');
  if(!app || typeof app.appId!=='string' ||
     config.appId!==app.appId)throw Error('app_id_incorreto');
  const built=publicFirebaseConfig({
    FIREBASE_PROJECT_ID:config.projectId,
    FIREBASE_AUTH_DOMAIN:config.authDomain,
    FIREBASE_WEB_API_KEY:config.apiKey,
    FIREBASE_WEB_APP_ID:config.appId
  });
  return Object.freeze(built);
}
export function chooseWebApp(raw){
  const value=unwrap(raw);
  const apps=Array.isArray(value)?value:value?.apps;
  if(!Array.isArray(apps))throw Error('lista_web_invalida');
  const matches=apps.filter(a=>a&&a.displayName===DISPLAY&&
    a.platform==='WEB'&&typeof a.appId==='string');
  if(matches.length!==1)throw Error('app_web_unico_nao_confirmado');
  return {appId:matches[0].appId};
}
export function webPortalPreflight(run=exec){
  // Read-only commands and source control guard; no use of Firebase Admin.
  if(run(['git','branch','--show-current']).trim()!==BRANCH)
    throw Error('branch_privacidade_incorreta');
  const app=chooseWebApp(run([
    'firebase','apps:list','WEB','--project',PROJECT,'--json'
  ]));
  const env=validateSdkConfig(app,run([
    'firebase','apps:sdkconfig','WEB',app.appId,'--project',PROJECT,'--json'
  ]));
  const tmp=mkdtempSync(join(tmpdir(),'atrio-portal-preflight-'));
  try {
    const out=join(tmp,'public');
    buildPortal({
      FIREBASE_WEB_API_KEY:env.apiKey,
      FIREBASE_WEB_APP_ID:env.appId,
      FIREBASE_PROJECT_ID:env.projectId,
      FIREBASE_AUTH_DOMAIN:env.authDomain
    },out);
    const config=readFileSync(join(out,'config.js'),'utf8');
    if(!config.includes('ATRIO_FIREBASE_CONFIG') ||
       !existsSync(join(out,'index.html')) ||
       !existsSync(join(out,'app.js')) ||
       !existsSync(join(out,'_headers')))throw Error('site_qa_incompleto');
  }finally {
    // config.js contém metadados públicos; mesmo assim, não persistir.
    rmSync(tmp,{recursive:true,force:true});
  }
  return Object.freeze({
    firebaseWebAppRegistered:true,
    webConfigMatchesProject:true,
    localPortalBuild:true,
    publiclyDeployed:false,
    actualDeletionEnabled:false,
    authDomainVerifiedForHosting:false
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const result=webPortalPreflight();
    if(result.localPortalBuild)
      console.log('OK: Firebase Web cadastrado e portal montado localmente.');
    console.log('PENDENTE: publicar dominio HTTPS, configurar dominios autorizados');
    console.log('e homologar exclusao real antes de disponibilizar o formulario.');
    console.log('Nenhum deploy, dado de usuario ou segredo foi alterado.');
  }catch(error){
    // Mensagens estritamente conhecidas; nunca imprimir stdout/stderr ou
    // objetos SDK retornados pela CLI, mesmo com API key pública.
    const safeReasons=new Set([
      'branch_privacidade_incorreta','lista_web_invalida',
      'app_web_unico_nao_confirmado','sdk_config_nao_confirmada',
      'app_id_incorreto','consulta_cli_falhou_ou_permissao_negada',
      'consulta_cli_negada','resposta_cli_invalida','site_qa_incompleto'
    ]);
    const reason=safeReasons.has(error?.message)?error.message:FAILURE;
    console.error('BLOQUEADO: '+reason+'; nenhuma configuracao foi alterada.');
    process.exitCode=2;
  }
}
