import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validatePrivacyCopy,renderPrivacyHtml,buildPrivacyPolicy}
  from './privacy-policy.mjs';

const now=new Date('2026-11-02T18:00:00Z');
const copy={
  appName:'Átrio Católico',
  controller:'Responsável legal de homologação QA',
  email:'atriocatolico.privacidade@gmail.com',
  effectiveDate:'2026-11-02',
  dataCategories:'Dados de cadastro, identificadores de conta, conteúdo publicado e registros associados à operação de uma comunidade digital.',
  purposesAndBases:'O tratamento serve a autenticação, funcionamento da comunidade, notificações e segurança; revisão jurídica detalhada nesta fixture.',
  religiousData:'As publicações ou escolhas de identificação podem revelar convicções religiosas e exigem proteção reforçada da legislação brasileira.',
  publicVisibility:'Discussões e respostas são visíveis conforme as configurações de audiência do participante e os controles administrativos.',
  providers:'Serviços de autenticação, banco de dados, armazenamento de imagens e roteamento de notificações podem receber dados operacionais.',
  internationalTransfers:'O responsável deve descrever as transferências internacionais aplicáveis e suas salvaguardas verificadas na infraestrutura.',
  security:'A equipe aplica controles de acesso, gestão de credenciais e revisão de acesso administrativo com auditoria de ações relevantes.',
  retention:'A retenção deve corresponder às finalidades demonstradas, aos prazos aprovados e às exceções legais específicas aplicáveis.',
  deletion:'O usuário pode solicitar exclusão por um canal externo ou dentro do aplicativo, com verificação de titularidade e processamento supervisionado.',
  individualRights:'Os titulares podem solicitar acesso, correção, confirmação de tratamento e eliminação conforme as hipóteses legais aplicáveis.',
  minors:'O responsável precisa definir os requisitos de proteção e a política etária aplicáveis antes da disponibilização de cadastro para menores.',
  contactProcedure:'O contato público de privacidade recebe solicitações, confirma recebimento e orienta o titular sem solicitar senha ou código.',
  approvedBy:'reviewer.qa',
  reviewedAt:'2026-11-02T17:00:00.000Z',
  approval:'policy-owner-and-legal-reviewed'
};
const put=(k,v)=>({...copy,[k]:v});
test('No page can exist without exact review and all required legal content',()=>{
  const failures=[
    put('approval',''),put('reviewedAt','2027-01-01T12:00:00.000Z'),
    put('effectiveDate','2035-01-01'),put('approvedBy',''),
    put('email','qa@example.com'),put('appName','Outra comunidade'),
    put('controller','[A CONFIRMAR]'),
    put('retention','Prazo a definir após consulta jurídica.'),
    put('dataCategories',''),put('internationalTransfers','A confirmar'),
    {...copy,unexpected:'value'},Object.fromEntries(
      Object.entries(copy).filter(([k])=>k!=='security'))
  ];
  for(const x of failures)assert.throws(()=>validatePrivacyCopy(x,{now}));
});
test('Reviewed text gets escaped, is static, accessible, and does not claim effective deletion',()=>{
  const html=renderPrivacyHtml(put('controller','Equipe QA de revisão & privacidade'),{now});
  assert.match(html,/Política de privacidade — Átrio Católico/);
  assert.match(html,/Equipe QA de revisão &amp; privacidade/);
  assert.match(html,/mailto:atriocatolico.privacidade@gmail.com/);
  assert.match(html,/Dados pessoais sensíveis e religião/);
  assert.match(html,/Transferências internacionais/);
  assert.match(html,/Direitos dos titulares/);
  assert.doesNotMatch(html,/<script|<form|Firebase|deleteUser/i);
});
test('Invalid content leaves no output and a valid build never overwrites existing page',()=>{
  const dir=mkdtempSync(join(tmpdir(),'atrio-privacy-qa-'));
  try{
    const output=join(dir,'out');
    assert.throws(()=>buildPrivacyPolicy(put('approval',''),output,{now}));
    assert.equal(existsSync(output),false);
    const path=buildPrivacyPolicy(copy,output,{now});
    assert.match(readFileSync(join(path,'index.html'),'utf8'),/Átrio Católico/);
    assert.match(readFileSync(join(output,'_headers'),'utf8'),/frame-ancestors 'none'/);
    assert.throws(()=>buildPrivacyPolicy(copy,output,{now}),/EEXIST/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
