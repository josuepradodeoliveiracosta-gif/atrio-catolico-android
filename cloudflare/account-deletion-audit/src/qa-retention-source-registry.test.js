import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RULES_SCHEMA_CONTRACT} from './qa-firestore-schema-contract.js';
import {EXTERNAL_SCOPES} from './deletion-orchestrator.js';
import {
 D1_REVIEW_TABLES,retentionReviewRegistry,requireD1ReviewCoverage,
 parsedD1Tables,parsedD1Definitions,retentionReadiness
} from './qa-retention-source-registry.js';

const read=(name)=>readFileSync(new URL('../../../'+name,import.meta.url),'utf8');

test('all seven existing Cloudflare D1 tables require explicit retention review',()=>{
 for(const [service,path] of [
   ['avatar','cloudflare/avatar-worker/schema.sql'],
   ['push','cloudflare/push-worker/schema.sql']
 ]){
   const review=requireD1ReviewCoverage(service,read(path));
   assert.equal(review.legalRetentionApproved,false);
   assert.equal(review.productionInventoryVerified,false);
   assert.deepEqual(review.reviewedSchemaNames,
     D1_REVIEW_TABLES.filter(x=>x.service===service).map(x=>x.table).sort());
 }
 assert.equal(D1_REVIEW_TABLES.length,7);
 assert.equal(requireD1ReviewCoverage('avatar',
   read('cloudflare/avatar-worker/schema.sql')).reviewedColumns,15);
 assert.equal(requireD1ReviewCoverage('push',
   read('cloudflare/push-worker/schema.sql')).reviewedColumns,11);
});
test('new D1 table, removed table, duplicate or bad schema cannot silently pass',()=>{
 const push=read('cloudflare/push-worker/schema.sql');
 const avatar=read('cloudflare/avatar-worker/schema.sql');
 for(const change of [
   push+'\nCREATE TABLE IF NOT EXISTS recipient_tokens(uid TEXT);\n',
   push.replace('CREATE TABLE IF NOT EXISTS delivered','CREATE TABLE IF NOT EXISTS deleted'),
   push.replace('CREATE TABLE IF NOT EXISTS delivered','CREATE TABLE IF NOT EXISTS delivred'),
   avatar+'\nCREATE TABLE IF NOT EXISTS avatar_pending(id TEXT);\n'
 ]){
   assert.throws(()=>requireD1ReviewCoverage(
     change===avatar+'\nCREATE TABLE IF NOT EXISTS avatar_pending(id TEXT);\n'?'avatar':'push',change));
 }
 assert.throws(()=>parsedD1Tables(''));
 assert.throws(()=>requireD1ReviewCoverage('unlisted',push));
});
test('existing D1 tables cannot silently gain a UID, token or sensitive column',()=>{
 const avatar=read('cloudflare/avatar-worker/schema.sql');
 const push=read('cloudflare/push-worker/schema.sql');
 const changes=[
   ['avatar',avatar.replace('public_id TEXT NOT NULL UNIQUE',
     'public_id TEXT NOT NULL UNIQUE, secret_token TEXT')],
   ['avatar',avatar.replace('public_id TEXT NOT NULL UNIQUE',
     'public_id BLOB NOT NULL UNIQUE')],
   ['avatar',avatar.replace('nonce TEXT NOT NULL,','nonce TEXT NOT NULL DEFAULT 0,')],
   ['push',push.replace('events INTEGER NOT NULL DEFAULT 1,',
     'events INTEGER NOT NULL DEFAULT 1, recipient_uid TEXT,')],
   ['push',push.replace('PRIMARY KEY (hour_bucket, kind, outcome, fcm_http_status)',
     'PRIMARY KEY (hour_bucket, kind, outcome)')],
   ['push',push.replace('attempted INTEGER NOT NULL DEFAULT 0,','')],
   ['push',push+'\nALTER TABLE delivered ADD COLUMN user_uid TEXT;\n']
 ];
 for(const [service,source] of changes)
   assert.throws(()=>requireD1ReviewCoverage(service,source),
     /retention_d1_(column_or_constraint_drift_review_required|schema_drift_review_required)/);
 const parsed=parsedD1Definitions(push);
 assert.equal(parsed.push_delivery_stats.at(-1),
   'primary key(hour_bucket,kind,outcome,fcm_http_status)');
 assert.throws(()=>parsedD1Definitions(push.replace(
   'PRIMARY KEY (hour_bucket, kind, outcome, fcm_http_status)',
   'PRIMARY KEY (hour_bucket, kind, outcome, fcm_http_status')), ')),
   /retention_d1_schema_unbalanced/);
});

test('push event keys never receive a no-personal-data or automatic-delete exemption',()=>{
 const events=D1_REVIEW_TABLES.filter(x=>x.service==='push');
 assert.deepEqual(events.map(x=>x.table).sort(),
   ['delivered','guardiao_ai_budget','push_delivery_stats']);
 assert.equal(events.find(x=>x.table==='delivered').identityRisk,
   'event_key_may_encode_identity');
 assert.equal(events.find(x=>x.table==='guardiao_ai_budget').identityRisk,
   'event_key_may_encode_identity');
 assert.equal(events.find(x=>x.table==='push_delivery_stats').review,
   'aggregate_verification');
});
test('all Firestore Rules scopes and external inventory scopes remain represented',()=>{
 const rows=retentionReviewRegistry();
 const expected=RULES_SCHEMA_CONTRACT.map(x=>x.path)
   .filter(x=>!['/databases/{database}/documents','/{document=**}'].includes(x));
 assert.deepEqual(rows.filter(x=>x.source==='firestore').map(x=>x.id).sort(),
   expected.map(x=>'firestore:'+x).sort());
 assert.deepEqual(rows.filter(x=>x.source==='external').map(x=>x.id).sort(),
   EXTERNAL_SCOPES.map(x=>'external:'+x).sort());
 assert.ok(rows.some(x=>x.id==='firestore:/account_deletion_requests/{uid}'));
 assert.ok(rows.some(x=>x.id==='firestore:/account_deletion_freeze/{uid}'));
 assert.ok(rows.some(x=>x.id==='firestore:/guardian_runtime/{id}'));
 assert.ok(rows.some(x=>x.id==='d1:avatar:avatar_moderation'));
});
test('no source decision can be inferred from static inventory',()=>{
 const rows=retentionReviewRegistry();
 assert.equal(rows.length,43);
 assert.equal(new Set(rows.map(x=>x.id)).size,rows.length);
 for(const row of rows){
   assert.equal(row.retentionState,'legal_and_operational_review_required');
   assert.equal(row.retentionPeriodDays,null);
   assert.equal(row.lawfulBasisReviewed,false);
   assert.equal(row.thirdPartyRightsReviewed,false);
   assert.equal(row.automaticDeletionAuthorized,false);
   assert.equal(row.productionEvidenceUrl,null);
   assert.ok(!JSON.stringify(row).includes('qa-delete-alice'));
 }
 const status=retentionReadiness();
 assert.deepEqual({
   sourceScopes:status.sourceScopes,firestoreScopes:status.firestoreScopes,
   d1Tables:status.d1Tables,externalSources:status.externalSources,
   decisionsApproved:status.decisionsApproved
 },{sourceScopes:43,firestoreScopes:31,d1Tables:7,
   externalSources:5,decisionsApproved:0});
 assert.equal(status.productionInventoryVerified,false);
 assert.equal(status.legalRetentionApproved,false);
 assert.equal(status.accountDeletionAuthorized,false);
 assert.equal(status.playReleaseAuthorized,false);
});
