#!/usr/bin/env node
/**
 * Átrio Católico — conferência e, somente mediante consentimento explícito,
 * configuração atômica da conta oficial de Fundador.
 *
 * Padrão: GET de app_config/founder e admins/{uid}, SEM escrita.
 *
 * Aplicação opcional: --apply --confirm=atrio-catolico:fundador
 * - Nunca substitui um Fundador com outro UID.
 * - Não concede acesso a contas em outro projeto.
 * - Só escreve app_config/founder.uid se NÃO existir documento.
 * - Só escreve admins/{uid}.enabled se ainda não estiver true.
 * - Usa commit atômico e precondições (exists=false/updateTime).
 * - Não imprime tokens OAuth, UID do titular ou de outros usuários.
 * - Não escreve em backup, Auth, regras Firestore, APKs ou Workers.
 *
 * O titular deve verificar no Firebase Authentication que o UID pertence
 * à sua conta ANTES de usar o modo --apply.
 */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';

const PROJECT='atrio-catolico';
const API='https://firestore.googleapis.com/v1/projects/'+PROJECT+
  '/databases/(default)/documents';
const DOCS='projects/'+PROJECT+'/databases/(default)/documents';
const fail=code=>{throw Error('atrio_founder_setup_'+code);};
const validUid=uid=>typeof uid==='string'&&/^[a-zA-Z0-9_-]{10,128}$/.test(uid);

async function requestJson(url,{token,fetcher=fetch,method='GET',body}={}) {
  let response;
  try {
    response=await fetcher(url,{
      method,redirect:'error',cache:'no-store',
      headers:{
        Authorization:'Bearer '+token,
        Accept:'application/json',
        ...(body?{'Content-Type':'application/json'}:{})
      },
      ...(body?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(12000)
    });
  }catch{fail('network_unavailable');}
  if(method==='GET'&&response.status===404)return null;
  if(response.status===401||response.status===403)fail('permission_denied');
  if(!response.ok)fail('http_'+response.status);
  try {
    const raw=await response.text();
    if(raw.length>120000)fail('response_too_large');
    const result=JSON.parse(raw);
    if(!result||typeof result!=='object'||Array.isArray(result))
      fail('invalid_json');
    return result;
  }catch(e){
    if(e?.message?.startsWith('atrio_founder_setup_'))throw e;
    fail('invalid_json');
  }
}

async function inspect({uid,token,fetcher}) {
  const [founder,admin]=await Promise.all([
    requestJson(API+'/app_config/founder',{token,fetcher}),
    requestJson(API+'/admins/'+uid,{token,fetcher})
  ]);
  if(founder && (
    founder.name!==DOCS+'/app_config/founder' ||
    typeof founder.fields?.uid?.stringValue!=='string' ||
    !founder.fields.uid.stringValue
  ))fail('invalid_founder_document');
  if(admin && (
    admin.name!==DOCS+'/admins/'+uid ||
    (admin.fields?.enabled!==undefined &&
      typeof admin.fields.enabled.booleanValue!=='boolean') ||
    typeof admin.updateTime!=='string'
  ))fail('invalid_admin_document');
  const founderState=!founder?'absent':
    founder.fields.uid.stringValue===uid?'this_account':'another_account';
  const adminState=!admin?'absent':
    admin.fields?.enabled?.booleanValue===true?'enabled':'disabled';
  return {founder,admin,founderState,adminState};
}

/**
 * Injeção de chamadas para testes: execução real só com CLI do Termux
 * autenticada no projeto, nunca via GitHub Actions.
 */
export async function setupFounder({
  uid,apply=false,
  tokenProvider=accessTokenFromExistingFirebaseCli,
  fetcher=fetch
}={}) {
  if(!validUid(uid))fail('invalid_uid');
  const token=await tokenProvider();
  if(typeof token!=='string'||token.length<20||token.length>12000)
    fail('invalid_oauth');
  const state=await inspect({uid,token,fetcher});
  const result={
    project:PROJECT,
    mode:apply?'GUARDED_FOUNDER_SETUP':'READ_ONLY_PREFLIGHT',
    founderState:state.founderState,
    adminState:state.adminState,
    ready:state.founderState==='this_account'&&state.adminState==='enabled',
    anotherFounderExists:state.founderState==='another_account',
    backupModified:false,
    rulesModified:false,
    changedByThisCommand:false
  };
  if(state.founderState==='another_account')return {
    ...result,canApply:false,reason:'founder_already_assigned_to_another_account'
  };
  if(!apply)return {...result,canApply:true};
  if(result.ready)return {...result,canApply:true,alreadyConfigured:true};

  // Reconsulta para detectar decisões administrativas concorrentes.
  const current=await inspect({uid,token,fetcher});
  if(current.founderState!==state.founderState ||
     current.adminState!==state.adminState ||
     current.founder?.updateTime!==state.founder?.updateTime ||
     current.admin?.updateTime!==state.admin?.updateTime)
    fail('documents_changed_during_review');

  const writes=[];
  if(current.founderState==='absent')writes.push({
    update:{
      name:DOCS+'/app_config/founder',
      fields:{uid:{stringValue:uid}}
    },
    currentDocument:{exists:false}
  });
  if(current.adminState==='absent')writes.push({
    update:{
      name:DOCS+'/admins/'+uid,
      fields:{enabled:{booleanValue:true}}
    },
    currentDocument:{exists:false}
  });
  else if(current.adminState==='disabled')writes.push({
    update:{
      name:DOCS+'/admins/'+uid,
      fields:{enabled:{booleanValue:true}}
    },
    updateMask:{fieldPaths:['enabled']},
    currentDocument:{updateTime:current.admin.updateTime}
  });
  if(!writes.length)fail('unexpected_empty_write');

  const commit=await requestJson(API+':commit',{
    token,fetcher,method:'POST',body:{writes}
  });
  if(!Array.isArray(commit.writeResults)||commit.writeResults.length!==writes.length)
    fail('unconfirmed_commit');
  const after=await inspect({uid,token,fetcher});
  if(after.founderState!=='this_account'||after.adminState!=='enabled')
    fail('post_commit_verification_failed');
  return {
    ...result,
    ready:true,
    founderState:after.founderState,
    adminState:after.adminState,
    canApply:true,
    changedByThisCommand:true,
    writesConfirmed:writes.length
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const args=process.argv.slice(2);
    const uidArgs=args.filter(s=>s.startsWith('--uid='));
    const uid=uidArgs[0]?.slice('--uid='.length);
    const apply=args.includes('--apply');
    const confirm=args.includes('--confirm=atrio-catolico:fundador');
    const known= args.every(s=>s.startsWith('--uid=')||
      s==='--apply'||s==='--confirm=atrio-catolico:fundador');
    if(!known||uidArgs.length!==1||
       (apply!==confirm)||args.length!==(apply?3:1))
      fail('explicit_confirmation_required');
    const report=await setupFounder({uid,apply});
    console.log(JSON.stringify(report,null,2));
    if(report.anotherFounderExists)process.exitCode=2;
  }catch(e){
    const msg=/^atrio_(?:founder_setup|termux_preflight)_[a-z0-9_]+$/.test(e?.message||'')
      ?e.message:'atrio_founder_setup_failed_closed';
    console.error(msg);
    process.exitCode=1;
  }
}
