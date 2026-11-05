#!/usr/bin/env node
/**
 * Revisao de linhas que existem SOMENTE nas regras publicadas do Firestore.
 * Nao executa deploy, nem escreve arquivos/snapshots/backups.
 * Duas consultas GET autenticadas feitas pelo comparador aprovado da PR #139.
 *
 * Os trechos sao curtos e filtrados: o conteudo completo das regras remotas
 * nunca e impresso e nenhum token/sessao e exibido.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fetchPublishedRules} from './termux-firestore-rules-diff-readonly.mjs';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';

const fail=msg=>{throw Error('atrio_rules_review_'+msg);};
const fingerprint=s=>createHash('sha256').update(s,'utf8').digest('hex').slice(0,12);

function safeLine(raw){
  const value=raw.trim();
  if(!value)return {kind:'blank',text:'(linha em branco)'};
  if(value.startsWith('//')||value.startsWith('/*')||value.startsWith('*'))
    return {kind:'comment',text:'(comentario omitido)'};
  if(/-----BEGIN|private[_-]?key|client[_-]?secret|password|auth[_-]?bearer|access[_-]?token|refresh[_-]?token|api[_-]?key/i.test(value))
    return {kind:'redacted',text:'(linha potencialmente sensivel omitida)'};
  const scrubbed=value
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'[email ocultado]')
    .replace(/https?:\/\/\S+/g,'[url ocultada]')
    .replace(/(?:AIza[0-9A-Za-z_-]{30,}|ya29\.[A-Za-z0-9_-]{20,})/g,'[token ocultado]');
  if(scrubbed.length>220)
    return {kind:'long_line',text:'(linha longa omitida; hash '+fingerprint(value)+')'};
  if(/^(allow|match|function|return|let|&&|\|\||[{};])\b/.test(scrubbed) ||
     /^(?:&&|\|\||[{};])/.test(scrubbed))
    return {kind:'rule',text:scrubbed};
  return {kind:'other',text:'(trecho nao estrutural omitido; hash '+fingerprint(value)+')'};
}

/**
 * LCS para detectar linhas exclusivas da producao, sem deduzir permissao de
 * implantacao: mesmo com zero diferencas esta funcao nao autoriza deploy.
 */
export function inspectProductionOnlyLines(published,repository){
  if(typeof published!=='string'||typeof repository!=='string'||
     published.length<1000||repository.length<1000)fail('missing_rules');
  const a=published.replace(/\r\n/g,'\n').split('\n');
  const b=repository.replace(/\r\n/g,'\n').split('\n');
  if(a.length>2500||b.length>2500)fail('too_many_lines');
  const width=b.length+1;
  const d=new Uint16Array((a.length+1)*width);
  for(let i=a.length-1;i>=0;i--)
    for(let j=b.length-1;j>=0;j--)
      d[i*width+j]=a[i]===b[j]
        ?1+d[(i+1)*width+j+1]
        :Math.max(d[(i+1)*width+j],d[i*width+j+1]);
  let i=0,j=0,total=0;
  const lines=[];
  while(i<a.length||j<b.length){
    if(i<a.length&&j<b.length&&a[i]===b[j]){i++;j++;continue;}
    if(i<a.length&&(j>=b.length||d[(i+1)*width+j]>=d[i*width+j+1])){
      total++;
      if(lines.length<100)
        lines.push({publishedLine:i+1,...safeLine(a[i])});
      i++;
    }else j++;
  }
  return {
    publishedOnlyTotal:total,
    publishedOnlyShown:lines.length,
    review:lines,
    requiresManualReview:total!==0,
    deploymentApproved:false,
    releaseApproved:false
  };
}

export async function reviewPublishedRules({
  localRules,tokenProvider=accessTokenFromExistingFirebaseCli,fetcher=fetch
}={}){
  if(typeof localRules!=='string')fail('missing_local_rules');
  const token=await tokenProvider();
  const remote=await fetchPublishedRules({token,fetcher});
  return {
    project:'atrio-catolico',
    mode:'READ_ONLY_NO_BACKUP',
    publishedAt:remote.publishedAt,
    ...inspectProductionOnlyLines(remote.publishedRules,localRules)
  };
}

if(process.argv[1]&&import.meta.url==='file://'+process.argv[1]){
  try{
    const local=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
    const report=await reviewPublishedRules({localRules:local});
    console.log(JSON.stringify(report,null,2));
    // Regras divergentes exigem revisao, nunca apenas um deploy automatico.
    if(report.requiresManualReview)process.exitCode=2;
  }catch(e){
    const msg=/^atrio_(rules_review|rules_diff|termux_preflight)_[a-z0-9_]+$/.test(e?.message||'')
      ?e.message:'atrio_rules_review_failed_closed';
    console.error(msg);
    process.exitCode=1;
  }
}
