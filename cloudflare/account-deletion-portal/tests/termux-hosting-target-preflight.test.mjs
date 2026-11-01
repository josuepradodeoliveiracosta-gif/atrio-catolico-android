import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {validateTarget,validateRemoteSites,auditHostingSites,PROJECT}
  from '../scripts/termux-hosting-target-preflight.mjs';

const dir=resolve(import.meta.dirname,'..');
const rc=JSON.parse(readFileSync(resolve(dir,'.firebaserc'),'utf8'));
const hosting=JSON.parse(readFileSync(resolve(dir,'firebase.hosting.proposed.json'),'utf8'));
const root=JSON.parse(readFileSync(resolve(dir,'../../firebase.json'),'utf8'));
const first={name:'projects/atrio-catolico/sites/atrio-catolico',
  defaultUrl:'https://atrio-catolico.web.app'};
const second={name:'projects/atrio-catolico/sites/atrio-catolico-exclusao',
  defaultUrl:'https://atrio-catolico-exclusao.web.app'};
const clone=x=>JSON.parse(JSON.stringify(x));
const wrap=result=>JSON.stringify({status:'success',result});

test('mapeamento dedicado nao inclui o site principal nem rewrites',()=>{
  assert.doesNotThrow(()=>validateTarget(rc,hosting,root));
  assert.deepEqual(rc.targets[PROJECT].hosting.deletionPortal,['atrio-catolico-exclusao']);
});
test('falha fechada com redirecionamento para site principal',()=>{
  const bad=clone(rc);bad.targets[PROJECT].hosting.deletionPortal=['atrio-catolico'];
  assert.throws(()=>validateTarget(bad,hosting,root),/destino_portal_incorreto/);
  const bad2=clone(rc);bad2.targets[PROJECT].hosting.otherSite=['atrio-catolico'];
  assert.throws(()=>validateTarget(bad2,hosting,root),/destino_portal_incorreto/);
  const bad3=clone(hosting);bad3.hosting.site='atrio-catolico';
  assert.throws(()=>validateTarget(rc,bad3,root),/configuracao_pode/);
  const bad4=clone(root);bad4.hosting={public:'dist'};
  assert.throws(()=>validateTarget(rc,hosting,bad4),/configuracao_pode/);
});
test('site remoto principal e secundario obrigatorios',()=>{
  assert.deepEqual(validateRemoteSites([first,second]),{
    mainSitePreserved:true,portalSiteRegistered:true
  });
  assert.throws(()=>validateRemoteSites([first]),/sites_necessarios/);
  assert.throws(()=>validateRemoteSites([second]),/sites_necessarios/);
  assert.throws(()=>validateRemoteSites([first,second,second]),/sites_necessarios/);
  assert.throws(()=>validateRemoteSites([{...first,defaultUrl:'https://attacker.test'},second]),
    /url_site_principal/);
});
test('CLI somente leitura; nenhuma mudanca em hospedagem Firebase',()=>{
  const calls=[];
  const result=auditHostingSites(argv=>{
    calls.push(argv);
    if(argv[0]==='git')return 'feature/play-closed-testing-aab-20261031\n';
    if(argv[1]==='hosting:sites:list')return wrap([first,second]);
    throw Error('nao_esperado');
  });
  assert.equal(result.portalSiteRegistered,true);
  assert.deepEqual(calls,[
    ['git','branch','--show-current'],
    ['firebase','hosting:sites:list','--project','atrio-catolico','--json']
  ]);
});
test('nega branch errada sem consultar projeto remoto',()=>{
  const calls=[];
  assert.throws(()=>auditHostingSites(argv=>{calls.push(argv);return 'main\n';}),
    /branch_de_privacidade_incorreta/);
  assert.deepEqual(calls,[['git','branch','--show-current']]);
});
