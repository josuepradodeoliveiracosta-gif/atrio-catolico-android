import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createControlledQaDeletionExecutor,CONTROLLED_DELETION_PHASES
} from './controlled-executor.js';

const A='qa-delete-alice',B='qa-delete-bob';
const CASE='123e4567-e89b-42d3-a456-426614174001';
function fixture(){
  const log=[],confirmed=new Map([[A,true],[B,true]]);
  const frozen=new Set(),auth=new Set([A,B]);
  const docs=new Map([[A,new Set(['profiles/a','users/b/notifications/from-a'])],
    [B,new Set(['profiles/b'])]]);
  const media=new Map([[A,new Set(['cloudinary:private-a','d1:pending-a'])],
    [B,new Set(['cloudinary:private-b'])]]);
  const fcm=new Map([[A,new Set(['device-a'])],[B,new Set(['device-b'])]]);
  const ledger=new Map();
  let unknown=0,resolved=true,hold=true,activeEpoch=1;
  let failAfterMedia=false,failAfterAuth=false;
  const assertUid=x=>{
    assert.ok(x && [A,B].includes(x.uid));
    assert.equal(x.caseId,CASE);
  };
  const backend={
    approvals:{
      async confirm(x){assertUid(x);return confirmed.get(x.uid)===true;}
    },
    ledger:{
      async acquire(x){
        assertUid(x);
        if(!ledger.has(x.uid))
          ledger.set(x.uid,{epoch:activeEpoch,completed:[]});
        const v=ledger.get(x.uid);
        return {epoch:v.epoch,completed:[...v.completed]};
      },
      async check(x){
        assertUid(x);
        return ledger.get(x.uid)?.epoch===x.epoch && x.epoch===activeEpoch;
      },
      async complete(x){
        assertUid(x);
        const v=ledger.get(x.uid);
        if(v.epoch!==x.epoch ||
           x.phase!==CONTROLLED_DELETION_PHASES[v.completed.length])
          return false;
        v.completed.push(x.phase);
        log.push('checkpoint:'+x.phase);
        return true;
      }
    },
    freeze:{
      async enable(x){assertUid(x);log.push('freeze:'+x.uid);frozen.add(x.uid);},
      async verify(x){assertUid(x);return frozen.has(x.uid);},
      async drained(x){assertUid(x);return true;}
    },
    firestore:{
      async purge(x){assertUid(x);log.push('firestore:'+x.uid);docs.get(x.uid).clear();},
      async assess(x){
        assertUid(x);
        return {allKnownScopesScanned:unknown===0,
          foreignReferencesResolved:resolved,retentionAdjudicated:hold,
          remaining:docs.get(x.uid).size,unknownScopes:unknown};
      }
    },
    media:{
      async purge(x){
        assertUid(x);log.push('media:'+x.uid);media.get(x.uid).clear();
        if(failAfterMedia){failAfterMedia=false;throw Error('injected_cloudinary_timeout');}
      },
      async empty(x){assertUid(x);return media.get(x.uid).size===0;}
    },
    fcm:{
      async revoke(x){assertUid(x);log.push('fcm:'+x.uid);fcm.get(x.uid).clear();},
      async empty(x){assertUid(x);return fcm.get(x.uid).size===0;}
    },
    auth:{
      async remove(x){
        assertUid(x);log.push('auth:'+x.uid);auth.delete(x.uid);
        if(failAfterAuth){failAfterAuth=false;throw Error('injected_auth_timeout');}
      },
      async exists(x){assertUid(x);return auth.has(x.uid);}
    }
  };
  const executor=createControlledQaDeletionExecutor({
    projectId:'demo-atrio-v11',backend
  });
  return {backend,executor,log,confirmed,frozen,docs,media,fcm,auth,ledger,
    setUnknown:x=>{unknown=x;},
    setResolved:x=>{resolved=x;},
    setHold:x=>{hold=x;},
    setEpoch:x=>{activeEpoch=x;},
    failMedia:()=>{failAfterMedia=true;},
    failAuth:()=>{failAfterAuth=true;}
  };
}
const request=(uid=A)=>({uid,caseId:CASE});

