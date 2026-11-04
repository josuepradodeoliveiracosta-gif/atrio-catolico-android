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
import {QaAdministrativeDeletionExecutor,QA_ADMIN_ORDER_TEMPLATE}
  from './qa-admin-executor.mjs';

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
// Only fixture admin service can issue QA cases on the same SQLite journal.
function approvedCase(service,order=QA_ADMIN_ORDER_TEMPLATE){
  const request={uid:alice,...order.request};
  const caseId=service.caseRegistry.issue(request).caseId;
  for(const choice of order.approvals)
    service.caseRegistry.approve({caseId,role:choice.role,
      reviewer:choice.reviewer,request});
  return caseId;
}
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

  await test('resumed QA run refuses a changed request timestamp or source',async()=>{
    for(const change of [
      {source:'android',requestedAt:new Date('2026-10-31T13:00:00Z')},
      {source:'web',requestedAt:new Date('2026-10-31T12:00:00Z')}
    ]){
      await inDemo(async(db,aux)=>{
        const runner=new QaDeletionRunner({db,...aux});
        await assert.rejects(runner.run({
          approved:true,failBeforeEffect:'remove_relational'
        }),/injected_failure_before_effect:remove_relational/);
        assert.deepEqual(runner.completed(),QA_STEPS.slice(0,2));
        await setDoc(doc(db,'account_deletion_requests/'+alice),{
          status:'requested',...change
        });
        const restarted=new QaDeletionRunner({db,...aux,context:{}});
        await assert.rejects(restarted.run({approved:true}),
          /qa_request_binding_changed/);
        assert.deepEqual(restarted.completed(),QA_STEPS.slice(0,2));
        await allPresent(db,[...QA_FIXTURES.relational,
          ...QA_FIXTURES.roots,...QA_FIXTURES.preserved]);
        assert.equal(aux.auth.has(alice),true);
        assert.equal(aux.auth.has(bob),true);
        assert.equal(aux.media.has(QA_MEDIA_ID),true);
      });
    }
    console.log('PASS QA DELETION immutable request binding survives restart');
  });

  await test('QA request changed during a phase prevents a success checkpoint',async()=>{
    await inDemo(async(db,aux)=>{
      const runner=new QaDeletionRunner({db,...aux});
      const original=runner.stages.remove_relational;
      runner.stages.remove_relational={
        ...original,
        apply:async leaseCheck=>{
          await original.apply(leaseCheck);
          // Simulate an asynchronous external modification in the middle
          // of a QA fixture operation. Real effects cannot be rolled back.
          await setDoc(doc(db,'account_deletion_requests/'+alice),{
            status:'requested',source:'web',
            requestedAt:new Date('2026-10-31T12:00:00Z')
          });
        }
      };
      await assert.rejects(runner.run({approved:true}),
        /qa_request_binding_changed/);
      assert.deepEqual(runner.completed(),QA_STEPS.slice(0,2));
      assert.equal(aux.auth.has(alice),true);
      assert.equal(aux.auth.has(bob),true);
      await allPresent(db,[...QA_FIXTURES.roots,...QA_FIXTURES.preserved]);
    });
    console.log('PASS QA DELETION concurrent request edit cannot checkpoint');
  });

  await test('QA request binding rejects missing, malformed, or unbound resume',async()=>{
    for(const change of [
      {status:'requested',source:'web'},
      {status:'requested',source:'unrecognized',requestedAt:new Date('2026-10-31T12:00:00Z')}
    ]){
      await inDemo(async(db,aux)=>{
        await setDoc(doc(db,'account_deletion_requests/'+alice),change);
        await assert.rejects(new QaDeletionRunner({db,...aux}).run({approved:true}),
          /qa_request_binding_invalid_request/);
        assert.equal(aux.auth.has(alice),true);
        await allPresent(db,[...QA_FIXTURES.nested,...QA_FIXTURES.roots]);
      });
    }
    await inDemo(async(db,aux)=>{
      const restarted=new QaDeletionRunner({db,...aux});
      aux.journal.exec("INSERT INTO qa_deletion_checkpoints (step,finished) VALUES ('freeze_writes',1)");
      await assert.rejects(restarted.run({approved:true}),
        /qa_request_binding_missing_on_resume/);
      assert.equal(aux.auth.has(alice),true);
      await allPresent(db,QA_FIXTURES.nested);
    });
    console.log('PASS QA DELETION request shape and legacy journal guard');
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

  await test('UGC account consent and blocks are removed only from Alice',async()=>{
    await inDemo(async(db,aux)=>{
      await setDoc(doc(db,'users/'+bob+'/acceptedTerms/ugc-v1'),{
        version:'ugc-v1',origin:'QA Bob-only consent'
      });
      await setDoc(doc(db,'users/'+bob+'/blockedMembers/qa-unrelated-user'),{
        origin:'QA Bob-only unrelated block'
      });
      const runner=new QaDeletionRunner({db,...aux});
      const state=await runner.run({approved:true});
      assert.equal(state.productionReady,false);
      await allAbsent(db,['users/'+alice+'/acceptedTerms/ugc-v1',
        'users/'+alice+'/blockedMembers/'+bob]);
      await allPresent(db,['users/'+bob+'/acceptedTerms/ugc-v1',
        'users/'+bob+'/blockedMembers/qa-unrelated-user']);
      assert.equal(aux.auth.has(alice),false);
      assert.equal(aux.auth.has(bob),true);
    });
    console.log('PASS QA DELETION UGC private collections scoped to owner');
  });

  await test('UGC block under Bob targeting Alice prevents fake Auth deletion',async()=>{
    await inDemo(async(db,aux)=>{
      await assert.rejects(new QaDeletionRunner({db,...aux}).run({
        approved:true,failBeforeEffect:'remove_auth_stub_last'
      }),/injected_failure_before_effect:remove_auth_stub_last/);
      const otherBlock='users/'+bob+'/blockedMembers/'+alice;
      await setDoc(doc(db,otherBlock),{createdAt:new Date('2026-10-31T12:00:00Z')});
      await assert.rejects(new QaDeletionRunner({db,...aux,context:{}})
        .run({approved:true}),/qa_reconciliation_residual_firestore/);
      await allPresent(db,[otherBlock,...QA_FIXTURES.preserved]);
      assert.equal(aux.auth.has(alice),true);
      assert.equal(aux.auth.has(bob),true);
    });
    console.log('PASS QA DELETION UGC foreign block reference blocks Auth');
  });

  await test('UGC user reports by author and target block fake Auth until retention review',async()=>{
    for(const field of ['reporterUid','targetUid']){
      await inDemo(async(db,aux)=>{
        await assert.rejects(new QaDeletionRunner({db,...aux}).run({
          approved:true,failBeforeEffect:'remove_auth_stub_last'
        }),/injected_failure_before_effect:remove_auth_stub_last/);
        // Cross-account moderation evidence is NEVER blindly deleted by
        // the owned-subcollection purge; it needs retention adjudication.
        const row={reporterUid:bob,targetUid:bob,reason:'Simulado',
          createdAt:new Date('2026-10-31T12:00:00Z')};
        row[field]=alice;
        const reviewPath='user_reports/qa_retention_'+field;
        await setDoc(doc(db,reviewPath),row);
        await assert.rejects(new QaDeletionRunner({db,...aux,context:{}})
          .run({approved:true}),/qa_reconciliation_residual_firestore/);
        await allPresent(db,[reviewPath,...QA_FIXTURES.preserved]);
        assert.equal(aux.auth.has(alice),true,
          'User Auth fixture remains while cross-account reports need retention review');
        assert.equal(aux.auth.has(bob),true);
      });
    }
    console.log('PASS QA DELETION UGC moderation records retain fake Auth');
  });

  await test('moderation and reaction IDs retain personal references even when UID fields are absent',async()=>{
    await inDemo(async(db,aux)=>{
      await assert.rejects(new QaDeletionRunner({db,...aux}).run({
        approved:true,failBeforeEffect:'remove_auth_stub_last'
      }),/injected_failure_before_effect:remove_auth_stub_last/);
      const implicitIds=[
        'reports/'+alice+'_post_qa_test',
        'reports/'+alice+'_reply_qa_test',
        'user_reports/'+alice+'_user_'+bob,
        'user_reports/'+bob+'_user_'+alice,
        'posts/qa-delete-bob-post/replies/qa-bob-reply/reactions/'+alice
      ];
      // No indexed UID field is present in any of these records:
      // previous field-only queries would miss every reference.
      for(const path of implicitIds) {
        await setDoc(doc(db,path),{
          origin:'QA document-id-only sensitive identifier',
          createdAt:new Date('2026-10-31T12:00:00Z')
        });
      }
      await assert.rejects(new QaDeletionRunner({db,...aux,context:{}})
        .run({approved:true}),/qa_reconciliation_residual_firestore/);
      await allPresent(db,[...implicitIds,...QA_FIXTURES.preserved]);
      assert.equal(aux.auth.has(alice),true);
      assert.equal(aux.auth.has(bob),true);
    });
    console.log('PASS QA DELETION embedded UIDs in case and reaction document IDs');
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

  await test('ADMIN QA: purge newly discovered private IDs, preserve second user',async()=>{
    await inDemo(async(db,aux)=>{
      const extra='users/'+alice+'/savedPosts/surpriseSavedPost';
      const other='users/'+bob+'/notifications/surpriseBobNotice';
      const guardian='guardian_notices/'+alice+'/items/lateGuardian';
      await setDoc(doc(db,extra),{uid:alice,origin:'QA only'});
      await setDoc(doc(db,guardian),{uid:alice,origin:'QA only'});
      await setDoc(doc(db,other),{uid:bob,origin:'QA only'});
      const service=new QaAdministrativeDeletionExecutor({db,...aux,
        lease:new QaSqliteLease(aux.journal)});
      const caseId=approvedCase(service);
      const result=await service.execute({order:QA_ADMIN_ORDER_TEMPLATE,caseId});
      assert.equal(result.status,'qa_fixture_admin_workflow_finished');
      assert.equal(result.productionReady,false);
      assert.equal(result.firebaseAuthActuallyDeleted,false);
      assert.equal(result.cloudinaryActuallyDeleted,false);
      await allAbsent(db,[extra,guardian]);
      await allPresent(db,[other,...QA_FIXTURES.preserved]);
      assert.equal(aux.auth.has(alice),false);
      assert.equal(aux.auth.has(bob),true);
      assert.equal(aux.media.has(BOB_MEDIA),true);
    });
    console.log('PASS ADMIN QA dynamically purged owner-only docs');
  });

  await test('ADMIN QA: missing reviewer, forged role and missing request fail closed',
    async()=>{
      await inDemo(async(db,aux)=>{
        const service=new QaAdministrativeDeletionExecutor({db,...aux});
        for(const order of [
          undefined,
          {...QA_ADMIN_ORDER_TEMPLATE,approvals:QA_ADMIN_ORDER_TEMPLATE.approvals.slice(0,1)},
          {...QA_ADMIN_ORDER_TEMPLATE,approvals:[
            QA_ADMIN_ORDER_TEMPLATE.approvals[0],
            {role:'security',reviewer:'qa-privacy-reviewer',approved:true}
          ]},
          {...QA_ADMIN_ORDER_TEMPLATE,fixtureUid:bob},
          {...QA_ADMIN_ORDER_TEMPLATE,retentionDecision:'unreviewed'},
          {...QA_ADMIN_ORDER_TEMPLATE,request:{
            ...QA_ADMIN_ORDER_TEMPLATE.request,source:'web'
          }},
          {...QA_ADMIN_ORDER_TEMPLATE,approvals:[
            {...QA_ADMIN_ORDER_TEMPLATE.approvals[0],requestAt:'2026-10-31T13:00:00.000Z'},
            QA_ADMIN_ORDER_TEMPLATE.approvals[1]
          ]},
          {...QA_ADMIN_ORDER_TEMPLATE,approvals:[
            QA_ADMIN_ORDER_TEMPLATE.approvals[0],
            {...QA_ADMIN_ORDER_TEMPLATE.approvals[1],requestSource:'web'}
          ]}
        ]){
          await assert.rejects(service.execute({order}),/qa_admin_approval_required/);
        }
        assert.deepEqual(service.executor.completed(),[]);
        assert.equal(aux.auth.has(alice),true);
        await allPresent(db,QA_FIXTURES.nested);
      });
      await inDemo(async(db,aux)=>{
        const service=new QaAdministrativeDeletionExecutor({db,...aux});
        const caseId=approvedCase(service);
        await assert.rejects(service.execute({order:QA_ADMIN_ORDER_TEMPLATE,caseId}),
          /qa_admin_verified_request_missing/);
        assert.equal(aux.auth.has(alice),true);
        await allPresent(db,QA_FIXTURES.nested);
      },{request:false});
    console.log('PASS ADMIN QA reviews and identity request required');
  });

  await test('ADMIN QA: request changed after preflight is denied by executor',async()=>{
    await inDemo(async(db,aux)=>{
      const admin=new QaAdministrativeDeletionExecutor({db,...aux});
      const caseId=approvedCase(admin);
      const run=admin.executor.run.bind(admin.executor);
      admin.executor.run=async options=>{
        // Simulate an administrative read racing with a replacement request.
        await setDoc(doc(db,'account_deletion_requests/'+alice),{
          status:'requested',source:'web',
          requestedAt:new Date('2026-10-31T12:00:00Z')
        });
        return run(options);
      };
      await assert.rejects(admin.execute({order:QA_ADMIN_ORDER_TEMPLATE,caseId}),
        /qa_request_binding_approval_mismatch/);
      assert.deepEqual(admin.executor.completed(),[]);
      await allPresent(db,[...QA_FIXTURES.nested,...QA_FIXTURES.roots,
        ...QA_FIXTURES.preserved]);
      assert.equal(aux.auth.has(alice),true);
      assert.equal(aux.auth.has(bob),true);
    });
    console.log('PASS ADMIN QA preflight/executor request race denied');
  });

  await test('ADMIN QA: approvals cannot be replayed for another request',async()=>{
    for(const next of [
      {status:'requested',source:'web',
        requestedAt:new Date('2026-10-31T12:00:00Z')},
      {status:'requested',source:'android',
        requestedAt:new Date('2026-10-31T13:00:00Z')}
    ]){
      await inDemo(async(db,aux)=>{
        await setDoc(doc(db,'account_deletion_requests/'+alice),next);
        const admin=new QaAdministrativeDeletionExecutor({db,...aux});
        const caseId=approvedCase(admin);
        await assert.rejects(admin.execute({order:QA_ADMIN_ORDER_TEMPLATE,caseId}),
          /qa_admin_order_for_another_request/);
        assert.deepEqual(admin.executor.completed(),[]);
        await allPresent(db,[...QA_FIXTURES.nested,...QA_FIXTURES.roots,
          ...QA_FIXTURES.preserved]);
        assert.equal(aux.auth.has(alice),true);
        assert.equal(aux.auth.has(bob),true);
        assert.equal(aux.media.has(QA_MEDIA_ID),true);
      });
    }
    console.log('PASS ADMIN QA stale approvals cannot authorize fresh request');
  });

  await test('ADMIN QA: restart following dynamic nested cleanup is idempotent',
    async()=>{
      await inDemo(async(db,aux)=>{
        const extra='users/'+alice+'/likedPosts/unlistedLike';
        await setDoc(doc(db,extra),{uid:alice,origin:'QA only'});
        const lease=new QaSqliteLease(aux.journal);
        const first=new QaAdministrativeDeletionExecutor({db,...aux,lease});
        const caseId=approvedCase(first);
        await assert.rejects(first.execute({
          order:QA_ADMIN_ORDER_TEMPLATE,caseId,failAfterEffect:'remove_nested'
        }),/injected_failure_after_effect:remove_nested/);
        await allAbsent(db,[extra,...QA_FIXTURES.nested]);
        assert.equal(aux.auth.has(alice),true);
        const restarted=new QaAdministrativeDeletionExecutor({db,...aux,
          lease:new QaSqliteLease(aux.journal)});
        const result=await restarted.execute({order:QA_ADMIN_ORDER_TEMPLATE,caseId});
        assert.equal(result.completedPhases,QA_STEPS.length);
        assert.equal(aux.auth.has(alice),false);
        await allPresent(db,QA_FIXTURES.preserved);
      });
    console.log('PASS ADMIN QA interrupted owned cleanup recoverable');
  });

  await test('ADMIN QA: UUID case and two persisted reviews required',async()=>{
    await inDemo(async(db,aux)=>{
      const admin=new QaAdministrativeDeletionExecutor({db,...aux});
      const request={uid:alice,...QA_ADMIN_ORDER_TEMPLATE.request};
      await assert.rejects(admin.execute({order:QA_ADMIN_ORDER_TEMPLATE}),
        /qa_case_invalid_case_id/);
      const caseId=admin.caseRegistry.issue(request).caseId;
      await assert.rejects(admin.execute({order:QA_ADMIN_ORDER_TEMPLATE,caseId}),
        /qa_case_dual_review_required/);
      admin.caseRegistry.approve({caseId,role:'privacy',
        reviewer:'qa-privacy-reviewer',request});
      await assert.rejects(admin.execute({order:QA_ADMIN_ORDER_TEMPLATE,caseId}),
        /qa_case_dual_review_required/);
      assert.deepEqual(admin.executor.completed(),[]);
      assert.equal(aux.auth.has(alice),true);
      await allPresent(db,[...QA_FIXTURES.nested,...QA_FIXTURES.roots,
        ...QA_FIXTURES.preserved]);
    });
  });

  await test('ADMIN QA: revocation mid-stage blocks checkpoint and mock Auth',async()=>{
    await inDemo(async(db,aux)=>{
      const admin=new QaAdministrativeDeletionExecutor({db,...aux});
      const caseId=approvedCase(admin);
      const original=admin.executor.stages.remove_relational;
      admin.executor.stages.remove_relational={
        ...original,apply:async leaseCheck=>{
          await original.apply(leaseCheck);
          assert.equal(admin.caseRegistry.revoke(caseId),true);
        }
      };
      await assert.rejects(admin.execute({order:QA_ADMIN_ORDER_TEMPLATE,caseId}),
        /qa_case_case_revoked/);
      assert.deepEqual(admin.executor.completed(),QA_STEPS.slice(0,2));
      assert.equal(aux.auth.has(alice),true);
      assert.equal(aux.auth.has(bob),true);
      await allPresent(db,[...QA_FIXTURES.roots,...QA_FIXTURES.preserved]);
    });
  });

  await test('ADMIN QA: new UUID cannot resume checkpoints of revoked case',async()=>{
    await inDemo(async(db,aux)=>{
      const admin=new QaAdministrativeDeletionExecutor({db,...aux});
      const oldCase=approvedCase(admin);
      await assert.rejects(admin.execute({order:QA_ADMIN_ORDER_TEMPLATE,
        caseId:oldCase,failBeforeEffect:'remove_relational'}),
        /injected_failure_before_effect:remove_relational/);
      assert.deepEqual(admin.executor.completed(),QA_STEPS.slice(0,2));
      assert.equal(admin.caseRegistry.revoke(oldCase),true);
      const nextCase=approvedCase(admin);
      assert.notEqual(nextCase,oldCase);
      await assert.rejects(admin.execute({order:QA_ADMIN_ORDER_TEMPLATE,
        caseId:nextCase}),/qa_request_binding_case_changed/);
      assert.deepEqual(admin.executor.completed(),QA_STEPS.slice(0,2));
      assert.equal(aux.auth.has(alice),true);
      assert.equal(aux.auth.has(bob),true);
      await allPresent(db,[...QA_FIXTURES.roots,...QA_FIXTURES.preserved]);
    });
  });

  await test('ADMIN QA: production-like credentials deny execution',async()=>{
    await inDemo(async(db,aux)=>{
      const previous=process.env.CLOUDINARY_API_SECRET;
      try{
        process.env.CLOUDINARY_API_SECRET='never-use-secret-in-qa';
        assert.throws(()=>new QaAdministrativeDeletionExecutor({db,...aux}),
          /qa_admin_environment_denied/);
        assert.equal(aux.auth.has(alice),true);
        await allPresent(db,QA_FIXTURES.nested);
      }finally{
        if(previous===undefined)delete process.env.CLOUDINARY_API_SECRET;
        else process.env.CLOUDINARY_API_SECRET=previous;
      }
    });
    console.log('PASS ADMIN QA blocks external credentials');
  });

} finally{
  await env.cleanup();
}
