import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..','..');
const load=p=>readFileSync(resolve(root,p),'utf8');

test('site is never enabled by the repository template',()=>{
  const template=load('web/account-deletion/config.example.js');
  assert.match(template,/ATRIO_ACCOUNT_DELETION_REQUESTS_ENABLED = false/);
  assert.ok(!existsSync(resolve(root,'web/account-deletion/config.js')));
});
test('sign-in needs Firebase and never saves login persistently',()=>{
  const app=load('web/account-deletion/app.js');
  assert.match(app,/signInWithEmailAndPassword/);
  assert.match(app,/inMemoryPersistence/);
  assert.match(app,/getDocFromServer/);
  assert.match(app,/serverTimestamp\(\)/);
  assert.match(app,/source: 'web'/);
  assert.match(app,/config.projectId === 'atrio-catolico'/);
  assert.doesNotMatch(app,/deleteUser\(|deleteDoc\(|localStorage|sessionStorage|indexedDB/);
});
test('public page requires JS, CSP, user confirmation, and never sends passwords in a form',()=>{
  const page=load('web/account-deletion/index.html');
  assert.match(page,/Content-Security-Policy/);
  assert.match(page,/form-action 'none'/);
  assert.match(page,/type="password"/);
  assert.match(page,/src="\.\/config\.js"/);
  assert.match(page,/type="module" src="\.\/app\.js"/);
  assert.match(page,/não excluirá a conta imediatamente/i);
});
test('Firestore rule includes only two authenticated origins and immutable request',()=>{
  const rules=load('firestore.rules');
  const start=rules.indexOf('match /account_deletion_requests/{uid}');
  assert.ok(start>0);
  const section=rules.slice(start,start+650);
  assert.match(section,/me\(uid\)/);
  assert.match(section,/source in \['android', 'web'\]/);
  assert.match(section,/allow list: if false/);
  assert.match(section,/allow update, delete: if false/);
});
