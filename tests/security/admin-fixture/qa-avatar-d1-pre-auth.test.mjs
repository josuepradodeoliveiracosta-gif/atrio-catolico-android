import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createQaAvatarD1PreAuthAdapter,QA_AVATAR_D1_PREFLIGHT}
  from './qa-avatar-d1-pre-auth.mjs';

const A='qa-delete-alice',B='qa-delete-bob';
const schema=readFileSync(new URL('../../../cloudflare/avatar-worker/schema.sql',import.meta.url),'utf8');
function fixture(run){
  const sql=new DatabaseSync(':memory:');
  sql.exec(schema);
  const preflight=createQaAvatarD1PreAuthAdapter(sql);
  try{return run({sql,preflight});}
  finally{sql.close();}
}
test('empty owner D1 inventory permits only synthetic Alice; Bob records are preserved',async()=>fixture(async({sql,preflight})=>{
  sql.prepare('INSERT INTO avatar_rate(uid,next_at) VALUES (?,?)').run(B,100);
  assert.equal(await preflight.assertOwnerCleared(A),true);
  await assert.rejects(preflight.assertOwnerCleared(B),/qa_avatar_d1_other_account_denied/);
  assert.equal(sql.prepare('SELECT uid FROM avatar_rate WHERE uid=?').get(B).uid,B);
  assert.equal(QA_AVATAR_D1_PREFLIGHT.productionIntegrated,false);
  assert.equal(QA_AVATAR_D1_PREFLIGHT.realLegalRetentionReviewed,false);
}));
test('all five Avatar D1 source roles independently block Auth preflight',async()=>fixture(async({sql,preflight})=>{
  const id=uid=>'atrio-avatares/'+uid+'/123e4567-e89b-42d3-a456-426614174000';
  const inserts=[
    ['INSERT INTO avatar_pending(uid,public_id,created_at) VALUES (?,?,?)',[A,id(A),1]],
    ['INSERT INTO avatar_rate(uid,next_at) VALUES (?,?)',[A,123]],
    ['INSERT INTO avatar_mutex(uid,nonce,expires_at) VALUES (?,?,?)',[A,'qa-nonce',100]],
    ['INSERT INTO avatar_moderation(actor_uid,target_uid,reason,created_at) VALUES (?,?,?,?)',[A,B,'qa-review',1]],
    ['INSERT INTO avatar_moderation(actor_uid,target_uid,reason,created_at) VALUES (?,?,?,?)',[B,A,'qa-target',1]]
  ];
  const tables=['avatar_pending','avatar_rate','avatar_mutex','avatar_moderation','avatar_moderation'];
  for(let i=0;i<inserts.length;i++){
    const [statement,params]=inserts[i];
    sql.prepare(statement).run(...params);
    await assert.rejects(preflight.assertOwnerCleared(A),/qa_avatar_d1_owned_rows_remaining/,tables[i]);
    sql.prepare('DELETE FROM '+tables[i]+' WHERE '+
      (tables[i]==='avatar_moderation'?'actor_uid=? OR target_uid=?':'uid=?'))
      .run(...(tables[i]==='avatar_moderation'?[A,A]:[A]));
    assert.equal(await preflight.assertOwnerCleared(A),true);
  }
}));
test('new D1 table or unexpected column fails closed instead of silently excluding data',async()=>fixture(async({sql,preflight})=>{
  sql.exec('CREATE TABLE avatar_extra(uid TEXT NOT NULL)');
  await assert.rejects(preflight.assertOwnerCleared(A),/qa_avatar_d1_unreviewed_tables/);
}));
test('a replaced unsafe host forbids D1 preflight even on a previously created adapter',async()=>fixture(async({preflight})=>{
  const before=process.env.FIRESTORE_EMULATOR_HOST;
  try{
    process.env.FIRESTORE_EMULATOR_HOST='firestore.googleapis.com:443';
    await assert.rejects(preflight.assertOwnerCleared(A),/qa_avatar_d1_nonlocal_environment/);
  }finally{process.env.FIRESTORE_EMULATOR_HOST=before;}
}));
