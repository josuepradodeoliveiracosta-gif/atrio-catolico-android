/**
 * Checklist executável de privacidade do canal fechado da Play Store.
 * NÃO aprova lançamentos, não chama serviços e não executa exclusões.
 * Audit: valida evidências e sinaliza bloqueios; enforce: falha se houver pendências.
 */
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REQUIREMENTS=Object.freeze([
  'in_app_request','external_portal','deletion_executor','worker_freeze',
  'retention_review','public_privacy_policy','data_safety',
  'operational_security','closed_track_e2e'
]);
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(ROOT,path),'utf8');
const isProofUrl=url=>{
  if(typeof url!=='string')return false;
  try {
    const u=new URL(url);
    return u.protocol==='https:' && !!u.hostname && !(
      /(?:^|\.)(?:localhost|example|invalid|test)$/.test(u.hostname) ||
      /^(?:localhost|127\.|0\.|10\.|192\.168\.)/.test(u.hostname) ||
      /substituir|placeholder|TODO|token=|password=/i.test(url) ||
      !!u.username || !!u.password
    );
  }catch{return false;}
};
export function assessPrivacyEvidence(report) {
  if(!report||report.schema!==1||report.track!=='Google Play — testes fechados'||
     typeof report.releaseAuthorized!=='boolean'||!report.requirements||
     typeof report.requirements!=='object')
    throw Error('manifesto_invalido');
  const keys=Object.keys(report.requirements);
  if(keys.length!==REQUIREMENTS.length||keys.some(k=>!REQUIREMENTS.includes(k)))
    throw Error('requisitos_incompletos_ou_inesperados');
  const pending=[];
  for(const id of REQUIREMENTS) {
    const row=report.requirements[id];
    if(!row||typeof row.description!=='string'||!row.description.trim()||
       typeof row.verified!=='boolean')
      throw Error('requisito_invalido:'+id);
    if(!row.verified) {
      if(row.evidenceUrl!==null||row.reviewedBy!==null||row.reviewedAt!==null)
        throw Error('evidencia_inconsistente:'+id);
      pending.push(id);
      continue;
    }
    if(!isProofUrl(row.evidenceUrl)||typeof row.reviewedBy!=='string'||
       !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,80}$/.test(row.reviewedBy)||
       typeof row.reviewedAt!=='string'||!Number.isFinite(Date.parse(row.reviewedAt)))
      throw Error('comprovacao_insuficiente:'+id);
  }
  // A autorização manual jamais substitui as nove homologações.
  if(report.releaseAuthorized && pending.length)
    throw Error('autorizacao_sem_homologacao');
  return Object.freeze({ready:report.releaseAuthorized && pending.length===0,
    pending,releaseAuthorized:report.releaseAuthorized});
}

export function assertQaSafetySources(reader=read) {
  const android=reader('app/src/main/java/br/com/atriocatolico/AccountDeletionRequestSection.kt');
  const profile=reader('app/src/main/java/br/com/atriocatolico/ProfileScreen.kt');
  const portal=reader('cloudflare/account-deletion-portal/public/app.js');
  const plan=reader('cloudflare/account-deletion-processor/src/plan.js');
  const example=reader('web/account-deletion/config.example.js');
  const checks=[
    [android,/Source\.SERVER/,'pedido Android deve consultar servidor'],
    [android,/request\.set\(/,'pedido Android deve registrar intenção'],
    [profile,/AccountDeletionRequestSection\(db, uid\)/,'Perfil deve exibir o pedido'],
    [portal,/inMemoryPersistence/,'sessão web deve ser volátil'],
    [portal,/getDocFromServer/,'pedido web deve consultar servidor'],
    [portal,/source:'web'/,'pedido web deve identificar origem'],
    [plan,/deletionAuthorized:\s*false/,'simulador não pode autorizar exclusão'],
    [example,/ATRIO_ACCOUNT_DELETION_REQUESTS_ENABLED\s*=\s*false/,'portal legado desabilitado']
  ];
  for(const [source,pattern,message] of checks)
    if(!pattern.test(source))throw Error('fonte_qa_alterada:'+message);
  if(/\bdeleteUser\s*\(|\bdeleteDoc\s*\(/.test(portal))
    throw Error('portal_nao_pode_apagar_contas');
  return true;
}

const isMain=process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain) {
  try {
    const arg=process.argv[2]||'--audit';
    if(!['--audit','--enforce'].includes(arg))throw Error('modo_invalido');
    assertQaSafetySources();
    const report=assessPrivacyEvidence(JSON.parse(read('docs/google-play-privacidade-evidencias.json')));
    const state=report.ready?'APTO PARA REVISÃO MANUAL':'BLOQUEADO PARA PUBLICAÇÃO';
    console.log('Privacidade Google Play / QA: '+state);
    console.log('Evidências pendentes: '+(report.pending.join(', ')||'nenhuma'));
    console.log('Autorização humana declarada: '+report.releaseAuthorized);
    console.log('ATENÇÃO: testes estáticos não verificam implantação, Play Console nem exclusão real.');
    if(arg==='--enforce'&&!report.ready)process.exitCode=2;
  } catch(error) {
    console.error('ERRO: '+error.message);
    process.exitCode=1;
  }
}