test('homologação isolada: remove a conta fictícia, preserva a outra e apaga Auth por último',async()=>{
  const q=fixture();
  const result=await q.executor.run(request());
  assert.equal(result.state,'isolated_qa_deletion_reconciled');
  assert.equal(result.productionAuthorized,false);
  assert.equal(result.externalProvidersHomologated,false);
  assert.equal(result.googlePlayAuthorized,false);
  assert.deepEqual(q.ledger.get(A).completed,CONTROLLED_DELETION_PHASES);
  assert.equal(q.auth.has(A),false);
  assert.equal(q.auth.has(B),true);
  assert.equal(q.docs.get(B).size,1);
  assert.equal(q.media.get(B).size,1);
  assert.equal(q.fcm.get(B).size,1);
  assert.ok(q.frozen.has(A));
  assert.ok(!q.frozen.has(B));
  const authIndex=q.log.indexOf('auth:'+A);
  for(const effect of ['freeze:'+A,'firestore:'+A,'media:'+A,'fcm:'+A])
    assert.ok(q.log.indexOf(effect)>=0 && q.log.indexOf(effect)<authIndex);
  assert.ok(authIndex>=0);
});
test('reexecução idempotente valida checkpoints sem apagar duas vezes',async()=>{
  const q=fixture();
  await q.executor.run(request());
  const authCount=q.log.filter(s=>s==='auth:'+A).length;
  const checkpoints=q.log.filter(s=>s.startsWith('checkpoint:')).length;
  await q.executor.run(request());
  assert.equal(q.log.filter(s=>s==='auth:'+A).length,authCount);
  assert.equal(q.log.filter(s=>s.startsWith('checkpoint:')).length,checkpoints);
});
test('falha após exclusão de Cloudinary/D1 exige retomada e mantém Auth',async()=>{
  const q=fixture();q.failMedia();
  await assert.rejects(q.executor.run(request()),/injected_cloudinary_timeout/);
  assert.equal(q.auth.has(A),true);
  assert.deepEqual(q.ledger.get(A).completed,CONTROLLED_DELETION_PHASES.slice(0,2));
  await q.executor.run(request());
  assert.equal(q.auth.has(A),false);
  assert.equal(q.media.get(A).size,0);
});
test('timeout de Auth depois do efeito é recuperável, sem repetição destrutiva',async()=>{
  const q=fixture();q.failAuth();
  await assert.rejects(q.executor.run(request()),/injected_auth_timeout/);
  assert.equal(q.auth.has(A),false);
  assert.deepEqual(q.ledger.get(A).completed,CONTROLLED_DELETION_PHASES.slice(0,5));
  await q.executor.run(request());
  assert.equal(q.log.filter(s=>s==='auth:'+A).length,1);
  assert.equal(q.ledger.get(A).completed.length,7);
});
test('aprovação revogada antes da fase seguinte bloqueia o processamento',async()=>{
  const q=fixture();
  const original=q.backend.firestore.purge;
  q.backend.firestore.purge=async x=>{await original(x);q.confirmed.set(A,false);};
  await assert.rejects(q.executor.run(request()),/approval_revoked/);
  assert.equal(q.auth.has(A),true);
  assert.deepEqual(q.ledger.get(A).completed,['freeze_writes']);
});
test('perda de fence/lease após side effect não permite avançar',async()=>{
  const q=fixture();
  const original=q.backend.media.purge;
  q.backend.media.purge=async x=>{await original(x);q.setEpoch(2);};
  await assert.rejects(q.executor.run(request()),/stale_lease/);
  assert.equal(q.auth.has(A),true);
  assert.deepEqual(q.ledger.get(A).completed,CONTROLLED_DELETION_PHASES.slice(0,2));
});
test('ausência de congelamento distribuído bloqueia toda exclusão',async()=>{
  const q=fixture();
  q.backend.freeze.verify=async()=>false;
  await assert.rejects(q.executor.run(request()),/phase_not_reconciled/);
  assert.equal(q.auth.has(A),true);
  assert.equal(q.docs.get(A).size,2);
  assert.equal(q.ledger.get(A).completed.length,0);
});
test('referência estrangeira residual, escopo desconhecido ou retenção não analisada bloqueiam Auth',async()=>{
  for(const kind of ['residual','unknown','foreign','retention']){
    const q=fixture();
    if(kind==='residual')q.docs.get(A).add('users/b/notifications/unknown-a');
    if(kind==='unknown')q.setUnknown(1);
    if(kind==='foreign')q.setResolved(false);
    if(kind==='retention')q.setHold(false);
    if(kind==='residual'){
      q.backend.firestore.purge=async()=>{}; // simula erro sem apagar tudo
    }
    await assert.rejects(q.executor.run(request()),/phase_not_reconciled/);
    assert.equal(q.auth.has(A),true,kind);
  }
});
test('checkpoint inválido ou fora de ordem não autoriza avanço',async()=>{
  for(const completed of [['delete_auth_last'],['freeze_writes','freeze_writes'],
     ['freeze_writes','purge_media_and_d1']]){
    const q=fixture();
    q.backend.ledger.acquire=async()=>({epoch:1,completed});
    await assert.rejects(q.executor.run(request()),/non_prefix_or_duplicate_checkpoint/);
    assert.equal(q.log.length,0);
  }
});
test('não aceita projeto de produção, UID real, caso falso ou interfaces ausentes',async()=>{
  const q=fixture();
  assert.throws(()=>createControlledQaDeletionExecutor({
    projectId:'atrio-catolico',backend:q.backend
  }),/not_disposable_project/);
  assert.throws(()=>createControlledQaDeletionExecutor({
    projectId:'demo-atrio-v11',backend:{}
  }),/missing_backend/);
  for(const r of [
    {uid:'usuario-real',caseId:CASE},{uid:'../qa-delete-alice',caseId:CASE},
    {uid:A,caseId:'not-a-uuid'}
  ]){
    await assert.rejects(q.executor.run(r),/invalid_qa_case/);
  }
  assert.equal(q.log.length,0);
});
test('não executa exclusão sem aprovação vinculada à conta fictícia',async()=>{
  const q=fixture();q.confirmed.set(A,false);
  await assert.rejects(q.executor.run(request()),/approval_missing/);
  assert.equal(q.log.length,0);
  assert.equal(q.auth.has(A),true);
});

