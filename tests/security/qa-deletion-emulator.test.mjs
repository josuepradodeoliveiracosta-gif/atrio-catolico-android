/**
 * Integration test: ONLY fake users on local Firestore Emulator demo-atrio-v11.
 * SQLite checkpoints and Cloudinary/Auth Sets are test doubles. Never deploy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc} from 'firebase/firestore';
import {QaDeletionRunner,QA_FIXTURES,QA_MEDIA_ID,QA_STEPS}
  from './qa-deletion-executor.mjs';
import {QaSqliteLease} from './qa-deletion-sqlite-lease.mjs';

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

  await test('durable QA SQLite journal resumes after closing and reopening connection',async()=>{
    await inDemo(async(db,aux)=>{
      const dir=mkdtempSync(join(tmpdir(),'atrio-qa-resume-'));
      const file=join(dir,'journal.sqlite');
      let disk;
      try{
        disk=new DatabaseSync(file);
        const first=new QaDeletionRunner({
          db,journal:disk,media:aux.media,auth:aux.auth,
          lease:new QaSqliteLease(disk)
        });
        await assert.rejects(first.run({
          approved:true,failAfterEffect:'remove_nested'
        }),/injected_failure_after_effect:remove_nested/);
        assert.deepEqual(first.completed(),['freeze_writes']);
        disk.close();
        disk=new DatabaseSync(file);
        const restarted=new QaDeletionRunner({
          db,journal:disk,media:aux.media,auth:aux.auth,
          context:{},lease:new QaSqliteLease(disk)
        });
        const finished=await restarted.run({approved:true});
        assert.deepEqual(finished.completed,QA_STEPS);
        await allAbsent(db,[...QA_FIXTURES.nested,...QA_FIXTURES.relational,
          ...QA_FIXTURES.roots]);
        await allPresent(db,QA_FIXTURES.preserved);
        assert.equal(aux.auth.has(alice),false);
        assert.equal(aux.auth.has(bob),true);
        const check=disk.prepare('SELECT COUNT(*) AS n FROM qa_deletion_checkpoints').get();
        assert.equal(check.n,QA_STEPS.length);
      }finally{
        try{disk?.close();}catch(_){}
        rmSync(dir,{recursive:true,force:true});
      }
    });
    console.log('PASS QA DELETION durable SQLite restart and resume');
  });

  await test('concurrent QA runners sharing a journal cannot both process one account',async()=>{
    await inDemo(async(db,aux)=>{
      const dir=mkdtempSync(join(tmpdir(),'atrio-qa-concurrent-'));
      const file=join(dir,'journal.sqlite');
      const firstDb=new DatabaseSync(file);
      const secondDb=new DatabaseSync(file);
      try{
        const one=new QaDeletionRunner({
          db,journal:firstDb,media:aux.media,auth:aux.auth,
          lease:new QaSqliteLease(firstDb)
        });
        const two=new QaDeletionRunner({
          db,journal:secondDb,media:aux.media,auth:aux.auth,
          lease:new QaSqliteLease(secondDb)
        });
        // Lease is acquired synchronously, before the first await.
        const first=one.run({approved:true});
        await assert.rejects(two.run({approved:true}),/qa_lease_busy/);
        const result=await first;
        assert.deepEqual(result.completed,QA_STEPS);
        await allPresent(db,QA_FIXTURES.preserved);
        assert.equal(aux.auth.has(bob),true);
        assert.equal(aux.media.has(BOB_MEDIA),true);
        // The next runner can re-verify checkpoints without deleting again.
        const repeat=await two.run({approved:true});
        assert.deepEqual(repeat.completed,QA_STEPS);
      }finally{
        firstDb.close();secondDb.close();
        rmSync(dir,{recursive:true,force:true});
      }
    });
    console.log('PASS QA DELETION concurrent runner denied');
  });

  await test('fail-before-effect in Firestore, mock Cloudinary and mock Auth resumes safely',async()=>{
    for(const phase of ['remove_nested','remove_relational','remove_media_stub',
      'remove_roots','remove_auth_stub_last']){
      await inDemo(async(db,aux)=>{
        const runner=new QaDeletionRunner({db,...aux});
        await assert.rejects(runner.run({approved:true,failBeforeEffect:phase}),
          new RegExp('injected_failure_before_effect:'+phase));
        const checkpoint=runner.completed();
        assert.equal(checkpoint.length,QA_STEPS.indexOf(phase));
        // A failure before Auth must not remove Auth prematurely.
        assert.equal(aux.auth.has(alice),true);
        const restarted=new QaDeletionRunner({db,...aux,context:{}});
        const done=await restarted.run({approved:true});
        assert.deepEqual(done.completed,QA_STEPS);
        await allPresent(db,QA_FIXTURES.preserved);
        assert.equal(aux.media.has(BOB_MEDIA),true);
      });
    }
    console.log('PASS QA DELETION simulated Firestore Cloudinary Auth outages');
  });

  await test('re-scan catches a NEW orphan push device before fake Auth removal',async()=>{
    await inDemo(async(db,aux)=>{
      await assert.rejects(new QaDeletionRunner({db,...aux}).run({
        approved:true,failBeforeEffect:'remove_auth_stub_last'
      }),/injected_failure_before_effect:remove_auth_stub_last/);
      // This ID never appeared in the hardcoded deletion seed.
      await setDoc(doc(db,'users/'+alice+'/pushDevices/lateDevice'),
        {uid:alice,origin:'QA late write'});
      const restarted=new QaDeletionRunner({db,...aux,context:{}});
      await assert.rejects(restarted.run({approved:true}),
        /qa_reconciliation_residual_firestore/);
      assert.equal(aux.auth.has(alice),true,'Auth must remain until fresh scan clears');
      assert.equal(aux.auth.has(bob),true);
      await allPresent(db,QA_FIXTURES.preserved);
    });
    console.log('PASS QA DELETION new orphan before Auth blocked');
  });

  await test('re-scan finds a NEW cross-account notification about deleted user',async()=>{
    await inDemo(async(db,aux)=>{
      await assert.rejects(new QaDeletionRunner({db,...aux}).run({
        approved:true,failBeforeEffect:'remove_auth_stub_last'
      }),/injected_failure_before_effect:remove_auth_stub_last/);
      await setDoc(doc(db,'users/'+bob+'/notifications/lateAliceReference'),
        {uid:bob,actorUid:alice,origin:'QA cross-account reference'});
      const restarted=new QaDeletionRunner({db,...aux,context:{}});
      await assert.rejects(restarted.run({approved:true}),
        /qa_reconciliation_residual_firestore/);
      assert.equal(aux.auth.has(alice),true);
      assert.equal(aux.auth.has(bob),true);
      await allPresent(db,QA_FIXTURES.preserved);
    });
    console.log('PASS QA DELETION new cross-account reference blocked');
  });

  await test('final checkpoint detects reintroduced data even AFTER fake Auth removal',async()=>{
    await inDemo(async(db,aux)=>{
      const first=await new QaDeletionRunner({db,...aux}).run({approved:true});
      assert.equal(first.state,'qa_fixture_cleaned_only');
      await setDoc(doc(db,'users/'+bob+'/notifications/lateMention'),
        {uid:bob,mentionUid:alice,origin:'QA late reference'});
      await assert.rejects(new QaDeletionRunner({db,...aux,context:{}})
        .run({approved:true}),/qa_reconciliation_residual_firestore/);
      assert.equal(aux.auth.has(alice),false);
      assert.equal(aux.auth.has(bob),true);
    });
    console.log('PASS QA DELETION stale final checkpoint blocked');
  });

} finally{
  await env.cleanup();
}
