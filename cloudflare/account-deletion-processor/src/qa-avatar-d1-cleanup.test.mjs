import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {scrubQaAvatarD1} from './qa-avatar-d1-cleanup.js';

const UID='qa-delete-alice',BOB='qa-delete-bob';
const ID='atrio-avatares/'+UID+'/123e4567-e89b-42d3-a456-426614174001';
const NEXT='atrio-avatares/'+UID+'/123e4567-e89b-42d3-a456-426614174002';
const BOB_ID='atrio-avatares/'+BOB+'/123e4567-e89b-42d3-a456-426614174003';
const saved=Object.fromEntries([
  'GCLOUD_PROJECT','FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST',
  'FIREBASE_CONFIG','GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT_ID',
  'GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_SERVICE_ACCOUNT_JSON',
  'CLOUDINARY_API_SECRET','CLOUDINARY_API_KEY','CLOUDINARY_CLOUD_NAME',
  'ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED'
].map(k=>[k,process.env[k]]));
for(const key of Object.keys(saved))delete process.env[key];
process.env.GCLOUD_PROJECT='demo-atrio-v11';
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8089';
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
test.after(()=>{
  for(const [key,value] of Object.entries(saved))
    if(value===undefined)delete process.env[key];
    else process.env[key]=value;
});
function fixture({pending=true}={}){
  const db=new DatabaseSync(':memory:');
  db.exec([
    'CREATE TABLE avatar_pending(uid TEXT PRIMARY KEY NOT NULL,public_id TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL)',
    'CREATE TABLE avatar_rate(uid TEXT PRIMARY KEY NOT NULL,next_at INTEGER NOT NULL)',
    'CREATE TABLE avatar_mutex(uid TEXT PRIMARY KEY NOT NULL,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL)',
    'CREATE TABLE avatar_moderation(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_uid TEXT NOT NULL,target_uid TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL)'
  ].join(';')+';');
  if(pending)db.prepare('INSERT INTO avatar_pending VALUES (?,?,?)').run(UID,ID,100);
  db.prepare('INSERT INTO avatar_rate VALUES (?,?)').run(UID,110);
  db.prepare('INSERT INTO avatar_pending VALUES (?,?,?)').run(BOB,BOB_ID,200);
  db.prepare('INSERT INTO avatar_rate VALUES (?,?)').run(BOB,210);
  let approved=true,frozen=true,cloudGone=true;
  const options={
    db,uid:UID,
    assertAuthorized:async()=>approved,
    assertFrozen:async()=>frozen,
    verifyCloudinaryGone:async()=>cloudGone
  };
  const count=(table,uid=UID)=>db.prepare(
    'SELECT COUNT(*) AS n FROM '+table+' WHERE uid=?').get(uid).n;
  return {db,options,count,
    setApproved:x=>{approved=x;},setFrozen:x=>{frozen=x;},
    setCloudGone:x=>{cloudGone=x;}
  };
}
test('limpa apenas D1 fictício com prova de Cloudinary, preserva conta alheia e permite retry',async()=>{
  const q=fixture();
  try{
    const r=await scrubQaAvatarD1(q.options);
    assert.equal(r.status,'qa_in_memory_avatar_d1_cleaned');
    assert.equal(r.productionReady,false);
    assert.equal(r.erasedPendingFixture,1);
    assert.equal(q.count('avatar_pending'),0);
    assert.equal(q.count('avatar_rate'),0);
    assert.equal(q.count('avatar_pending',BOB),1);
    assert.equal(q.count('avatar_rate',BOB),1);
    assert.equal((await scrubQaAvatarD1(q.options)).erasedPendingFixture,0);
  }finally{q.db.close();}
});
test('Cloudinary residual ou resultado incerto impede qualquer exclusão D1',async()=>{
  for(const answer of [false,undefined]){
    const q=fixture();
    try{
      q.options.verifyCloudinaryGone=async()=>answer;
      await assert.rejects(scrubQaAvatarD1(q.options),/cloudinary_residual_or_unknown/);
      assert.equal(q.count('avatar_pending'),1);
      assert.equal(q.count('avatar_rate'),1);
    }finally{q.db.close();}
  }
});
test('não elimina mídia com public_id fora do namespace UID',async()=>{
  const q=fixture();
  try{
    q.db.prepare('UPDATE avatar_pending SET public_id=? WHERE uid=?')
      .run('atrio-avatares/'+BOB+'/123e4567-e89b-42d3-a456-426614174004',UID);
    await assert.rejects(scrubQaAvatarD1(q.options),/untrusted_media_ownership/);
    assert.equal(q.count('avatar_pending'),1);
  }finally{q.db.close();}
});
test('trava operação em trânsito antes de mutar D1',async()=>{
  const q=fixture();
  try{
    q.db.prepare('INSERT INTO avatar_mutex VALUES (?,?,?)')
      .run(UID,'qa-nonce',99999);
    await assert.rejects(scrubQaAvatarD1(q.options),/avatar_operation_inflight/);
    assert.equal(q.count('avatar_rate'),1);
  }finally{q.db.close();}
});
test('não apaga dados de moderação relativos ao titular ou terceiro',async()=>{
  for(const pair of [[UID,BOB],[BOB,UID]]){
    const q=fixture();
    try{
      q.db.prepare('INSERT INTO avatar_moderation(actor_uid,target_uid,reason,created_at) VALUES (?,?,?,?)')
        .run(pair[0],pair[1],'qa evidence',120);
      await assert.rejects(scrubQaAvatarD1(q.options),/moderation_retention_unresolved/);
      assert.equal(q.count('avatar_pending'),1);
      assert.equal(q.count('avatar_rate'),1);
    }finally{q.db.close();}
  }
});
test('falha fechada sem congelamento distribuído ou aprovação',async()=>{
  const q=fixture();
  try{
    q.setFrozen(false);
    await assert.rejects(scrubQaAvatarD1(q.options),/freeze_unverified/);
    q.setFrozen(true);q.setApproved(false);
    await assert.rejects(scrubQaAvatarD1(q.options),/approval_revoked/);
    assert.equal(q.count('avatar_pending'),1);
  }finally{q.db.close();}
});
test('alteração concorrente do public_id não apaga mídia nova sem prova',async()=>{
  const q=fixture();
  try{
    q.options.verifyCloudinaryGone=async()=>{
      q.db.prepare('DELETE FROM avatar_pending WHERE uid=?').run(UID);
      q.db.prepare('INSERT INTO avatar_pending VALUES (?,?,?)').run(UID,NEXT,130);
      return true;
    };
    await assert.rejects(scrubQaAvatarD1(q.options),/pending_changed_during_cleanup/);
    assert.equal(q.db.prepare('SELECT public_id FROM avatar_pending WHERE uid=?')
      .get(UID).public_id,NEXT);
    assert.equal(q.count('avatar_rate'),1);
  }finally{q.db.close();}
});
test('mudança de schema e novas tabelas exigem revisão antes da limpeza',async()=>{
  for(const sql of [
    'ALTER TABLE avatar_pending ADD COLUMN new_private_value TEXT',
    'CREATE TABLE new_identity(uid TEXT)'
  ]){
    const q=fixture();
    try{
      q.db.exec(sql);
      await assert.rejects(scrubQaAvatarD1(q.options),/unknown_(schema|table)/);
      assert.equal(q.count('avatar_pending'),1);
    }finally{q.db.close();}
  }
});
test('nega SQLite não local, inclusive bancos anexados',async()=>{
  const q=fixture();
  try{
    q.db.exec("ATTACH DATABASE ':memory:' AS unexpected");
    await assert.rejects(scrubQaAvatarD1(q.options),/not_in_memory/);
  }finally{q.db.close();}
});
test('nega UID real e variáveis de credenciais de produção',async()=>{
  const q=fixture();
  try{
    await assert.rejects(scrubQaAvatarD1({...q.options,uid:'uid-real'}),/non_fixture_uid/);
    process.env.CLOUDINARY_API_SECRET='should-never-be-used';
    await assert.rejects(scrubQaAvatarD1(q.options),/untrusted_environment/);
    delete process.env.CLOUDINARY_API_SECRET;
    assert.equal(q.count('avatar_pending'),1);
  }finally{delete process.env.CLOUDINARY_API_SECRET;q.db.close();}
});

