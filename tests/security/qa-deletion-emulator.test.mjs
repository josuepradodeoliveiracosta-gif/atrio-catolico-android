/**
 * Integration test: ONLY fake users on local Firestore Emulator demo-atrio-v11.
 * SQLite checkpoints and Cloudinary/Auth Sets are test doubles. Never deploy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc} from 'firebase/firestore';
import {QaDeletionRunner,QA_FIXTURES,QA_MEDIA_ID,QA_STEPS}
  from './qa-deletion-executor.mjs';

const HOST='127.0.0.1:8089', PROJECT='demo-atrio-v11';
if(process.env.FIRESTORE_EMULATOR_HOST!==HOST ||
  process.env.GCLOUD_PROJECT!==PROJECT ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  throw Error('test_requires_demo_firestore_emulator_without_real_credentials');

const env=await initializeTestEnvironment({projectId:PROJECT,
  firestore:{host:'127.0.0.1',port:8089,
    rules:readFileSync('firestore.rules','utf8')}});
const alice='qa-delete-alice',bob='qa-delete-bob';
const BOB_MEDIA='atrio-avatares/qa-delete-bob/123e4567-e89b-42d3-a456-426614174002';
async function seed(db,{request=true}={}){
  for(const path of [...QA_FIXTURES.nested,...QA_FIXTURES.relational,
    ...QA_FIXTURES.roots,...QA_FIXTURES.preserved]){
    await setDoc(doc(db,path),{uid:path.includes('qa-delete-bob')?bob:alice,
      body:'FICTITIOUS',origin:'QA only'});
  }
  if(request)await setDoc(doc(db,'account_deletion_requests/'+alice),{
    status:'requested',source:'android',requestedAt:new Date('2026-10-31T12:00:00Z')
  });
}
function mocks(){
  return {journal:new DatabaseSync(':memory:'),media:new Set([QA_MEDIA_ID,BOB_MEDIA]),
    auth:new Set([alice,bob])};
}
async function allAbsent(db,paths){
  for(const path of paths)assert.equal((await getDoc(doc(db,path))).exists(),false,path);
}
async function allPresent(db,paths){
  for(const path of paths)assert.equal((await getDoc(doc(db,path))).exists(),true,path);
}
async function inDemo(fn,{request=true}={}){
  await env.clearFirestore();
  return env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await seed(db,{request});
    const aux=mocks();
    try{return await fn(db,aux);}
    finally{aux.journal.close();}
  });
}

try {
  await test('real Emulator fixture cleanup with QA-only fake Auth and media',async()=>{
    await inDemo(async(db,aux)=>{
      const outcome=await new QaDeletionRunner({db,...aux}).run({approved:true});
      assert.equal(outcome.state,'qa_fixture_cleaned_only');
      assert.equal(outcome.productionReady,false);
      assert.equal(outcome.publicAccountDeleted,false);
      assert.deepEqual(outcome.completed,QA_STEPS);
      await allAbsent(db,[...QA_FIXTURES.nested,...QA_FIXTURES.relational,
        ...QA_FIXTURES.roots]);
      await allPresent(db,QA_FIXTURES.preserved);
      assert.equal(aux.auth.has(alice),false);
      assert.equal(aux.auth.has(bob),true);
      assert.equal(aux.media.has(QA_MEDIA_ID),false);
      assert.equal(aux.media.has(BOB_MEDIA),true);
      assert.equal((await getDoc(doc(db,'account_deletion_requests/'+alice))).exists(),true);
      const second=await new QaDeletionRunner({db,...aux}).run({approved:true});
      assert.deepEqual(second.completed,QA_STEPS);
    });
    console.log('PASS QA DELETION isolated fixtures and repeat');
  });

  await test('restart after every effect including mock Auth, before checkpoint',async()=>{
    for(const phase of QA_STEPS){
      await inDemo(async(db,aux)=>{
        const runner=new QaDeletionRunner({db,...aux});
        await assert.rejects(runner.run({approved:true,failAfterEffect:phase}),
          new RegExp('injected_failure_after_effect:'+phase));
        assert.equal(aux.journal.prepare(
          'SELECT COUNT(*) AS n FROM qa_deletion_checkpoints'
        ).get().n,QA_STEPS.indexOf(phase));
        const restart=new QaDeletionRunner({db,...aux,context:{}});
        const result=await restart.run({approved:true});
        assert.deepEqual(result.completed,QA_STEPS);
        await allPresent(db,QA_FIXTURES.preserved);
        assert.equal(aux.auth.has(bob),true);
        assert.equal(aux.media.has(BOB_MEDIA),true);
      });
    }
    console.log('PASS QA DELETION 8 interrupted steps recovered');
  });

  await test('no user request or no explicit QA approval blocks before any change',async()=>{
    await inDemo(async(db,aux)=>{
      const runner=new QaDeletionRunner({db,...aux});
      await assert.rejects(runner.run({approved:true}),
        /verified_request_required/);
      await allPresent(db,QA_FIXTURES.nested);
      assert.equal(aux.auth.has(alice),true);
    },{request:false});
    await inDemo(async(db,aux)=>{
      const runner=new QaDeletionRunner({db,...aux});
      await assert.rejects(runner.run(),/explicit_qa_approval_required/);
      await allPresent(db,QA_FIXTURES.nested);
      assert.equal(aux.media.has(QA_MEDIA_ID),true);
    });
    console.log('PASS QA DELETION denied if not requested and approved');
  });

  await test('tampered journal cannot skip straight to simulated Auth',async()=>{
    await inDemo(async(db,aux)=>{
      const runner=new QaDeletionRunner({db,...aux});
      aux.journal.prepare('INSERT INTO qa_deletion_checkpoints VALUES (?,1)')
        .run('remove_auth_stub_last');
      await assert.rejects(runner.run({approved:true}),/journal_out_of_order/);
      assert.equal(aux.auth.has(alice),true);
      await allPresent(db,QA_FIXTURES.nested);
    });
    console.log('PASS QA DELETION journal tamper blocked');
  });

  await test('a newly introduced document invalidates an earlier checkpoint',async()=>{
    await inDemo(async(db,aux)=>{
      await assert.rejects(new QaDeletionRunner({db,...aux})
        .run({approved:true,failAfterEffect:'remove_relational'}),
        /injected_failure/);
      await setDoc(doc(db,QA_FIXTURES.nested[0]),{uid:alice,body:'resurrected'});
      await assert.rejects(new QaDeletionRunner({db,...aux,context:{}})
        .run({approved:true}),/previous_checkpoint_invalid:remove_nested/);
      assert.equal(aux.auth.has(alice),true);
      assert.equal(aux.media.has(QA_MEDIA_ID),true);
    });
    console.log('PASS QA DELETION stale checkpoint blocked');
  });

  await test('environment and credentials guards deny non-emulator execution',async()=>{
    await inDemo(async(db,aux)=>{
      const current=process.env.FIRESTORE_EMULATOR_HOST;
      const cloud=process.env.GOOGLE_APPLICATION_CREDENTIALS;
      try{
        process.env.FIRESTORE_EMULATOR_HOST='firestore.googleapis.com:443';
        assert.throws(()=>new QaDeletionRunner({db,...aux}),/local_emulator_required/);
        process.env.FIRESTORE_EMULATOR_HOST=current;
        process.env.GOOGLE_APPLICATION_CREDENTIALS='/tmp/prod-credentials.json';
        assert.throws(()=>new QaDeletionRunner({db,...aux}),/real_service_credentials_present/);
      }finally{
        process.env.FIRESTORE_EMULATOR_HOST=current;
        if(cloud===undefined)delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        else process.env.GOOGLE_APPLICATION_CREDENTIALS=cloud;
      }
      await allPresent(db,QA_FIXTURES.nested);
    });
    console.log('PASS QA DELETION environment guard');
  });
} finally{
  await env.cleanup();
}
