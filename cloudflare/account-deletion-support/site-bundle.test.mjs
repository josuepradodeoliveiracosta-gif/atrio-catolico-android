import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectStaticSiteBundle,buildStaticSiteBundle} from './site-bundle.mjs';

const now=new Date('2026-11-03T18:00:00Z');
const email='atriocatolico.privacidade@gmail.com';
const origin='https://atrio-catolico.org';
const policy={
  appName:'Átrio Católico',controller:'Josué Prado de Oliveira Costa',
  email,effectiveDate:'2026-11-02',
  dataCategories:'Dados de cadastro, identificadores de conta, publicações e registros associados à comunidade digital.',
  purposesAndBases:'O tratamento serve a autenticação, funcionamento da comunidade, notificações e segurança, sujeito a revisão jurídica.',
  religiousData:'As publicações e os selos podem revelar convicções religiosas e exigem proteção adicional na legislação brasileira.',
  publicVisibility:'Discussões e respostas são visíveis a outros membros conforme as escolhas de audiência e os controles administrativos.',
  providers:'Fornecedores de autenticação, banco de dados, imagens e roteamento de mensagens podem tratar dados operacionais.',
  internationalTransfers:'O responsável deve descrever eventuais transferências internacionais e as salvaguardas vigentes do aplicativo.',
  security:'A operação necessita controles de acesso, gerenciamento de segredos, revisão administrativa e registro de atividades.',
  retention:'A retenção deverá respeitar finalidades, prazos aprovados e exceções legais específicas e justificadas.',
  deletion:'Solicitações de exclusão demandam conferência de titularidade e processamento de perfil, conteúdo e serviços externos.',
  individualRights:'Titulares podem solicitar acesso, correção, confirmação de tratamento e eliminação dentro das hipóteses legais.',
  minors:'A operação deve esclarecer sua política etária e as medidas de segurança antes de permitir contas de adolescentes.',
  contactProcedure:'O atendimento de privacidade recebe pedidos, confirma o recebimento e orienta sem solicitar senhas ou códigos.',
  approvedBy:'reviewer.qa',reviewedAt:'2026-11-02T17:00:00.000Z',
  approval:'policy-owner-and-legal-reviewed'
};
const section='A comunidade orienta comportamentos respeitosos, oferece bloqueio e denúncias com revisão humana fundamentada.';
const terms={
  appName:'Átrio Católico',controller:policy.controller,supportEmail:email,
  version:'community-v1',effectiveDate:'2026-11-02',
  privacyUrl:origin+'/privacidade',
  sections:Object.fromEntries(['about','userContent','prohibited','reporting',
    'moderation','privacy','minors','updates'].map(x=>[x,section])),
  approvedBy:'reviewer.qa',reviewedAt:'2026-11-02T17:00:00.000Z',
  approval:'community-terms-owner-and-legal-reviewed'
};
const env={
  ATRIO_DELETION_SUPPORT_APPROVED:'manual-support-and-privacy-reviewed',
  ATRIO_DELETION_SUPPORT_EMAIL:email,
  ATRIO_DELETION_PRIVACY_URL:origin+'/privacidade',
  ATRIO_DELETION_SITE_ORIGIN:origin,
  ATRIO_PLAY_COMMUNITY_TERMS_VERSION:'community-v1'
};
const input={env,policy,terms};

test('offline bundle has one consistent external identity and never approves release',()=>{
  const result=inspectStaticSiteBundle(input,{now});
  assert.equal(result.privacyUrl,origin+'/privacidade');
  assert.equal(result.termsUrl,origin+'/termos/community-v1');
  assert.equal(result.files,4);
  for(const field of ['productionPublished','accountDeletionOperational',
    'legalEvidenceVerified','playReleaseAuthorized'])
    assert.equal(result[field],false);
});
test('all pages and security headers assemble atomically without network or deployment',()=>{
  const parent=mkdtempSync(join(tmpdir(),'atrio-bundle-'));
  try{
    const dest=join(parent,'web');
    const result=buildStaticSiteBundle(input,dest,{now});
    assert.equal(result.output,dest);
    const filenames=['index.html','privacidade/index.html',
      'termos/community-v1/index.html','_headers'];
    for(const name of filenames)assert.equal(existsSync(join(dest,name)),true);
    const home=readFileSync(join(dest,'index.html'),'utf8');
    const privacy=readFileSync(join(dest,'privacidade/index.html'),'utf8');
    const terms=readFileSync(join(dest,'termos/community-v1/index.html'),'utf8');
    const headers=readFileSync(join(dest,'_headers'),'utf8');
    assert.match(home,/mailto:atriocatolico\.privacidade@gmail\.com/);
    assert.match(home,/Política de Privacidade/);
    assert.match(privacy,/Dados pessoais sensíveis e religião/);
    assert.match(terms,/community-v1/);
    assert.match(headers,/frame-ancestors 'none'/);
    for(const value of [home,privacy,terms]){
      assert.doesNotMatch(value,/<script|<form|<input|<iframe/i);
      assert.doesNotMatch(value,/firebase\.googleapis\.com|deleteUser|deleteDoc/i);
    }
    assert.throws(()=>buildStaticSiteBundle(input,dest,{now}),
      /atrio_bundle_output_exists/);
  }finally{rmSync(parent,{recursive:true,force:true});}
});
test('incomplete approvals, mismatched links, versions and placeholder origins cannot build',()=>{
  const attempts=[
    {...input,env:{...env,ATRIO_DELETION_SUPPORT_APPROVED:''}},
    {...input,env:{...env,ATRIO_DELETION_SITE_ORIGIN:'https://example.com'}},
    {...input,env:{...env,ATRIO_DELETION_SITE_ORIGIN:'https://atrio-catolico-privacidade-qa.pages.dev'}},
    {...input,env:{...env,ATRIO_DELETION_SITE_ORIGIN:'http://atrio-catolico.org'}},
    {...input,env:{...env,ATRIO_DELETION_SITE_ORIGIN:origin+'/extra'}},
    {...input,env:{...env,ATRIO_DELETION_SITE_ORIGIN:origin+'?token=abc'}},
    {...input,env:{...env,ATRIO_DELETION_PRIVACY_URL:origin+'/outro'}},
    {...input,env:{...env,ATRIO_DELETION_SUPPORT_EMAIL:'outro@host.org'}},
    {...input,env:{...env,ATRIO_PLAY_COMMUNITY_TERMS_VERSION:'community-v2'}},
    {...input,policy:{...policy,approval:''}},
    {...input,policy:{...policy,email:'outro@host.org'}},
    {...input,terms:{...terms,privacyUrl:'https://other.org/privacidade'}},
    {...input,terms:{...terms,approval:''}}
  ];
  const parent=mkdtempSync(join(tmpdir(),'atrio-bundle-fail-'));
  try{
    for(const [i,bad] of attempts.entries()){
      const dest=join(parent,'site-'+i);
      assert.throws(()=>buildStaticSiteBundle(bad,dest,{now}),undefined,
        'must reject mismatched site input '+i);
      assert.equal(existsSync(dest),false);
    }
  }finally{rmSync(parent,{recursive:true,force:true});}
});
