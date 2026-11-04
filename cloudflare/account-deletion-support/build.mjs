/**
 * Optional Google Play account-deletion support page generator.
 * Manual email is a valid web request pathway; it does not prove deletion.
 * No JS in the generated page, no user data, credentials, network or deploy.
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)));
const APPROVAL='manual-support-and-privacy-reviewed';
const domainOK=s=>typeof s==='string' && s.length<=253 &&
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(s) &&
  !['example.com','example.org','example.net'].includes(s) &&
  !/(?:^|\.)(?:test|invalid|local|localhost|example)$/.test(s) &&
  !s.endsWith('.example.com') && !s.endsWith('.example.org') &&
  !s.endsWith('.example.net');
const escapeHtml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function validatedPublicContact(env){
  if(env?.ATRIO_DELETION_SUPPORT_APPROVED!==APPROVAL)
    throw Error('manual_support_not_reviewed');
  const email=env.ATRIO_DELETION_SUPPORT_EMAIL;
  if(typeof email!=='string'||email.length>254||
    !/^[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9.-]+$/.test(email))
    throw Error('missing_public_support_email');
  if(!domainOK(email.split('@')[1].toLowerCase()))
    throw Error('unsafe_public_support_domain');
  const raw=env.ATRIO_DELETION_PRIVACY_URL;
  if(typeof raw!=='string'||raw.length>2048)
    throw Error('missing_public_privacy_policy_url');
  let url;
  try{url=new URL(raw)}catch{throw Error('invalid_public_privacy_policy_url')}
  if(url.protocol!=='https:'||!domainOK(url.hostname.toLowerCase())||
    url.username||url.password||url.search||url.hash||(url.port&&url.port!=='443'))
    throw Error('invalid_public_privacy_policy_url');
  return Object.freeze({email,privacyUrl:url.href});
}
export function renderSupportPage(env){
  const {email,privacyUrl}=validatedPublicContact(env);
  const mail='mailto:'+email+'?subject='+
    encodeURIComponent('Átrio Católico — exclusão de conta e dados');
  const style=':root{font-family:system-ui,sans-serif;color:#2b2226;background:#fcfaf8}'+
    'body{margin:0}main{max-width:700px;margin:auto;padding:26px 18px 65px}'+
    'h1{font-size:clamp(26px,5vw,38px)}p{line-height:1.6}'+
    'section{background:white;padding:20px;border:1px solid #e8e2e4;'+
    'border-radius:14px;margin:24px 0}a{color:#6d253b}'+
    '.action{display:inline-block;background:#6d253b;color:white;'+
    'padding:13px 18px;border-radius:9px;font-weight:bold}'+
    'a:focus-visible{outline:3px solid #bc8298;outline-offset:3px}';
  return [
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">',
    '<title>Átrio Católico — Solicitar exclusão de conta e dados</title>',
    '<style>'+style+'</style></head><body><main>',
    '<header><p>ÁTRIO CATÓLICO</p><h1>Solicitar exclusão da conta e dos dados associados</h1>',
    '<p>Este pedido pode ser iniciado sem o aplicativo instalado.</p></header>',
    '<section><h2>Como solicitar</h2>',
    '<p>Envie um e-mail ao atendimento pedindo a exclusão da sua conta e dos dados associados.',
    'Se possível, use o endereço vinculado à sua conta. O atendimento poderá verificar',
    'sua identidade por um meio seguro antes de processar a solicitação.</p>',
    '<p><a class="action" href="'+escapeHtml(mail)+'">Solicitar exclusão por e-mail</a></p>',
    '<p>Endereço: <a href="'+escapeHtml(mail)+'">'+escapeHtml(email)+'</a></p>',
    '<p>Se o botão não abrir o aplicativo de e-mail, copie o endereço acima e envie',
    'o pedido pelo serviço de sua preferência.</p>',
    '<p><strong>Não envie senhas, códigos de acesso, CPF ou documentos pessoais',
    'na mensagem inicial.</strong></p></section>',
    '<section><h2>O que acontece depois</h2>',
    '<p>O atendimento verificará a titularidade e organizará a exclusão da conta',
    'e dos dados associados. Enviar o e-mail não exclui a conta imediatamente.</p>',
    '<p>Se houver retenção justificada por obrigação legal ou motivos legítimos,',
    'as condições devem estar descritas na <a rel="noreferrer" href="'+
      escapeHtml(privacyUrl)+'">Política de Privacidade</a>.</p>',
    '<p>Para acompanhar o pedido, responda à conversa com o atendimento.</p></section>',
    '<footer>Átrio Católico — canal de solicitações de exclusão de contas.</footer>',
    '</main></body></html>'
  ].join('\n')+'\n';
}
export function buildSupportPage(env,outputDir){
  const html=renderSupportPage(env); // no side effects until validated
  const dir=resolve(outputDir);
  if([ROOT,dirname(ROOT),join(ROOT,'scripts')].includes(dir))
    throw Error('unsafe_output_location');
  mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'index.html'),html,{mode:0o644,flag:'wx'});
  writeFileSync(join(dir,'_headers'),
    "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n"+
    "  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; "+
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'\n",
    {mode:0o644,flag:'wx'});
  return dir;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const output=buildSupportPage(process.env,
      process.env.ATRIO_SUPPORT_OUTPUT_DIR||join(ROOT,'dist'));
    console.log('Local static preview created, NO deployment: '+output);
  }catch(error){
    console.error('Cannot create public support preview: '+error.message);
    process.exitCode=1;
  }
}
