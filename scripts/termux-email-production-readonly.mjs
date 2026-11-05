#!/usr/bin/env node
/**
 * Auditoria de email obrigatorio no Termux usando o login ja existente do
 * Firebase CLI. Nenhum deploy, escrita de documento, backup, ou arquivo novo.
 *
 * Acesso a API interna da versao local de firebase-tools apenas para obter um
 * Google OAuth access token em MEMORIA. Falhas de compatibilidade abortam,
 * sem autenticar novamente ou pedir novas credenciais.
 */
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {inspectProduction} from './email-verification-production-preflight.mjs';

const err=code=>new Error('atrio_termux_preflight_'+code);

export async function accessTokenFromExistingFirebaseCli({
  npmRoot,
  cwd=process.cwd(),
  exec=execFileSync,
  requireFactory=createRequire
}={}) {
  // Não executa firebase login, firebase init, nem rotinas que escrevam regras.
  let root=npmRoot;
  if(!root) {
    try { root=exec('npm',['root','-g'],{
      encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']
    }).trim(); }
    catch {throw err('npm_unavailable');}
  }
  if(typeof root!=='string'||!root.startsWith('/')||root.length>1024)
    throw err('firebase_cli_missing');
  let auth,apiv2;
  try{
    const requireCli=requireFactory(join(resolve(root),'firebase-tools','package.json'));
    // São módulos PRIVADOS de firebase-tools: se um upgrade mudar a API,
    // interrompemos e NÃO tentamos ler o arquivo de credenciais manualmente.
    auth=requireCli('./lib/auth.js');
    apiv2=requireCli('./lib/apiv2.js');
  }catch{throw err('firebase_cli_incompatible');}
  let account;
  try{
    account=auth.getProjectDefaultAccount?.(cwd) ||
      auth.getGlobalDefaultAccount?.();
  }catch{throw err('firebase_login_unavailable');}
  if(typeof account?.tokens?.refresh_token!=='string'||
     account.tokens.refresh_token.length<20)
    throw err('firebase_login_unavailable');
  if(typeof apiv2.setRefreshToken!=='function'||
     typeof apiv2.getAccessToken!=='function')
    throw err('firebase_cli_incompatible');
  try{
    // O Firebase CLI mantém a sessão de login, e nunca imprimimos seus tokens.
    apiv2.setRefreshToken(account.tokens.refresh_token);
    const token=await apiv2.getAccessToken();
    if(typeof token!=='string'||token.length<20||token.length>12000)
      throw Error('invalid_oauth');
    return token;
  }catch{throw err('firebase_login_refresh_failed');}
}

export async function performTermuxEmailAudit({
  expectedRules,
  tokenProvider=accessTokenFromExistingFirebaseCli,
  inspector=inspectProduction
}){
  const token=await tokenProvider();
  // Nenhum token, account ou documento privado entra na resposta.
  return inspector({token,expectedRules});
}

if(process.argv[1] && import.meta.url==='file://'+process.argv[1]){
  try{
    const rules=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
    const result=await performTermuxEmailAudit({expectedRules:rules});
    console.log(JSON.stringify(result,null,2));
    // Código 2 é diagnóstico de configuração pendente, não falha do script.
    if(!result.ready)process.exitCode=2;
  }catch(e){
    const msg=/^atrio_(termux_preflight|preflight)_[a-z0-9_]+$/.test(e?.message||'')
      ?e.message:'atrio_termux_preflight_failed_closed';
    console.error(msg);
    process.exitCode=1;
  }
}
