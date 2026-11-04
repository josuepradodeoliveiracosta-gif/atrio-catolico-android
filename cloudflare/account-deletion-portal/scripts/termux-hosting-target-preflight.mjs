/**
 * Auditoria read-only do destino Hosting dedicado do portal.
 * NUNCA faz deploy, publica paginas, altera Authentication ou muda DNS.
 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const DIR=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const REPO=resolve(DIR,'../..');
export const PROJECT='atrio-catolico';
export const DEFAULT_SITE='atrio-catolico';
export const PORTAL_SITE='atrio-catolico-exclusao';
export const TARGET='deletionPortal';
const BRANCH='feature/play-closed-testing-aab-20261031';

function read(path){
  return JSON.parse(readFileSync(resolve(DIR,path),'utf8'));
}
export function validateTarget(rc,hosting,root){
  const projectAliases=rc?.projects;
  const targets=rc?.targets?.[PROJECT];
  if(projectAliases?.default!==PROJECT ||
     Object.keys(projectAliases).length!==1 ||
     !targets || Object.keys(targets).length!==1 ||
     !targets.hosting || Object.keys(targets.hosting).length!==1 ||
     !Array.isArray(targets.hosting[TARGET]) ||
     targets.hosting[TARGET].length!==1 ||
     targets.hosting[TARGET][0]!==PORTAL_SITE)
    throw Error('destino_portal_incorreto');
  if(Object.keys(hosting).length!==1 ||
     hosting.hosting?.target!==TARGET ||
     Object.hasOwn(hosting.hosting,'site') ||
     hosting.hosting.public!=='dist' ||
     Object.hasOwn(hosting.hosting,'rewrites') ||
     Object.hasOwn(root,'hosting') ||
     !root.firestore ||
     root.firestore.rules!=='firestore.rules' ||
     root.firestore.indexes!=='firestore.indexes.json')
    throw Error('configuracao_pode_alterar_site_principal');
  const headers=hosting.hosting.headers?.[0]?.headers;
  const map=Object.fromEntries((headers||[]).map(x=>[x.key,x.value]));
  if(!map['Content-Security-Policy']?.includes("frame-ancestors 'none'")||
     map['Cache-Control']!=='no-store' ||
     map['X-Frame-Options']!=='DENY')
    throw Error('cabecalhos_de_protecao_ausentes');
}
function getSiteId(site){
  if(!site || typeof site!=='object')return '';
  if(typeof site.siteId==='string')return site.siteId;
  if(typeof site.name==='string' &&
     site.name.startsWith('projects/'+PROJECT+'/sites/'))
    return site.name.slice(('projects/'+PROJECT+'/sites/').length);
  return '';
}
export function validateRemoteSites(value){
  const sites=Array.isArray(value)?value:value?.sites;
  if(!Array.isArray(sites))throw Error('formato_sites_nao_reconhecido');
  const ids=sites.map(getSiteId);
  if(new Set(ids).size!==ids.length ||
     !ids.includes(DEFAULT_SITE) || !ids.includes(PORTAL_SITE))
    throw Error('sites_necessarios_nao_confirmados');
  const portal=sites.find(site=>getSiteId(site)===PORTAL_SITE);
  if(portal?.defaultUrl &&
     portal.defaultUrl!=='https://'+PORTAL_SITE+'.web.app')
    throw Error('url_site_portal_divergente');
  const primary=sites.find(site=>getSiteId(site)===DEFAULT_SITE);
  if(primary?.defaultUrl &&
     primary.defaultUrl!=='https://'+DEFAULT_SITE+'.web.app')
    throw Error('url_site_principal_divergente');
  return {mainSitePreserved:true,portalSiteRegistered:true};
}
function run(argv){
  try{
    return execFileSync(argv[0],argv.slice(1),{
      cwd:REPO,encoding:'utf8',timeout:90000,maxBuffer:1024*1024,
      stdio:['ignore','pipe','pipe']
    });
  }catch{throw Error('consulta_remota_nao_confirmada');}
}
export function auditHostingSites(exec=run){
  if(exec(['git','branch','--show-current']).trim()!==BRANCH)
    throw Error('branch_de_privacidade_incorreta');
  const rc=read('.firebaserc');
  const hosting=read('firebase.hosting.proposed.json');
  const root=JSON.parse(readFileSync(resolve(REPO,'firebase.json'),'utf8'));
  validateTarget(rc,hosting,root);
  let parsed;
  try{
    parsed=JSON.parse(exec([
      'firebase','hosting:sites:list','--project',PROJECT,'--json'
    ]));
  }catch{throw Error('resposta_sites_indisponivel');}
  if(parsed?.status==='error')throw Error('consulta_sites_recusada');
  const remote=Object.hasOwn(parsed,'result')?parsed.result:parsed;
  return validateRemoteSites(remote);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    auditHostingSites();
    console.log('OK: site principal preservado e destino exclusivo do portal confirmado.');
    console.log('OK: arquivo de alvo local isolado; nenhum deploy executado.');
    console.log('PENDENTE: politica HTTPS, Auth/domínio, processamento real e homologacao.');
  }catch(error){
    // Não imprimir saída do Firebase CLI, URLs desconhecidas ou identificadores.
    const allowed=new Set([
      'destino_portal_incorreto','configuracao_pode_alterar_site_principal',
      'cabecalhos_de_protecao_ausentes','formato_sites_nao_reconhecido',
      'sites_necessarios_nao_confirmados','url_site_portal_divergente',
      'url_site_principal_divergente','branch_de_privacidade_incorreta',
      'consulta_remota_nao_confirmada','resposta_sites_indisponivel',
      'consulta_sites_recusada'
    ]);
    console.error('BLOQUEADO: '+(allowed.has(error?.message)?error.message:'preflight_indisponivel'));
    process.exitCode=2;
  }
}
