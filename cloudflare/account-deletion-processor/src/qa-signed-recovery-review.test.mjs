import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign,createHash} from 'node:crypto';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createQaPersistentDeletionLedger}
  from './qa-persistent-case-ledger.js';
import {createControlledQaDeletionExecutor,CONTROLLED_DELETION_PHASES}
  from './controlled-executor.js';
import {createQaSignedReviewAuthority,qaSignedReviewPayload,
  qaReviewCheckpointDigest}
  from './qa-signed-recovery-review.js';

const PROJECT='demo-atrio-v11';
const CASE='fa00bbaa-4a09-4fd2-b399-001122334455';
const CTX={uid:'qa-delete-candidate',caseId:CASE};
const CLOCK=1793738400000;
function fixture(){
  const folder=mkdtempSync(join(tmpdir(),'atrio-qa-delete-ledger-'));
  const path=join(folder,'ledger.sqlite');
  let db=new DatabaseSync(path);
  chmodSync(path,0o600);
  const keypair=generateKeyPairSync('ed25519');
  const reviewerPublicKey=keypair.publicKey.export({format:'pem',type:'spki'});
  const make=()=>{
    const ledger=createQaPersistentDeletionLedger({projectId:PROJECT,db});
    const authority=createQaSignedReviewAuthority({
      projectId:PROJECT,db,reviewerPublicKey,now:()=>CLOCK
    });
    return {ledger,authority};
  };
  let components=make();
  function token({purpose,phase,epoch,completed=[],...changes}){
    const document={
      purpose,phase,epoch,uid:CTX.uid,caseId:CTX.caseId,
      projectId:PROJECT,reviewer:'qa-independent-reviewer-01',
      nonce:randomUUID(),issuedMs:CLOCK-1000,expiresMs:CLOCK+30000,
      checkpointSha256:qaReviewCheckpointDigest(completed),
      ...changes
    };
    return {document,signature:sign(null,qaSignedReviewPayload(document),
      keypair.privateKey).toString('base64url')};
  }
  function reseal(document){
    return {document,signature:sign(null,qaSignedReviewPayload(document),
      keypair.privateKey).toString('base64url')};
  }
  return {
    get ledger(){return components.ledger;},
    get authority(){return components.authority;},
    get db(){return db;},
    token,reseal,
    async setupRetry({acquire=true}={}){
      await components.ledger.acquire(CTX);
      await components.ledger.complete({...CTX,epoch:1,phase:'freeze_writes'});
      const resume=token({purpose:'case_resume',phase:'case_resume',epoch:1,
        completed:['freeze_writes']});
      await components.ledger.approveRecovery(CTX,{
        independentReview:s=>components.authority.approveCaseResume(s,resume)
      });
      if(acquire){
        const {epoch}=await components.ledger.acquire(CTX);
        assert.equal(epoch,2);
      }
      const grant=token({purpose:'phase_retry',phase:'purge_firestore',epoch:2,
        completed:['freeze_writes']});
      return {grant,resume};
    },
    restart(){
      db.close();db=new DatabaseSync(path);chmodSync(path,0o600);
      components=make();
    },
    close(){db.close();rmSync(folder,{recursive:true,force:true});}
  };
}
const denied=async action=>assert.rejects(action,/qa_signed_reviewer_denied/);

