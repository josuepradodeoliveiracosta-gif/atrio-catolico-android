import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RULES_SCHEMA_CONTRACT,EXPLICIT_UNRESOLVED_SCOPES,
 qaSchemaClassificationSummary} from './qa-firestore-schema-contract.js';
import {OWNED_ROOTS,USER_SUBCOLLECTIONS,GUARDIAN_SUBCOLLECTIONS,
 RELATIONAL_SCOPES,EXTERNAL_SCOPES,buildDeletionPlan} from './deletion-orchestrator.js';

const source=readFileSync(new URL('../../../firestore.rules',import.meta.url),'utf8');
const rulesMatches=source.split('\n').map(line=>
 line.match(/^\s*match\s+(\/.*?)\s*\{\s*$/)).filter(Boolean).map(m=>m[1]);

test('qualquer novo match em firestore.rules exige revisao do inventario de exclusao',()=>{
 assert.deepEqual(rulesMatches,RULES_SCHEMA_CONTRACT.map(x=>x.path),
  'Schema drift: review each new collection and associated deletion/retention rules');
 assert.equal(new Set(rulesMatches).size,rulesMatches.length);
 assert.equal(RULES_SCHEMA_CONTRACT.length,33);
});
test('colecoes pertencentes ao titular permanecem explicitamente enumeradas',()=>{
 for(const name of OWNED_ROOTS)
   assert.ok(RULES_SCHEMA_CONTRACT.some(x=>
     x.path==='/' + name + '/{uid}'&&x.classification==='owned'),name);
 for(const name of USER_SUBCOLLECTIONS)
   assert.ok(RULES_SCHEMA_CONTRACT.some(x=>x.path.includes('/'+name+'/{')&&
     ['owned_nested','relational_foreign_user'].includes(x.classification)),name);
 for(const name of GUARDIAN_SUBCOLLECTIONS)
   assert.ok(RULES_SCHEMA_CONTRACT.some(x=>x.path==='/'+name+'/{noticeId}'&&
     x.classification==='owned_nested'),name);
});
test('todas as colecoes de conteudo, denuncia e auditoria exigem revisao relacional',()=>{
 const names=['posts','replies','reactions','reports','user_reports',
  'guardian_cases','guardian_audit','guardiao_quarantine','notifications'];
 for(const name of names)
   assert.ok(RULES_SCHEMA_CONTRACT.some(x=>
     x.path.includes('/'+name+'/{')&&x.classification.startsWith('relational')),name);
 assert.ok(RELATIONAL_SCOPES.includes('posts/*/replies/*/reactions/*'));
 assert.ok(EXTERNAL_SCOPES.includes('firebase_auth'));
});
test('marcadores e comprovantes de exclusao nao sao apagados como perfil simples',()=>{
 for(const path of ['/account_deletion_freeze/{uid}',
  '/account_deletion_requests/{uid}','/guardian_runtime/{id}']){
   const x=RULES_SCHEMA_CONTRACT.find(x=>x.path===path);
   assert.ok(x);
   assert.ok(!x.classification.startsWith('owned'));
   assert.ok(EXPLICIT_UNRESOLVED_SCOPES.some(y=>y.startsWith(path.slice(1))));
 }
 for(const path of ['account_deletion_freeze','account_deletion_requests','guardian_runtime'])
   assert.ok(!OWNED_ROOTS.includes(path));
});
test('contrato nunca transforma inventario em executor de producao',()=>{
 const r=qaSchemaClassificationSummary();
 assert.equal(r.productionReady,false);
 assert.equal(r.deletionComplete,false);
 assert.equal(r.reviewedRules,33);
 assert.equal(r.uncategorized,0);
 assert.ok(r.unresolvedScopes>=6);
 assert.equal(buildDeletionPlan('qa-user',null,{},{}).safeToExecute,false);
 assert.match(source,/match \/\{document=\*\*\} \{/);
 assert.match(source,/allow read, write: if false;/);
});
