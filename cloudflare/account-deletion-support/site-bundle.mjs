/**
 * OFFLINE ONLY: assemble the three independently reviewed HTML pages into
 * one static, consistent hosting artifact. No network, Firebase, deletion,
 * signing or publishing. A review flag in JSON is not legal evidence.
 */
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,renameSync,
  rmSync,existsSync} from 'node:fs';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatedPublicContact,renderSupportPage} from './build.mjs';
import {validatePrivacyCopy,renderPrivacyHtml} from './privacy-policy.mjs';
import {validateCommunityTerms,renderCommunityTerms} from './community-terms.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const DENIED_HOSTS=new Set(['example.com','example.org','example.net',
  'atrio-catolico-privacidade-qa.pages.dev']);
const HOST=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
function fail(name){throw Error('atrio_bundle_'+name);}
function siteOrigin(value){
  if(typeof value!=='string'||value.length>253)fail('missing_site_origin');
  let u;
  try{u=new URL(value);}catch{fail('invalid_site_origin');}
  if(u.protocol!=='https:'||!HOST.test(u.hostname.toLowerCase())||
     DENIED_HOSTS.has(u.hostname.toLowerCase())||
     /(?:^|\.)(?:test|invalid|local|localhost|example)$/.test(u.hostname)||
     /\.(?:example\.com|example\.org|example\.net)$/.test(u.hostname)||
     u.username||u.password||u.search||u.hash||u.pathname!=='/'||
     u.port||u.origin!==value)fail('invalid_site_origin');
  return u.origin;
}
export function inspectStaticSiteBundle(input,{now=new Date()}={}){
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||
     Object.keys(input).sort().join(',')!=='env,policy,terms')
    fail('invalid_input');
  const origin=siteOrigin(input.env?.ATRIO_DELETION_SITE_ORIGIN);
  const contact=validatedPublicContact(input.env);
  const privacy=validatePrivacyCopy(input.policy,{now});
  const terms=validateCommunityTerms(input.terms,{now});
  const expectedPrivacy=origin+'/privacidade';
  if(contact.privacyUrl!==expectedPrivacy||
     terms.privacyUrl!==expectedPrivacy)
    fail('privacy_links_inconsistent');
  if(contact.email!==privacy.email||contact.email!==terms.supportEmail)
    fail('public_contact_inconsistent');
  // Must match the version selected in the Play release checklist.
  // An env variable is not proof that Firestore serves this version.
  if(typeof input.env.ATRIO_PLAY_COMMUNITY_TERMS_VERSION!=='string'||
     input.env.ATRIO_PLAY_COMMUNITY_TERMS_VERSION!==terms.version)
    fail('terms_version_inconsistent');
  return Object.freeze({origin,privacyUrl:expectedPrivacy,
    termsUrl:origin+'/termos/'+terms.version,
    termsVersion:terms.version,files:4,productionPublished:false,
    accountDeletionOperational:false,legalEvidenceVerified:false,
    playReleaseAuthorized:false});
}

const HEADERS="/*\n  X-Content-Type-Options: nosniff\n"+
  "  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n"+
  "  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; "+
  "frame-ancestors 'none'; base-uri 'none'; form-action 'none'\n"+
  "  Cache-Control: no-store\n";

/** Write a complete, never-overwritten static bundle via same-dir rename. */
export function buildStaticSiteBundle(input,outputDir,options={}){
  const review=inspectStaticSiteBundle(input,options);
  const html=[renderSupportPage(input.env),
    renderPrivacyHtml(input.policy,options),
    renderCommunityTerms(input.terms,options)];
  const dest=resolve(outputDir||join(ROOT,'bundle-dist'));
  // Avoid placing files into source directories, or an ancestor thereof.
  if(dest===ROOT||dest===dirname(ROOT)||dest==='/'||
     (dest.startsWith(ROOT+sep)&&dest!==join(ROOT,'bundle-dist')))
    fail('unsafe_output_directory');
  if(existsSync(dest))fail('output_exists');
  const parent=dirname(dest);
  mkdirSync(parent,{recursive:true});
  const stage=mkdtempSync(join(parent,'.atrio-static-review-'));
  try{
    mkdirSync(join(stage,'privacidade'),{recursive:true});
    mkdirSync(join(stage,'termos',review.termsVersion),{recursive:true});
    for(const [path,content] of [
      ['index.html',html[0]],
      ['privacidade/index.html',html[1]],
      ['termos/'+review.termsVersion+'/index.html',html[2]],
      ['_headers',HEADERS]
    ]){
      writeFileSync(join(stage,path),content,{encoding:'utf8',mode:0o644,flag:'wx'});
    }
    if(existsSync(dest))fail('output_exists');
    renameSync(stage,dest);
    return Object.freeze({...review,output:dest});
  }finally{
    if(existsSync(stage))rmSync(stage,{recursive:true,force:true});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const env=process.env;
    if(!env.ATRIO_PRIVACY_POLICY_INPUT||!env.ATRIO_COMMUNITY_TERMS_INPUT)
      fail('reviewed_input_files_required');
    const policy=JSON.parse(readFileSync(env.ATRIO_PRIVACY_POLICY_INPUT,'utf8'));
    const terms=JSON.parse(readFileSync(env.ATRIO_COMMUNITY_TERMS_INPUT,'utf8'));
    const result=buildStaticSiteBundle({env,policy,terms},
      env.ATRIO_SITE_BUNDLE_OUTPUT_DIR);
    console.log('Bundle estatico gerado OFFLINE, sem deploy: '+result.output);
  }catch{
    // Do not expose legal copies, file paths, tokens or user-supplied inputs.
    console.error('Bundle nao gerado: revisao ou consistencia incompleta.');
    process.exitCode=1;
  }
}
