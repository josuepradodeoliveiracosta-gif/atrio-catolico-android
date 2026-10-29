import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync(new URL('../firestore.qa.indexes.json',import.meta.url),'utf8'));
test('manifesto QA mantém os três índices compostos já provisionados',()=>{
  const signatures=new Set(manifest.indexes.map(x=>
    x.collectionGroup+'|'+x.queryScope+'|'+x.fields.map(f=>f.fieldPath+':'+f.order).join('|')));
  for(const signature of [
    'posts|COLLECTION|qaFixture:ASCENDING|createdAt:DESCENDING',
    'replies|COLLECTION_GROUP|qaFixture:ASCENDING|createdAt:DESCENDING',
    'reports|COLLECTION|qaFixture:ASCENDING|createdAt:DESCENDING'
  ])assert.ok(signatures.has(signature),signature);
});
test('replies tem índice collection group de createdAt para cursor __name__',()=>{
  const override=manifest.fieldOverrides.find(x=>x.collectionGroup==='replies'&&x.fieldPath==='createdAt');
  assert.ok(override);
  assert.ok(override.indexes.some(x=>x.queryScope==='COLLECTION_GROUP'&&x.order==='DESCENDING'));
  // Overrides substituem índices padrões: preservar ambos os modos de coleção.
  for(const order of ['ASCENDING','DESCENDING'])
    assert.ok(override.indexes.some(x=>x.queryScope==='COLLECTION'&&x.order===order));
});
test('manifesto QA não contém referências a credenciais ou projetos de produção',()=>{
  const raw=JSON.stringify(manifest);
  assert.equal(raw.includes('serviceAccount'),false);
  assert.equal(raw.includes('private_key'),false);
  assert.equal(raw.includes('atrio-catolico-android'),false);
});
