/**
 * Build reviewed Community Terms as a static, versioned page, OFFLINE.
 * No legal text is fabricated. This file has no deploy or Firebase access.
 * Approval metadata is an input assertion, not independently verified proof.
 */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)));
const APPROVAL='community-terms-owner-and-legal-reviewed';
const KEYS=['appName','controller','supportEmail','version','effectiveDate',
  'privacyUrl','sections','approvedBy','reviewedAt','approval'];
const HEADINGS=Object.freeze({
  about:'Sobre a comunidade',
  userContent:'Cadastro, publicações e responsabilidades',
  prohibited:'Condutas e conteúdos proibidos',
  reporting:'Denúncias e bloqueio de participantes',
  moderation:'Moderação e revisão humana',
  privacy:'Privacidade, dados associados e exclusão de conta',
  minors:'Crianças, adolescentes e segurança',
  updates:'Atualizações dos Termos e recursos'
});
const PLACEHOLDER=/\[[^\]]{1,120}\]|\b(?:todo|placeholder|tbd|a definir|a confirmar|em construção|fictício|fictícia)\b/i;
const sameKeys=(value,keys)=>value!==null&&typeof value==='object'&&
  !Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const htmlEscape=x=>x.replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const deny=x=>{throw Error('community_terms_'+x);};
function dateValid(value,{now=new Date(),timestamp=false}={}){
  if(typeof value!=='string')return false;
  if(timestamp){
    if(!/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))return false;
    const d=new Date(value);
    return Number.isFinite(d.getTime())&&d.toISOString()===value&&d<=now;
  }
  if(!/^20\d\d-\d\d-\d\d$/.test(value))return false;
  const d=new Date(value+'T00:00:00.000Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value&&
    d.getTime()<=now.getTime()+86400000;
}
function publicUrl(value) {
  if(typeof value!=='string'||value.length>2048)return false;
  try {
    const url=new URL(value);
    const host=url.hostname.toLowerCase();
    return url.protocol==='https:'&&!url.username&&!url.password&&
      !url.search&&!url.hash&&(!url.port||url.port==='443')&&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)&&
      !host.endsWith('.test')&&!host.endsWith('.invalid')&&
      !host.endsWith('.localhost')&&!host.endsWith('.local')&&
      !host.endsWith('.example')&&!host.endsWith('.example.com')&&
      !host.endsWith('.example.org')&&!host.endsWith('.example.net')&&
      !['example.com','example.org','example.net',
        'atrio-catolico-privacidade-qa.pages.dev'].includes(host);
  }catch{return false;}
}
export function validateCommunityTerms(input,{now=new Date()}={}){
  if(!sameKeys(input,KEYS))deny('schema_invalid');
  if(input.appName!=='Átrio Católico'||
     input.controller!=='Josué Prado de Oliveira Costa'||
     input.supportEmail!=='atriocatolico.privacidade@gmail.com')
    deny('owner_or_contact_mismatch');
  // Same exact version family as CommunityTermsPolicy on Android and Firestore.
  if(typeof input.version!=='string'||
     !/^community-v[1-9][0-9]{0,3}$/.test(input.version))
    deny('version_incompatible_with_android');
  if(!dateValid(input.effectiveDate,{now}) ||
     !dateValid(input.reviewedAt,{now,timestamp:true}))
    deny('dates_invalid');
  if(input.approval!==APPROVAL||
     typeof input.approvedBy!=='string'||
     !/^[A-Za-z][A-Za-z0-9_.-]{2,80}$/.test(input.approvedBy))
    deny('review_not_attested');
  if(!publicUrl(input.privacyUrl))deny('privacy_url_invalid');
  if(!sameKeys(input.sections,Object.keys(HEADINGS)))deny('sections_missing');
  const sections={};
  for(const key of Object.keys(HEADINGS)){
    const value=input.sections[key];
    if(typeof value!=='string'||value.trim().length<65||value.length>4000||
       PLACEHOLDER.test(value)||/[<>\u0000-\u001f]/.test(value))
      deny('section_invalid_'+key);
    sections[key]=value.trim();
  }
  return Object.freeze({...input,sections:Object.freeze(sections)});
}
export function renderCommunityTerms(input,options){
  const x=validateCommunityTerms(input,options);
  const sections=Object.entries(HEADINGS).map(([id,title])=>
    '<section><h2>'+htmlEscape(title)+'</h2><p>'+
    htmlEscape(x.sections[id])+'</p></section>').join('\n');
  return '<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="referrer" content="no-referrer">'+
    '<title>Termos da Comunidade — Átrio Católico</title>'+
    '<style>body{font:16px/1.7 system-ui,sans-serif;color:#33272d;'+
    'background:#fff;max-width:50rem;margin:0 auto;padding:1.5rem}'+
    'h1,h2{line-height:1.25;color:#5b253b}section{margin:1.75rem 0}'+
    'a{color:#6d2448;overflow-wrap:anywhere}</style></head><body><main>'+
    '<h1>Termos de Uso e Política da Comunidade — Átrio Católico</h1>'+
    '<p><strong>Versão:</strong> '+htmlEscape(x.version)+'</p>'+
    '<p><strong>Vigência:</strong> '+htmlEscape(x.effectiveDate)+'</p>'+
    '<p><strong>Responsável:</strong> '+htmlEscape(x.controller)+'</p>'+
    sections+
    '<p><a href="'+htmlEscape(x.privacyUrl)+'">Política de Privacidade</a></p>'+
    '<p>Contato: <a href="mailto:'+htmlEscape(x.supportEmail)+'">'+
    htmlEscape(x.supportEmail)+'</a></p></main></body></html>\n';
}
export function buildCommunityTerms(input,outputDir,options){
  const html=renderCommunityTerms(input,options);
  const dir=resolve(outputDir||join(ROOT,'terms-dist'));
  if([ROOT,dirname(ROOT),'/'].includes(dir))deny('unsafe_output_dir');
  const target=join(dir,'termos',input.version);
  mkdirSync(target,{recursive:true,mode:0o700});
  writeFileSync(join(target,'index.html'),html,{encoding:'utf8',flag:'wx',mode:0o644});
  return target;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(!process.env.ATRIO_COMMUNITY_TERMS_INPUT)deny('reviewed_input_required');
    const json=JSON.parse(readFileSync(process.env.ATRIO_COMMUNITY_TERMS_INPUT,'utf8'));
    const target=buildCommunityTerms(json,process.env.ATRIO_COMMUNITY_TERMS_OUTPUT_DIR);
    console.log('Reviewed community terms generated OFFLINE, no deployment: '+target);
  }catch(e){console.error('Community Terms blocked: '+e.message);process.exitCode=1;}
}
