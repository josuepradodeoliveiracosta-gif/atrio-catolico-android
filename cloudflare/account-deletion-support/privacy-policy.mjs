/**
 * Build an offline privacy-policy page for Google Play only after explicit
 * content/legal review. Never connects to a network or publishes a website.
 * Preview tests use fictional content. No defaults for unknown legal facts.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)));
const APPROVAL='policy-owner-and-legal-reviewed';
// Grafia fornecida expressamente para identificação pública do controlador.
const CONTROLLER='Josué Prado de Oliveira Costa';
const EMAIL=/^[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const KEYS=Object.freeze([
  'appName','controller','email','effectiveDate','dataCategories',
  'purposesAndBases','religiousData','publicVisibility','providers',
  'internationalTransfers','security','retention','deletion',
  'individualRights','minors','contactProcedure'
]);
const TEXT_FIELDS=KEYS.filter(x=>!['appName','email','effectiveDate'].includes(x));
const UNRESOLVED=/\[(?:[^\]]{1,100})\]|\b(?:todo|placeholder|tbd|a definir|a confirmar|em constru[cç][aã]o|exemplo|fict[ií]ci[oa])\b/i;
const APPROVAL_META=Object.freeze(['approvedBy','reviewedAt','approval']);
const esc=x=>x.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#39;');
function denied(code){throw Error('privacy_policy_'+code);}
function textCheck(value,key,min=45){
  if(typeof value!=='string'||value.length<min||value.length>3200||
     UNRESOLVED.test(value)||/[<>\u0000-\u001f]/.test(value))denied('field_invalid_'+key);
  return value.trim();
}
function domainOK(host){
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host) &&
    !['example.com','example.net','example.org'].includes(host) &&
    !/(?:^|\.)(?:local|localhost|invalid|test|example)$/.test(host);
}
export function validatePrivacyCopy(raw,{now=new Date()}={}){
  if(!raw||Object.getPrototypeOf(raw)!==Object.prototype||
     Object.keys(raw).sort().join(',')!==[...KEYS,...APPROVAL_META].sort().join(','))
    denied('fields_missing_or_extra');
  if(raw.approval!==APPROVAL)denied('content_not_reviewed');
  const reviewer=raw.approvedBy;
  if(typeof reviewer!=='string'||!/^[A-Za-z][A-Za-z0-9_.-]{2,80}$/.test(reviewer))
    denied('reviewer_missing');
  const reviewed=Date.parse(raw.reviewedAt);
  if(typeof raw.reviewedAt!=='string'||!/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.reviewedAt)||
     !Number.isFinite(reviewed)||new Date(reviewed).toISOString()!==raw.reviewedAt||
     reviewed>now.getTime())denied('review_timestamp_invalid');
  if(raw.appName!=='Átrio Católico')denied('app_name_mismatch');
  if(raw.controller!==CONTROLLER)denied('controller_identity_mismatch');
  if(typeof raw.email!=='string'||raw.email!=='atriocatolico.privacidade@gmail.com'||
     !EMAIL.test(raw.email)||!domainOK(raw.email.split('@')[1]))denied('contact_mismatch');
  if(typeof raw.effectiveDate!=='string'||!/^20\d\d-\d\d-\d\d$/.test(raw.effectiveDate)||
     !Number.isFinite(Date.parse(raw.effectiveDate+'T00:00:00Z'))||
     new Date(raw.effectiveDate+'T00:00:00Z').toISOString().slice(0,10)!==raw.effectiveDate||
     Date.parse(raw.effectiveDate+'T00:00:00Z')>now.getTime()+86400000)
    denied('effective_date_invalid');
  const out={appName:raw.appName,email:raw.email,
    effectiveDate:raw.effectiveDate,approvedBy:reviewer,
    reviewedAt:raw.reviewedAt,approval:APPROVAL};
  for(const key of TEXT_FIELDS)out[key]=textCheck(raw[key],key,key==='controller'?6:45);
  return Object.freeze(out);
}
const PAGE_SECTIONS=Object.freeze([
  ['dataCategories','Dados pessoais tratados'],
  ['purposesAndBases','Finalidades e hipóteses legais'],
  ['religiousData','Dados pessoais sensíveis e religião'],
  ['publicVisibility','Visibilidade e publicações na comunidade'],
  ['providers','Fornecedores e compartilhamento de dados'],
  ['internationalTransfers','Transferências internacionais'],
  ['security','Segurança e proteção'],
  ['retention','Conservação e retenção'],
  ['deletion','Exclusão de conta e dados associados'],
  ['individualRights','Direitos dos titulares'],
  ['minors','Crianças e adolescentes'],
  ['contactProcedure','Como entrar em contato']
]);
export function renderPrivacyHtml(raw,options){
  const x=validatePrivacyCopy(raw,options);
  const sections=PAGE_SECTIONS.map(([field,label])=>
    '<section><h2>'+esc(label)+'</h2><p>'+esc(x[field])+'</p></section>').join('\n');
  const email=esc(x.email);
  return '<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<meta name="robots" content="index,follow">'+
    '<title>Política de privacidade — Átrio Católico</title>'+
    '<style>body{font:16px/1.7 system-ui,sans-serif;color:#33272d;'+
    'background:#fff;max-width:50rem;margin:0 auto;padding:1.5rem}'+
    'h1,h2{line-height:1.25;color:#5b253b}section{margin:1.75rem 0}'+
    'a{color:#6d2448;overflow-wrap:anywhere}main{display:block}</style>'+
    '</head><body><main>'+
    '<h1>Política de privacidade — Átrio Católico</h1>'+
    '<p><strong>Responsável:</strong> '+esc(x.controller)+'</p>'+
    '<p><strong>Vigência:</strong> '+esc(x.effectiveDate)+'</p>'+
    '<p><strong>Contato de privacidade:</strong> <a href="mailto:'+
    email+'">'+email+'</a></p>\n'+sections+
    '</main></body></html>\n';
}
export function buildPrivacyPolicy(raw,outputDir,options){
  // No directory or file must be created unless review passes.
  const html=renderPrivacyHtml(raw,options);
  const dir=resolve(outputDir||join(ROOT,'policy-dist'));
  if(dir===ROOT||dir===resolve(ROOT,'..')||dir==='/')denied('unsafe_output_directory');
  const policyDir=join(dir,'privacidade');
  mkdirSync(policyDir,{recursive:true,mode:0o700});
  writeFileSync(join(policyDir,'index.html'),html,{encoding:'utf8',mode:0o644,flag:'wx'});
  writeFileSync(join(dir,'_headers'),
    '/privacidade/*\n  X-Content-Type-Options: nosniff\n'+
    '  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n'+
    "  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; "+
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'\n",
    {encoding:'utf8',mode:0o644,flag:'wx'});
  return policyDir;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const input=process.env.ATRIO_PRIVACY_POLICY_INPUT;
    if(!input)denied('input_not_configured');
    // Operators should keep reviewed legal content off public repo until
    // explicitly approved. Never log content or any private account details.
    const parsed=JSON.parse(readFileSync(input,'utf8'));
    const dir=buildPrivacyPolicy(parsed,process.env.ATRIO_PRIVACY_OUTPUT_DIR);
    console.log('Reviewed static privacy page generated OFFLINE (no deploy): '+dir);
  }catch(e){console.error('Privacy page blocked: '+e.message);process.exitCode=1;}
}
