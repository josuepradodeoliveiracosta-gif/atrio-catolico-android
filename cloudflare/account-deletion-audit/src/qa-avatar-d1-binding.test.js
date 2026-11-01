import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createQaAvatarD1Binding,QA_AVATAR_D1_READINESS}
  from './qa-avatar-d1-binding.js';
const A='qa-freeze-alice',B='qa-freeze-bob';
const schema=readFileSync(new URL('../../avatar-worker/schema.sql',import.meta.url),'utf8');
function fixture(kind='avatar_upload',scope={ownerUid:A}){
  const sql=new DatabaseSync(':memory:');sql.exec(schema);
  const db={prepare(query){return {bind(...values){
    const statement=sql.prepare(query);
    return {
      async first(){return statement.get(...values)||null;},
      async run(){return {meta:{changes:statement.run(...values).changes}};}
    };
  }};}};
  const guarded=createQaAvatarD1Binding({db,kind,scope});
  return {sql,guarded};
}
const mutex='INSERT INTO avatar_mutex (uid,nonce,expires_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET nonce=excluded.nonce,expires_at=excluded.expires_at WHERE avatar_mutex.expires_at < ?';
const rate='INSERT INTO avatar_rate (uid,next_at) VALUES (?,?) ON CONFLICT(uid) DO UPDATE SET next_at=excluded.next_at WHERE avatar_rate.next_at <= ?';
const pending='INSERT INTO avatar_pending (uid,public_id,created_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET public_id=excluded.public_id, created_at=excluded.created_at';
const review='INSERT INTO avatar_moderation (actor_uid,target_uid,reason,created_at) VALUES (?,?,?,?)';
const id=uid=>'atrio-avatares/'+uid+'/123e4567-e89b-42d3-a456-426614174000';
const nonce='123e4567-e89b-42d3-a456-426614174000';
test('Avatar QA D1 allows real lock, rate, pending writes only for admitted owner',async()=>{
  const {sql,guarded}=fixture();
  try{
    await guarded.prepare(mutex).bind(A,nonce,120000,1).run();
    await guarded.prepare(rate).bind(A,60000,1).run();
    await guarded.prepare(pending).bind(A,id(A),1).run();
    const record=await guarded.prepare('SELECT public_id FROM avatar_pending WHERE uid=?')
      .bind(A).first();
    assert.equal(record.public_id,id(A));
    await guarded.prepare('DELETE FROM avatar_pending WHERE uid=? AND public_id=?')
      .bind(A,id(A)).run();
    await guarded.prepare('DELETE FROM avatar_mutex WHERE uid=? AND nonce=?')
      .bind(A,nonce).run();
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM avatar_pending').get().n,0);
    assert.equal(QA_AVATAR_D1_READINESS.productionIntegrated,false);
  }finally{sql.close();}
});
test('Avatar QA D1 blocks cross-account SQL even if route owner was admitted',async()=>{
  const {sql,guarded}=fixture();
  try{
    for(const [query,args] of [
      [mutex,[B,nonce,120000,1]],
      [rate,[B,60000,1]],
      [pending,[B,id(B),1]],
      [pending,[A,id(B),1]],
      ['DELETE FROM avatar_pending WHERE uid=?',[B]],
      ['DELETE FROM avatar_pending WHERE uid=? AND public_id=?',[A,id(B)]],
      ['SELECT public_id FROM avatar_pending WHERE uid=?',[B]],
      ['DELETE FROM avatar_mutex WHERE uid=? AND nonce=?',[B,nonce]]
    ]){
      assert.throws(()=>guarded.prepare(query).bind(...args),
        /qa_avatar_d1_identity_or_parameters_denied/);
    }
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM avatar_pending').get().n,0);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM avatar_mutex').get().n,0);
  }finally{sql.close();}
});
test('Avatar QA D1 review requires actor and target to match gate scope',async()=>{
  const {sql,guarded}=fixture('avatar_moderation',{ownerUid:A,actorUid:B});
  try{
    await guarded.prepare(mutex).bind(A,nonce,120000,1).run();
    await guarded.prepare(review).bind(B,A,'Aprovação: foto QA',1).run();
    assert.throws(()=>guarded.prepare(review).bind(A,B,'falsa decisão',1),
      /qa_avatar_d1_identity_or_parameters_denied/);
    assert.throws(()=>guarded.prepare(review).bind(B,B,'falsa decisão',1),
      /qa_avatar_d1_identity_or_parameters_denied/);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM avatar_moderation').get().n,1);
  }finally{sql.close();}
});
test('Avatar QA D1 rejects unknown statements, alternate methods and real UIDs',async()=>{
  const {sql,guarded}=fixture();
  try{
    for(const query of [
      'DELETE FROM avatar_moderation',
      'INSERT INTO avatar_pending(uid,public_id) VALUES (?,?)',
      'UPDATE users SET role = 1',
      'SELECT * FROM avatar_pending',
      'SELECT public_id FROM avatar_pending WHERE uid=?; DROP TABLE avatar_rate'
    ])assert.throws(()=>guarded.prepare(query),/qa_avatar_d1_unreviewed_sql/);
    await assert.rejects(guarded.prepare('SELECT public_id FROM avatar_pending WHERE uid=?')
      .bind(A).run(),/qa_avatar_d1_wrong_method/);
    await assert.rejects(guarded.prepare(rate).bind(A,60000,1).first(),
      /qa_avatar_d1_wrong_method/);
    assert.throws(()=>createQaAvatarD1Binding({
      db:{prepare:()=>{}},scope:{ownerUid:'real-account'},kind:'avatar_upload'
    }),/qa_avatar_d1_invalid_route_context/);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM avatar_rate').get().n,0);
  }finally{sql.close();}
});
