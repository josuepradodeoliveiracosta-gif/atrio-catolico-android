import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {QA_WORKER_SOURCES,QA_MUTATION_ROUTES,QA_READ_ONLY_ROUTES,
 QA_OPEN_WRITE_GAPS,qaCoverageSummary} from './qa-worker-coverage-contract.js';
import {QA_PRIVILEGED_KINDS} from './qa-privileged-write-barrier.js';
const repoRoot=new URL('../../../',import.meta.url);
function gitBlob(bytes){
 return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
test('review pinned full Git blobs before any privileged Worker code drift',()=>{
 for(const spec of QA_WORKER_SOURCES){
   const source=readFileSync(new URL(spec.file,repoRoot));
   assert.equal(gitBlob(source),spec.gitBlob,
     'Source drift: review all privileged write entrypoints and update pin '+spec.file);
   for(const needle of spec.mustContain)
     assert.ok(source.includes(needle),'Missing security-reviewed path '+spec.service+' '+needle);
 }
 assert.equal(new Set(QA_WORKER_SOURCES.map(x=>x.file)).size,4);
});
test('scope every known mutation against the QA barrier vocabulary without pretending runtime integration',()=>{
 const kinds=new Set(QA_PRIVILEGED_KINDS);
 const scopes=new Map(Object.entries({
   avatar_upload:'ownerUid',avatar_promote:'ownerUid',avatar_remove:'ownerUid',
   avatar_moderation:'actorUid,ownerUid',guardian_content_write:'ownerUid',
   guardian_review_write:'actorUid,ownerUid',push_thread_notice:'actorUid,recipientUid',
   push_fcm_send:'recipientUid',push_cleanup_device:'ownerUid'
 }));
 const entries=new Set();
 for(const route of QA_MUTATION_ROUTES){
   assert.ok(kinds.has(route.kind),route.entry);
   assert.equal(route.scope.split(',').sort().join(','),scopes.get(route.kind));
   assert.equal(route.state,'not_integrated');
   const key=route.service+' '+route.entry;
   assert.ok(!entries.has(key),'Duplicate privileged entry '+key);
   entries.add(key);
 }
 assert.equal(QA_MUTATION_ROUTES.length,15);
 for(const service of ['avatar','guardian','push'])
   assert.ok(QA_MUTATION_ROUTES.some(x=>x.service===service));
});
test('deletion readiness fails closed even though isolated protocol tests pass',()=>{
 const readiness=qaCoverageSummary();
 assert.equal(readiness.productionIntegrated,false);
 assert.equal(readiness.safeToExecuteDeletion,false);
 assert.equal(readiness.frozenAccountsProtectedInProduction,false);
 assert.equal(readiness.unprotectedWriteEntries,15);
 assert.equal(readiness.openGaps,10);
 assert.equal(readiness.sourcePins,4);
 assert.ok(QA_OPEN_WRITE_GAPS.some(x=>x.includes('multi-recipient')));
 assert.ok(QA_OPEN_WRITE_GAPS.some(x=>x.includes('older deployed revisions')));
 for(const route of QA_READ_ONLY_ROUTES)
   assert.ok(!QA_MUTATION_ROUTES.some(x=>x.entry===route));
});
test('never silently return to FCM topic delivery for replies or disable freeze preflight',()=>{
 const source=readFileSync(new URL('../../push-worker/src/index.js',import.meta.url),'utf8');
 assert.match(source,/const blockSafeMode = event.kind==='reply';/);
 assert.match(source,/await blockSafeThreadRecipients\(token,uid,event\.recipients\)/);
 assert.match(source,/account_deletion_freeze\/.*enc\(actorUid\)/);
 assert.match(source,/account_deletion_freeze\/.*enc\(uid\)/);
 assert.doesNotMatch(source,/topic\s*:\s*event\.topic/);
 assert.doesNotMatch(source,/PUSH_BLOCK_SAFE_FANOUT_ENABLED\s*===\s*'true'/);
 assert.match(source,/broadcast_privacy_coordinator_required/);
 assert.doesNotMatch(source,/topic\s*:\s*BROADCAST_TOPIC/);
 assert.doesNotMatch(source,/const BROADCAST_TOPIC/);
});
test('security pins are exact internal paths and immutable SHA-1 blob ids',()=>{
 for(const item of QA_WORKER_SOURCES){
   assert.match(item.file,/^cloudflare\/[a-z-]+\/src\/[a-z.-]+\.js$/);
   assert.match(item.gitBlob,/^[a-f0-9]{40}$/);
   assert.ok(item.mustContain.length>=2);
 }
});