test('Ed25519 reviewer consent for case resume is signed and bound to journal checkpoint',async()=>{
  const f=fixture();
  try{
    await f.ledger.acquire(CTX);
    await f.ledger.complete({...CTX,epoch:1,phase:'freeze_writes'});
    const grant=f.token({purpose:'case_resume',phase:'case_resume',epoch:1,
      completed:['freeze_writes']});
    const approved=await f.ledger.approveRecovery(CTX,{
      independentReview:async snapshot=>
        f.authority.approveCaseResume(snapshot,grant)
    });
    assert.equal(approved.productionApproved,false);
    assert.equal((await f.ledger.status(CTX)).state,'recovery_approved');
    assert.equal(f.authority.independentIamVerified,false);
    assert.equal((await f.ledger.acquire(CTX)).epoch,2);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qa_signed_reviewer_receipts')
      .get().n,1);
    const check=await f.ledger.status(CTX);
    assert.equal(check.epoch,2);
  }finally{f.close();}
});
test('signed phase retry is durable, single use and cannot be minted twice for same step',async()=>{
  const f=fixture();
  try{
    const {grant}=await f.setupRetry();
    const ctx={...CTX,epoch:2,phase:'purge_firestore'};
    assert.equal(await f.authority.authorizeRecoveryRetry(ctx,grant),true);
    f.restart();
    await denied(f.authority.authorizeRecoveryRetry(ctx,grant));
    const another=f.token({purpose:'phase_retry',phase:'purge_firestore',epoch:2,
      completed:['freeze_writes']});
    await denied(f.authority.authorizeRecoveryRetry(ctx,another));
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qa_signed_reviewer_receipts')
      .get().n,2);
  }finally{f.close();}
});
test('tampered signature, other key and forged reviewer scope cannot be consumed',async()=>{
  const f=fixture();
  try{
    const {grant}=await f.setupRetry();
    const ctx={...CTX,epoch:2,phase:'purge_firestore'};
    const altered={...grant,signature:
      (grant.signature[0]==='A'?'B':'A')+grant.signature.slice(1)};
    await denied(f.authority.authorizeRecoveryRetry(ctx,altered));
    const mismatches=[
      {uid:'qa-delete-alice'}, {caseId:'fa00bbaa-4a09-4fd2-b399-001122334466'},
      {epoch:3}, {phase:'revoke_fcm'},
      {reviewer:'qa-executor-self'}, {purpose:'case_resume'},
      {projectId:'atrio-catolico'}
    ];
    for(const change of mismatches){
      const document={...grant.document,...change};
      // Re-sign with the fixture private key: scope is still rejected.
      if(change.purpose==='case_resume')document.phase='case_resume';
      let proof;
      try{proof=f.reseal(document);}
      catch(e){
        assert.match(e.message,/qa_signed_reviewer_denied/);
        continue;
      }
      await denied(f.authority.authorizeRecoveryRetry(ctx,proof));
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qa_signed_reviewer_receipts')
      .get().n,1);
  }finally{f.close();}
});
test('stale or future reviewer signature and overlong validity are denied',async()=>{
  const f=fixture();
  try{
    const {grant}=await f.setupRetry();
    const ctx={...CTX,epoch:2,phase:'purge_firestore'};
    for(const data of [
      {issuedMs:CLOCK-200000,expiresMs:CLOCK-100000},
      {issuedMs:CLOCK+90000,expiresMs:CLOCK+100000},
      {issuedMs:CLOCK-1000,expiresMs:CLOCK+400000},
      {expiresMs:CLOCK-10}
    ]){
      let proof;
      try{
        proof=f.reseal({...grant.document,...data,nonce:randomUUID()});
      }catch(e){
        assert.match(e.message,/qa_signed_reviewer_denied/);
        continue;
      }
      await denied(f.authority.authorizeRecoveryRetry(ctx,proof));
    }
  }finally{f.close();}
});
test('wrong checkpoint and changed case phase after signing are denied',async()=>{
  const f=fixture();
  try{
    const {grant}=await f.setupRetry();
    const ctx={...CTX,epoch:2,phase:'purge_firestore'};
    const forged=f.token({purpose:'phase_retry',phase:'purge_firestore',
      epoch:2,completed:[]});
    await denied(f.authority.authorizeRecoveryRetry(ctx,forged));
    const changed={...grant.document,phase:'revoke_fcm'};
    await denied(f.authority.authorizeRecoveryRetry(ctx,{
      document:changed,signature:grant.signature
    }));
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qa_signed_reviewer_receipts')
      .get().n,1);
  }finally{f.close();}
});
test('two concurrent uses of a signed approval cannot both succeed',async()=>{
  const f=fixture();
  try{
    const {grant}=await f.setupRetry();
    const ctx={...CTX,epoch:2,phase:'purge_firestore'};
    const outcome=await Promise.allSettled([
      f.authority.authorizeRecoveryRetry(ctx,grant),
      f.authority.authorizeRecoveryRetry(ctx,grant)
    ]);
    assert.equal(outcome.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(outcome.filter(x=>x.status==='rejected').length,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qa_signed_reviewer_receipts')
      .get().n,2);
  }finally{f.close();}
});
test('only a private disposable SQLite ledger is eligible; no production identity',async()=>{
  const f=fixture();
  try{
    const publicKey=generateKeyPairSync('ed25519').publicKey
      .export({format:'pem',type:'spki'});
    assert.throws(()=>createQaSignedReviewAuthority({
      projectId:'atrio-catolico',db:f.db,
      reviewerPublicKey:publicKey
    }),/qa_signed_reviewer_denied/);
    assert.throws(()=>createQaSignedReviewAuthority({
      projectId:PROJECT,db:f.db,reviewerPublicKey:'not-a-public-key'
    }),/qa_signed_reviewer_denied/);
    f.db.exec('CREATE TABLE unsafe_extra(id TEXT)');
    assert.throws(()=>createQaSignedReviewAuthority({
      projectId:PROJECT,db:f.db,reviewerPublicKey:publicKey
    }),/unexpected_schema/);
  }finally{f.close();}
});
test('the signed checkpoint hash tracks immutable ordered steps',()=>{
  assert.equal(qaReviewCheckpointDigest(['freeze_writes']),
    createHash('sha256').update('["freeze_writes"]').digest('hex'));
  assert.throws(()=>qaReviewCheckpointDigest(['purge_firestore']),
    /qa_signed_reviewer_denied/);
});

test('signed single-use reviewer grants authorize exactly the four remaining QA provider mutations',async()=>{
  const f=fixture();
  try{
    // Only the executor acquires the reviewed epoch-2 lease.
    await f.setupRetry({acquire:false});
    const phases=['purge_firestore','purge_media_and_d1',
      'revoke_fcm','delete_auth_last'];
    // Reviewer signs exact future checkpoints OUTSIDE the injected executor.
    // The test-only private key is not handed to backend or to the adapter.
    const grants=new Map(phases.map(phase=>{
      const i=CONTROLLED_DELETION_PHASES.indexOf(phase);
      return [phase,f.token({purpose:'phase_retry',phase,epoch:2,
        completed:CONTROLLED_DELETION_PHASES.slice(0,i)})];
    }));
    const state={frozen:true,documents:2,media:1,tokens:1,auth:true,
      neighbor:{documents:3,media:2,tokens:2,auth:true}};
    const effects=[],authorized=[];
    const backend={
      approvals:{
        async confirm(x){
          assert.equal(x.uid,CTX.uid);assert.equal(x.caseId,CTX.caseId);
          return true;
        },
        async authorizeRecoveryRetry(x){
          authorized.push(x.phase);
          return f.authority.authorizeRecoveryRetry(x,grants.get(x.phase));
        }
      },
      ledger:{
        acquire:x=>f.ledger.acquire(x),
        check:x=>f.ledger.check(x),
        complete:x=>f.ledger.complete(x)
      },
      freeze:{
        async enable(){throw Error('already frozen: should not replay');},
        async verify(){return state.frozen;}
      },
      firestore:{
        async purge(){effects.push('purge_firestore');state.documents=0;},
        async assess(){return {allKnownScopesScanned:true,
          foreignReferencesResolved:true,retentionAdjudicated:true,
          remaining:state.documents,unknownScopes:0};}
      },
      media:{
        async purge(){effects.push('purge_media_and_d1');state.media=0;},
        async empty(){return state.media===0;}
      },
      fcm:{
        async revoke(){effects.push('revoke_fcm');state.tokens=0;},
        async empty(){return state.tokens===0;}
      },
      auth:{
        async remove(){effects.push('delete_auth_last');state.auth=false;},
        async exists(){return state.auth;}
      }
    };
    const executor=createControlledQaDeletionExecutor({
      projectId:PROJECT,backend
    });
    const result=await executor.run(CTX);
    assert.equal(result.completed,7);
    assert.equal(result.productionAuthorized,false);
    assert.deepEqual(effects,phases);
    assert.deepEqual(authorized,phases);
    assert.deepEqual(state.neighbor,{
      documents:3,media:2,tokens:2,auth:true
    });
    const count=f.db.prepare('SELECT COUNT(*) AS n FROM qa_signed_reviewer_receipts').get().n;
    assert.equal(count,5); // 1 case-resume + 4 phase-specific grants
    f.restart();
    assert.equal((await executor.run(CTX)).completed,7);
    assert.deepEqual(effects,phases);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qa_signed_reviewer_receipts')
      .get().n,5);
  }finally{f.close();}
});
