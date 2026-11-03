import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareD1TableMetadata,compareD1MetadataPair}
  from './qa-live-d1-schema-review.js';

const sql=service=>readFileSync(new URL(
  '../../../cloudflare/'+(service==='avatar'?'avatar-worker':'push-worker')+
  '/schema.sql',import.meta.url),'utf8');
function localSqliteMaster(service){
  const regex=/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z_]+)\s*\(([\s\S]*?)\);/gi;
  const rows=[...sql(service).matchAll(regex)].map(m=>({
    name:m[1],sql:'CREATE TABLE '+m[1]+' ('+m[2]+')'
  }));
  // sqlite_master includes this internal metadata table in Cloudflare.
  rows.unshift({name:'_cf_KV',sql:'CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID'});
  return rows;
}
test('live-style SQLite DDL matches reviewed D1 code schema, without reading data',()=>{
  const avatar=compareD1TableMetadata('avatar',localSqliteMaster('avatar'));
  const push=compareD1TableMetadata('push',localSqliteMaster('push'));
  assert.equal(avatar.reviewedTables,4);
  assert.equal(push.reviewedTables,3);
  assert.equal(avatar.reviewedColumns,13);
  assert.equal(push.reviewedColumns,11);
  for(const x of [avatar,push]){
    assert.equal(x.schemaMatchesReviewedSource,true);
    assert.equal(x.cloudflareAccountVerified,false);
    assert.equal(x.sourceAuthenticityVerified,false);
    assert.equal(x.retentionLegallyApproved,false);
    assert.equal(x.playReleaseAuthorized,false);
  }
  const all=compareD1MetadataPair({
    avatar:localSqliteMaster('avatar'),push:localSqliteMaster('push')
  });
  assert.equal(all.totalTables,7);
  assert.equal(all.totalColumns,24);
  assert.equal(all.playReleaseAuthorized,false);
});
test('read-only schema review rejects altered columns and invented tables',()=>{
  const cases=[
    ['avatar',x=>x.find(v=>v.name==='avatar_rate').sql=
      x.find(v=>v.name==='avatar_rate').sql.replace(
        'next_at INTEGER NOT NULL','next_at INTEGER NOT NULL, secret_uid TEXT')],
    ['avatar',x=>x.find(v=>v.name==='avatar_pending').sql=
      x.find(v=>v.name==='avatar_pending').sql.replace(
        'public_id TEXT NOT NULL UNIQUE','public_id BLOB NOT NULL UNIQUE')],
    ['push',x=>x.find(v=>v.name==='delivered').sql=
      x.find(v=>v.name==='delivered').sql.replace(
        'event_key TEXT PRIMARY KEY NOT NULL',
        'event_key TEXT PRIMARY KEY NOT NULL, device_token TEXT')],
    ['push',x=>x.push({name:'unknown_cache',sql:'CREATE TABLE unknown_cache (uid TEXT)'})],
    ['avatar',x=>x.splice(x.findIndex(v=>v.name==='avatar_mutex'),1)],
    ['avatar',x=>x.push({...x[1]})]
  ];
  for(const [service,change] of cases){
    const rows=localSqliteMaster(service);
    change(rows);
    assert.throws(()=>compareD1TableMetadata(service,rows));
  }
});
test('SQL injection or unrecognized DDL cannot be treated as verified metadata',()=>{
  const cases=[
    x=>x[1].sql+='; DELETE FROM avatar_rate;',
    x=>x[1].name='avatar_rate_extra',
    x=>x[1].sql='CREATE TABLE avatar_rate (uid TEXT); DROP TABLE avatar_pending',
    x=>x.push({name:'_cf_KV',sql:'CREATE TABLE _cf_KV (key TEXT)'}),
    x=>x[1].token='unreviewed metadata',
    x=>x[0].sql='CREATE VIEW _cf_KV AS SELECT * FROM avatar_rate',
    x=>x[1].sql='CREATE TABLE avatar_rate (uid TEXT) WITHOUT ROWID',
    x=>x.splice(0,1,{name:'unknown_system',sql:'CREATE TABLE unknown_system (a TEXT)'})
  ];
  for(const mutate of cases){
    const rows=localSqliteMaster('avatar');
    mutate(rows);
    assert.throws(()=>compareD1TableMetadata('avatar',rows));
  }
  assert.throws(()=>compareD1TableMetadata('unknown',localSqliteMaster('avatar')));
  assert.throws(()=>compareD1MetadataPair({avatar:localSqliteMaster('avatar')}));
});
