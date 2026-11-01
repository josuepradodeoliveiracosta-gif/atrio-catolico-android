import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
  QA_WORKER_SOURCES,QA_MUTATION_ROUTES,QA_READ_ONLY_ROUTES,
  QA_OPEN_WRITE_GAPS,qaCoverageSummary
} from './qa-worker-coverage-contract.js';
import {QA_PRIVILEGED_KINDS} from './qa-privileged-write-barrier.js';

const repoRoot=new URL('../../../',import.meta.url);
function gitBlob(value){
  return createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex');
}

test('pin every source byte to force a conscious security review on any Worker change',()=>{
  for(const spec of QA_WORKER_SOURCES){
    const source=readFileSync(new URL(spec.file,repoRoot));
    assert.equal(gitBlob(source),spec.gitBlob,
      'Changed '+spec.file+': review all privileged writes, routes, cron and update this pin explicitly');
    for(const needle of spec.mustContain){
      assert.ok(source.includes(needle),
        'Missing audited write/entry: '+spec.service+' '+needle);
    }
  }
  assert.equal(new Set(QA_WORKER_SOURCES.map(s=>s.file)).size,4);
});

test('every named mutating route has a known barrier kind and scope contract',()=>{
  const kinds=new Set(QA_PRIVILEGED_KINDS);
  const knownScopes=new Map([
    ['avatar_upload','ownerUid'],
    ['avatar_promote','ownerUid'],
    ['avatar_remove','ownerUid'],
    ['avatar_moderation','actorUid,ownerUid'],
    ['guardian_content_write','ownerUid'],
    ['guardian_review_write','actorUid,ownerUid'],
    ['push_thread_notice','actorUid,recipientUid'],
    ['push_fcm_send','recipientUid'],
    ['push_cleanup_device','ownerUid']
  ]);
  const entries=new Set();
  for(const route of QA_MUTATION_ROUTES){
    assert.ok(kinds.has(route.kind),route.entry);
    assert.equal(route.scope.split(',').sort().join(','),knownScopes.get(route.kind));
    assert.equal(route.state,'not_integrated','Do not claim protected without full runtime test');
    const key=route.service+' '+route.entry;
    assert.ok(!entries.has(key),'duplicate route '+key);
    entries.add(key);
  }
  assert.equal(QA_MUTATION_ROUTES.length,15);
  for(const service of ['avatar','guardian','push']){
    assert.ok(QA_MUTATION_ROUTES.some(x=>x.service===service));
  }
});

test('read-only routes stay separately classified and cannot be mistaken for writes',()=>{
  for(const entry of QA_READ_ONLY_ROUTES){
    assert.ok(!QA_MUTATION_ROUTES.some(x=>x.entry===entry));
  }
  assert.ok(QA_READ_ONLY_ROUTES.includes('GET /avatar/moderation/preview'));
});

test('readiness report must fail closed until every privileged path is actually integrated',()=>{
  const status=qaCoverageSummary();
  assert.equal(status.productionIntegrated,false);
  assert.equal(status.safeToExecuteDeletion,false);
  assert.equal(status.frozenAccountsProtectedInProduction,false);
  assert.equal(status.unprotectedWriteEntries,15);
  assert.ok(status.openGaps>=10);
  assert.ok(status.sourcePins>=4);
  assert.ok(QA_OPEN_WRITE_GAPS.some(x=>x.includes('multi-recipient')));
  assert.ok(QA_OPEN_WRITE_GAPS.some(x=>x.includes('older deployed revisions')));
  const snapshot=JSON.stringify(status);
  assert.ok(!snapshot.includes('qa-freeze-alice')&&!snapshot.includes('token'));
});

test('source path names cannot escape the repository root',()=>{
  for(const spec of QA_WORKER_SOURCES){
    assert.match(spec.file,/^cloudflare\/[a-z-]+\/src\/[a-z.-]+\.js$/);
    assert.match(spec.gitBlob,/^[0-9a-f]{40}$/);
    assert.ok(spec.mustContain.length>=2);
  }
});
