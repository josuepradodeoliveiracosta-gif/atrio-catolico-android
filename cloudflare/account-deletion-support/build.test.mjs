import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validatedPublicContact,renderSupportPage,buildSupportPage} from './build.mjs';
const good={
  ATRIO_DELETION_SUPPORT_APPROVED:'manual-support-and-privacy-reviewed',
  ATRIO_DELETION_SUPPORT_EMAIL:'privacidade@atrio-catolico.org',
  ATRIO_DELETION_PRIVACY_URL:'https://atrio-catolico.org/privacidade'
};
test('public manual support without account sign-in or form',()=>{
  const html=renderSupportPage(good);
  assert.match(html,/ÁTRIO CATÓLICO/);
  assert.match(html,/Solicitar exclusão por e-mail/);
  assert.match(html,/href="mailto:privacidade@atrio-catolico.org\?subject=/);
  assert.match(html,/Política de Privacidade/);
  assert.match(html,/não exclui a conta imediatamente/);
  assert.match(html,/Não envie senhas/);
  assert.doesNotMatch(html,/<form|<script|type="password"|deleteUser|deleteDoc|firebase/i);
  assert.doesNotMatch(html,/body=|uid=|password=/);
});
test('missing approval, unsafe emails, placeholder hosts, injected params fail closed',()=>{
  const attempts=[
    {},{...good,ATRIO_DELETION_SUPPORT_APPROVED:''},
    {...good,ATRIO_DELETION_SUPPORT_EMAIL:'a@example.com'},
    {...good,ATRIO_DELETION_SUPPORT_EMAIL:'a@host.invalid'},
    {...good,ATRIO_DELETION_SUPPORT_EMAIL:'a@localhost'},
    {...good,ATRIO_DELETION_SUPPORT_EMAIL:'x@host.org\nBcc:another@host.org'},
    {...good,ATRIO_DELETION_SUPPORT_EMAIL:'x@host.org?subject=x'},
    {...good,ATRIO_DELETION_PRIVACY_URL:'http://host.org/privacy'},
    {...good,ATRIO_DELETION_PRIVACY_URL:'https://example.com'},
    {...good,ATRIO_DELETION_PRIVACY_URL:'https://a.test/privacy'},
    {...good,ATRIO_DELETION_PRIVACY_URL:'https://host.org/x?q=secret'},
    {...good,ATRIO_DELETION_PRIVACY_URL:'https://host.org/x#token'},
    {...good,ATRIO_DELETION_PRIVACY_URL:'https://foo:pass@host.org/x'}
  ];
  for(const bad of attempts)assert.throws(()=>validatedPublicContact(bad));
});
test('invalid input does not create output files',()=>{
  const root=mkdtempSync(join(tmpdir(),'atrio-support-locked-'));
  try{
    const output=join(root,'site');
    assert.throws(()=>buildSupportPage({},output));
    assert.equal(existsSync(output),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('draft is fully static, headers deny framing and overwrite is refused',()=>{
  const root=mkdtempSync(join(tmpdir(),'atrio-support-static-'));
  try{
    const output=join(root,'site');
    buildSupportPage(good,output);
    assert.match(readFileSync(join(output,'index.html'),'utf8'),/mailto:/);
    assert.match(readFileSync(join(output,'_headers'),'utf8'),/frame-ancestors 'none'/);
    assert.throws(()=>buildSupportPage(good,output));
  }finally{rmSync(root,{recursive:true,force:true});}
});
