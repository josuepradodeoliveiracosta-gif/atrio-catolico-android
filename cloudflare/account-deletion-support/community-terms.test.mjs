import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateCommunityTerms,renderCommunityTerms,buildCommunityTerms}
  from './community-terms.mjs';

const now=new Date('2026-11-02T21:00:00Z');
const section='A comunidade exige respeito, não permite abuso e submete denúncias a revisão humana adequada.';
const good={
  appName:'Átrio Católico',controller:'Josué Prado de Oliveira Costa',
  supportEmail:'atriocatolico.privacidade@gmail.com',
  version:'community-v1',effectiveDate:'2026-11-02',
  privacyUrl:'https://atrio-catolico.org/privacidade',
  sections:Object.fromEntries([
    'about','userContent','prohibited','reporting','moderation','privacy','minors','updates'
  ].map(x=>[x,section])),
  approvedBy:'legal.reviewer',reviewedAt:'2026-11-02T20:00:00.000Z',
  approval:'community-terms-owner-and-legal-reviewed'
};
test('public version must agree with Android acceptedTerms format',()=>{
  for(const version of ['ugc-v1','community-v0','community-v01','community-v10000','']){
    assert.throws(()=>validateCommunityTerms({...good,version},{now}),
      /version_incompatible/);
  }
  assert.equal(validateCommunityTerms(good,{now}).version,'community-v1');
});
test('no unreviewed, incomplete or placeholder policy becomes a site',()=>{
  const attempts=[
    {...good,approval:''},{...good,approvedBy:''},
    {...good,reviewedAt:'2026-11-03T01:00:00.000Z'},
    {...good,privacyUrl:'https://example.com/privacidade'},
    {...good,privacyUrl:'https://atrio-catolico-privacidade-qa.pages.dev/'},
    {...good,privacyUrl:'https://atrio-catolico.org?key=x'},
    {...good,sections:{...good.sections,privacy:'[A CONFIRMAR]'}},
    {...good,sections:{...good.sections,privacy:'Curto'}},
    {...good,controller:'Outra pessoa'}, {...good,unwanted:'x'}
  ];
  for(const input of attempts)assert.throws(()=>validateCommunityTerms(input,{now}));
});
test('HTML is escaped and static; no account-delete claim or web side effect',()=>{
  const html=renderCommunityTerms({...good,sections:{
    ...good.sections,about:section+' Associação A & B é respeitada.'
  }},{now});
  assert.match(html,/community-v1/);
  assert.match(html,/Associação A &amp; B/);
  assert.match(html,/mailto:atriocatolico\.privacidade@gmail\.com/);
  assert.match(html,/Denúncias e bloqueio/);
  assert.doesNotMatch(html,/<script|<form|Firebase|deleteUser/i);
});
test('invalid copy leaves no site; valid copy is versioned, never overwritten',()=>{
  const root=mkdtempSync(join(tmpdir(),'atrio-terms-offline-'));
  try{
    const output=join(root,'out');
    assert.throws(()=>buildCommunityTerms({...good,approval:''},output,{now}));
    assert.equal(existsSync(output),false);
    const target=buildCommunityTerms(good,output,{now});
    assert.equal(target,join(output,'termos','community-v1'));
    assert.match(readFileSync(join(target,'index.html'),'utf8'),/community-v1/);
    assert.throws(()=>buildCommunityTerms(good,output,{now}),/EEXIST/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
