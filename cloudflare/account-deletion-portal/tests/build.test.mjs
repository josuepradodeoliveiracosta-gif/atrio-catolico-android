import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPortal,publicFirebaseConfig} from '../scripts/build.mjs';

const good={
  FIREBASE_WEB_API_KEY:'AIza'+'A'.repeat(35),
  FIREBASE_WEB_APP_ID:'1:123456789:web:abcdef012345',
  FIREBASE_AUTH_DOMAIN:'atrio-catolico.firebaseapp.com',
  FIREBASE_PROJECT_ID:'atrio-catolico'
};
test('exige projeto oficial, domínio e id de aplicativo WEB',()=>{
  for(const [key,bad] of [
    ['FIREBASE_PROJECT_ID','outro-projeto'],
    ['FIREBASE_AUTH_DOMAIN','site-estranho.example'],
    ['FIREBASE_WEB_API_KEY',''],
    ['FIREBASE_WEB_APP_ID','1:123456789:android:abcdef01']
  ]) assert.throws(()=>publicFirebaseConfig({...good,[key]:bad}));
});
test('geração pública contém apenas metadados do Firebase Web',()=>{
  const dir=mkdtempSync(join(tmpdir(),'atrio-web-test-'));
  try {
    const output=join(dir,'site');
    buildPortal(good,output);
    const config=readFileSync(join(output,'config.js'),'utf8');
    assert.match(config,/window\.ATRIO_FIREBASE_CONFIG/);
    assert.match(config,/atrio-catolico/);
    assert.doesNotMatch(config,/(private_key|service_account|oauthToken|password)/i);
    assert.ok(existsSync(join(output,'index.html')));
    assert.ok(existsSync(join(output,'app.js')));
    const page=readFileSync(join(output,'index.html'),'utf8');
    assert.match(page,/não exclui a conta imediatamente/i);
    const client=readFileSync(join(output,'app.js'),'utf8');
    assert.match(client,/inMemoryPersistence/);
    assert.match(client,/getDocFromServer/);
    assert.match(client,/serverTimestamp/);
    assert.match(client,/source:'web'/);
    assert.doesNotMatch(client,/deleteDoc|deleteUser|localStorage\.setItem/);
    const headers=readFileSync(join(output,'_headers'),'utf8');
    assert.match(headers,/Content-Security-Policy:/);
    assert.match(headers,/frame-ancestors 'none'/);
    assert.match(headers,/Cache-Control: no-store/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('nunca gera artefato quando faltam configuração e assinatura web',()=>{
  const dir=mkdtempSync(join(tmpdir(),'atrio-web-missing-'));
  try{
    const target=join(dir,'not-created');
    assert.throws(()=>buildPortal({},target));
    assert.equal(existsSync(target),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