test('a completed QA case cannot report success after reviewer revocation during final readback',async()=>{
  const q=fixture();
  await q.executor.run(request());
  const original=q.backend.auth.exists;
  const previousEffects=q.log.length;
  let readbacks=0;
  q.backend.auth.exists=async x=>{
    const present=await original(x);
    if(++readbacks===2)q.confirmed.set(A,false);
    return present;
  };
  await assert.rejects(q.executor.run(request()),/approval_revoked/);
  assert.equal(q.log.length,previousEffects);
  assert.equal(q.auth.has(B),true);
});

test('a frozen marker without a drained privileged write ledger blocks deletion',async()=>{
  const q=fixture();
  q.backend.freeze.drained=async()=>false;
  await assert.rejects(q.executor.run(request()),/phase_not_reconciled/);
  assert.equal(q.frozen.has(A),true);
  assert.equal(q.docs.get(A).size,2);
  assert.equal(q.media.get(A).size,2);
  assert.equal(q.auth.has(A),true);
  assert.deepEqual(q.ledger.get(A).completed,[]);
});
test('missing independent drain adapter is denied before acquiring a case',()=>{
  const q=fixture();
  delete q.backend.freeze.drained;
  assert.throws(()=>createControlledQaDeletionExecutor({
    projectId:'demo-atrio-v11',backend:q.backend
  }),/missing_backend_freeze_drained/);
  assert.equal(q.log.length,0);
});