test('same public_id with newer created_at is not erased under stale Cloudinary proof',async()=>{
  const q=fixture();
  try{
    q.options.verifyCloudinaryGone=async()=>{
      q.db.prepare('UPDATE avatar_pending SET created_at=? WHERE uid=?')
        .run(777,UID);
      return true;
    };
    await assert.rejects(scrubQaAvatarD1(q.options),
      /pending_changed_during_cleanup/);
    assert.equal(q.count('avatar_pending'),1);
    assert.equal(q.count('avatar_rate'),1);
    assert.equal(q.db.prepare('SELECT created_at FROM avatar_pending WHERE uid=?')
      .get(UID).created_at,777);
    assert.equal(q.count('avatar_pending',BOB),1);
  }finally{q.db.close();}
});
test('new rate version during media readback cannot be erased',async()=>{
  const q=fixture();
  try{
    q.options.verifyCloudinaryGone=async()=>{
      q.db.prepare('UPDATE avatar_rate SET next_at=? WHERE uid=?').run(888,UID);
      return true;
    };
    await assert.rejects(scrubQaAvatarD1(q.options),
      /rate_changed_during_cleanup/);
    assert.equal(q.count('avatar_pending'),1);
    assert.equal(q.count('avatar_rate'),1);
    assert.equal(q.db.prepare('SELECT next_at FROM avatar_rate WHERE uid=?')
      .get(UID).next_at,888);
  }finally{q.db.close();}
});
test('late mutex and moderation records deny deletion after remote media check',async t=>{
  for(const kind of ['mutex','moderation']){
    await t.test(kind,async()=>{
      const q=fixture();
      try{
        q.options.verifyCloudinaryGone=async()=>{
          if(kind==='mutex')
            q.db.prepare('INSERT INTO avatar_mutex VALUES (?,?,?)')
              .run(UID,'qa-late-operation',777);
          else
            q.db.prepare(
              'INSERT INTO avatar_moderation(actor_uid,target_uid,reason,created_at) VALUES (?,?,?,?)'
            ).run(BOB,UID,'qa-new-retention-hold',777);
          return true;
        };
        await assert.rejects(scrubQaAvatarD1(q.options),
          /fence_or_retention_changed/);
        assert.equal(q.count('avatar_pending'),1);
        assert.equal(q.count('avatar_rate'),1);
        assert.equal(q.count('avatar_pending',BOB),1);
      }finally{q.db.close();}
    });
  }
});
test('rate row inserted during remote media proof is preserved and blocks stale cleanup',async()=>{
  const q=fixture();
  try{
    q.db.prepare('DELETE FROM avatar_rate WHERE uid=?').run(UID);
    q.options.verifyCloudinaryGone=async()=>{
      q.db.prepare('INSERT INTO avatar_rate(uid,next_at) VALUES (?,?)').run(UID,999);
      return true;
    };
    await assert.rejects(scrubQaAvatarD1(q.options),
      /rate_changed_during_cleanup/);
    assert.equal(q.count('avatar_pending'),1);
    assert.equal(q.count('avatar_rate'),1);
  }finally{q.db.close();}
});
test('idempotent retry without a baseline rate row preserves neighbor',async()=>{
  const q=fixture();
  try{
    q.db.prepare('DELETE FROM avatar_rate WHERE uid=?').run(UID);
    const first=await scrubQaAvatarD1(q.options);
    assert.equal(first.erasedPendingFixture,1);
    const retry=await scrubQaAvatarD1(q.options);
    assert.equal(retry.erasedPendingFixture,0);
    assert.equal(q.count('avatar_pending'),0);
    assert.equal(q.count('avatar_rate'),0);
    assert.equal(q.count('avatar_pending',BOB),1);
    assert.equal(q.count('avatar_rate',BOB),1);
  }finally{q.db.close();}
});
