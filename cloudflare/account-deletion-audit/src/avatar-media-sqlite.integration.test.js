/**
 * Integration test with real SQLite schema used by avatar-worker, never D1 live.
 * Cloudinary / Firestore are fake HTTP transports, bound to known hosts.
 * Run in GitHub Actions with Node 22; no accounts, credentials or network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createAvatarD1ReadAdapter} from './avatar-d1-read-adapter.js';
import {createCloudinaryAvatarReadAdapter} from './avatar-cloudinary-read-adapter.js';
import {createAvatarFirestorePhotoReadAdapter} from './avatar-firestore-photo-read-adapter.js';
import {inventoryAvatarMedia,summarizeAvatarMedia} from './avatar-media-inventory.js';

const UID='qa-alice',OTHER='qa-bob';
const uuid=n=>'123e4567-e89b-42d3-a456-'+String(426614174000+n).padStart(12,'0');
const media=(uid,n)=>'atrio-avatares/'+uid+'/'+uuid(n);
const PENDING=media(UID,1),PUBLISHED=media(UID,2);
const SECRET={cloudName:'atrio_fake_qa',apiKey:'123456789012345',apiSecret:'test_only_cloudinary_secret_123456789'};
const OAUTH='test_only_firestore_oauth_token_12345';
const FIRESTORE_PREFIX='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents/';
const SCHEMA=readFileSync(new URL('../../../avatar-worker/schema.sql',import.meta.url),'utf8');

function sqlite() {
  const database=new DatabaseSync(':memory:');
  database.exec(SCHEMA);
  const queries=[];
  const readBinding={
    prepare(sql) {
      assert.match(sql,/^SELECT /);
      assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER)\b/i);
      return {
        bind(...parameters) {
          return {
            async all(){
              queries.push({sql,parameters});
              return {results:database.prepare(sql).all(...parameters).map(row=>({...row}))};
            }
          };
        }
      };
    }
  };
  function insert(sql,...args){
    assert.match(sql,/^INSERT /);
    database.prepare(sql).run(...args);
  }
  function counts(){
    const tables=['avatar_pending','avatar_rate','avatar_mutex','avatar_moderation'];
    return Object.fromEntries(tables.map(t=>[t,
      Number(database.prepare('SELECT COUNT(*) AS n FROM '+t).get().n)]));
  }
  return {database,readBinding,queries,insert,counts};
}

function cloudinaryTransport(files,{failSecondPage=false}={}){
  const calls=[];
  const fetcher=async (url,init)=>{
    const u=new URL(url);
    assert.equal(u.origin,'https://api.cloudinary.com');
    assert.equal(u.pathname.replace(/^\/v1_1\/atrio_fake_qa\/resources\/image\//,'')
      .includes('/'),false);
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error');
    assert.ok(init.headers.Authorization.startsWith('Basic '));
    const type=u.pathname.split('/').at(-1);
    assert.ok(['upload','authenticated'].includes(type));
    const prefix=u.searchParams.get('prefix');
    assert.ok(prefix && prefix.startsWith('atrio-avatares/'));
    const size=Number(u.searchParams.get('max_results'));
    assert.equal(size,100);
    const cursor=u.searchParams.get('next_cursor');
    if(failSecondPage && cursor) throw Error('cloudinary_page_unavailable');
    const offset=cursor ? Number(cursor.replace(/^offset_/,'')||'0') : 0;
    assert.ok(Number.isSafeInteger(offset)&&offset>=0);
    const list=files.filter(f=>f.type===type&&f.public_id.startsWith(prefix));
    const result=list.slice(offset,offset+size).map(f=>({
      type:f.type,public_id:f.public_id,
      secure_url:'https://secret.invalid/not-to-be-returned',
      context:{email:'sensitive@example.test'}
    }));
    calls.push({type,prefix,cursor});
    return new Response(JSON.stringify({
      resources:result,
      ...(offset+size<list.length?{next_cursor:'offset_'+(offset+size)}:{})
    }),{status:200});
  };
  return {fetcher,calls};
}

function photoTransport(id,uid=UID){
  const calls=[];
  const fetcher=async (url,init)=>{
    assert.ok(url.startsWith(FIRESTORE_PREFIX));
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.Authorization,'Bearer '+OAUTH);
    const u=new URL(url);
    assert.equal(u.searchParams.get('mask.fieldPaths'),'photoPublicId');
    assert.equal(u.pathname.split('/').at(-1),uid);
    calls.push(url);
    if(id===null) return new Response('',{status:404});
    return new Response(JSON.stringify({
      name:'projects/atrio-catolico/databases/(default)/documents/profile_photos/'+uid,
      fields:{photoPublicId:{stringValue:id}}
    }),{status:200});
  };
  return {fetcher,calls};
}

async function audit(db,files,photoId=PUBLISHED,opts={}){
  const cloud=cloudinaryTransport(files,opts);
  const photo=photoTransport(photoId);
  const inventory=await inventoryAvatarMedia(UID,{
    d1:createAvatarD1ReadAdapter(db.readBinding,UID),
    cloud:createCloudinaryAvatarReadAdapter(SECRET,cloud.fetcher),
    photo:createAvatarFirestorePhotoReadAdapter(UID,OAUTH,photo.fetcher)
  });
  return {inventory,cloud,photo};
}

test('real avatar schema: pending protected and published image counted, no mutations',async()=>{
  const db=sqlite();
  try{
    db.insert('INSERT INTO avatar_pending (uid,public_id,created_at) VALUES (?,?,?)',
      UID,PENDING,1760000000000);
    db.insert('INSERT INTO avatar_rate (uid,next_at) VALUES (?,?)',UID,1760000000100);
    db.insert('INSERT INTO avatar_pending (uid,public_id,created_at) VALUES (?,?,?)',
      OTHER,media(OTHER,2),1760000000000);
    const original=db.counts();
    const {inventory,cloud,photo}=await audit(db,[
      {type:'authenticated',public_id:PENDING},
      {type:'upload',public_id:PUBLISHED},
      {type:'upload',public_id:media(OTHER,2)}
    ]);
    assert.equal(inventory.summary.pending,1);
    assert.equal(inventory.summary.publishedFirestore,1);
    assert.equal(inventory.summary.rateRecords,1);
    assert.equal(inventory.summary.cloudinaryPublic,1);
    assert.equal(inventory.summary.cloudinaryProtected,1);
    assert.deepEqual(inventory.blockers,[]);
    assert.equal(inventory.globalMediaCoverageComplete,false);
    assert.equal(inventory.safeToExecute,false);
    assert.deepEqual(db.counts(),original);
    assert.equal(photo.calls.length,1);
    assert.ok(cloud.calls.every(c=>c.prefix==='atrio-avatares/'+UID+'/'));
    assert.ok(!JSON.stringify(summarizeAvatarMedia(inventory)).includes(UID));
    assert.ok(db.queries.every(q=>q.sql.startsWith('SELECT ')));
  }finally{db.database.close();}
});

test('real SQLite: orphan Cloudinary files, missing pending assets and published references',async()=>{
  const db=sqlite();
  try{
    db.insert('INSERT INTO avatar_pending (uid,public_id,created_at) VALUES (?,?,?)',
      UID,PENDING,1760000000000);
    const {inventory}=await audit(db,[{type:'upload',public_id:media(UID,3)}],PUBLISHED);
    assert.equal(inventory.summary.missingPending,1);
    assert.equal(inventory.summary.missingPublished,1);
    assert.equal(inventory.summary.unreferenced,1);
    assert.ok(inventory.blockers.includes('pending_d1_asset_not_found'));
    assert.ok(inventory.blockers.includes('published_firestore_asset_not_found'));
    assert.ok(inventory.blockers.includes('unreferenced_cloudinary_assets'));
    assert.equal(inventory.safeToExecute,false);
  }finally{db.database.close();}
});

test('real SQLite: moderation involving two users paginates without deleting evidence',async()=>{
  const db=sqlite();
  try{
    for(let i=0;i<105;i++) db.insert(
      'INSERT INTO avatar_moderation (actor_uid,target_uid,reason,created_at) VALUES (?,?,?,?)',
      UID,OTHER,'QA reason, retain for review',1760000000000+i
    );
    db.insert('INSERT INTO avatar_moderation (actor_uid,target_uid,reason,created_at) VALUES (?,?,?,?)',
      OTHER,UID,'QA reason, retain for review',1760000001000);
    const before=db.counts();
    const {inventory}=await audit(db,[],null);
    assert.equal(inventory.summary.moderationRecords,106);
    assert.ok(inventory.blockers.includes('moderation_retention_review'));
    assert.ok(db.queries.filter(q=>q.sql.includes('actor_uid = ?')).length>=2);
    assert.deepEqual(db.counts(),before);
    assert.equal(inventory.safeToExecute,false);
  }finally{db.database.close();}
});

test('Cloudinary pagination covers 103 fake assets without returning their content',async()=>{
  const db=sqlite();
  try{
    const files=Array.from({length:103},(_,i)=>({
      public_id:media(UID,i+10),type:'upload'
    }));
    const {inventory,cloud}=await audit(db,files,null);
    assert.equal(inventory.summary.cloudinaryPublic,103);
    assert.equal(inventory.summary.unreferenced,103);
    assert.ok(cloud.calls.find(c=>c.cursor==='offset_100'));
    assert.equal(inventory.safeToExecute,false);
    const summary=JSON.stringify(summarizeAvatarMedia(inventory));
    assert.ok(!summary.includes('qa-alice') && !summary.includes('123e4567'));
  }finally{db.database.close();}
});

test('HTTP page outage and wrong-owner photo stop the entire inventory',async()=>{
  const db=sqlite();
  try{
    const files=Array.from({length:102},(_,i)=>({type:'upload',public_id:media(UID,i+10)}));
    await assert.rejects(audit(db,files,null,{failSecondPage:true}),
      /cloudinary_page_unavailable/);
    await assert.rejects(audit(db,[],media(OTHER,2)),
      /invalid_photo_reference/);
    assert.deepEqual(db.counts(),{
      avatar_pending:0,avatar_rate:0,avatar_mutex:0,avatar_moderation:0
    });
  }finally{db.database.close();}
});
