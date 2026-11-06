import test from 'node:test';
import assert from 'node:assert/strict';
import {setupFounder} from './termux-founder-access-guard.mjs';

const project='projects/atrio-catolico/databases/(default)/documents';
const uid='dummyFounderUnitTestABC12345678';
const other='anotherExistingFounder987654321';
const token='test-oauth-token-not-real-abcdefghijklmnop';

function fixture({founder=null, admin=null, adminEnabled=false, mutateDuringReview=false, commitFails=false}={}) {
  let storedFounder=founder;
  let storedAdmin=admin;
  let enabled=adminEnabled;
  let postCount=0,reads=0,authCount=0;
  let capturedWrites=[];
  const firestoreDoc=(name,fields,updateTime='2026-11-06T20:00:00Z')=>({
    name:project+'/'+name,fields,updateTime
  });
  const fetcher=async(url,opts)=>{
    assert.equal(opts.headers.Authorization,'Bearer '+token);
    assert.equal(opts.redirect,'error');
    assert.equal(opts.cache,'no-store');
    assert.ok(url.startsWith('https://firestore.googleapis.com/v1/'+project));
    if(opts.method==='GET'){
      reads++;
      if(mutateDuringReview && reads===3)storedFounder=other;
      if(url.endsWith('/app_config/founder')){
        return storedFounder
          ?Response.json(firestoreDoc('app_config/founder',{uid:{stringValue:storedFounder}}))
          :new Response('',{status:404});
      }
      if(url.endsWith('/admins/'+uid)){
        return storedAdmin
          ?Response.json(firestoreDoc('admins/'+uid,{
            enabled:{booleanValue:enabled},
            otherField:{stringValue:'keep this information'}
          }))
          :new Response('',{status:404});
      }
      throw Error('Unexpected GET endpoint');
    }
    assert.equal(opts.method,'POST');
    assert.ok(url.endsWith('/documents:commit'));
    postCount++;
    if(commitFails)return new Response('',{status:403});
    const value=JSON.parse(opts.body);
    capturedWrites=value.writes;
    assert.ok(value.writes.length>=1);
    for(const write of value.writes){
      if(write.update.name===project+'/app_config/founder'){
        assert.equal(storedFounder,null);
        assert.deepEqual(write.currentDocument,{exists:false});
        storedFounder=write.update.fields.uid.stringValue;
      }else if(write.update.name===project+'/admins/'+uid){
        assert.equal(write.update.fields.enabled.booleanValue,true);
        if(storedAdmin){
          assert.deepEqual(write.updateMask,{fieldPaths:['enabled']});
          assert.deepEqual(write.currentDocument,{updateTime:'2026-11-06T20:00:00Z'});
        }else assert.deepEqual(write.currentDocument,{exists:false});
        storedAdmin=true;enabled=true;
      }else throw Error('Unexpected path in commit');
    }
    return Response.json({writeResults:value.writes.map(()=>({updateTime:'2026-11-06T20:05:00Z'}))});
  };
  return {
    options:{uid,tokenProvider:async()=>{authCount++;return token;},fetcher},
    stats:()=>({postCount,reads,authCount,storedFounder,storedAdmin,enabled,capturedWrites})
  };
}

test('consulta padrão nunca escreve e não exibe UID no relatório',async()=>{
  const f=fixture();
  const result=await setupFounder(f.options);
  assert.equal(result.mode,'READ_ONLY_PREFLIGHT');
  assert.equal(result.founderState,'absent');
  assert.equal(result.adminState,'absent');
  assert.equal(result.canApply,true);
  assert.equal(result.ready,false);
  assert.equal(result.changedByThisCommand,false);
  assert.equal(result.backupModified,false);
  assert.equal(f.stats().postCount,0);
  assert.equal(f.stats().reads,2);
  assert.equal(f.stats().authCount,1);
  assert.equal(JSON.stringify(result).includes(uid),false);
});

test('já é Fundador e admin: nenhuma escrita mesmo com apply',async()=>{
  const f=fixture({founder:uid,admin:true,adminEnabled:true});
  const result=await setupFounder({...f.options,apply:true});
  assert.equal(result.ready,true);
  assert.equal(result.alreadyConfigured,true);
  assert.equal(f.stats().postCount,0);
});

test('Fundador já atribuído a outra pessoa impede mudança de titular',async()=>{
  const f=fixture({founder:other});
  const result=await setupFounder({...f.options,apply:true});
  assert.equal(result.anotherFounderExists,true);
  assert.equal(result.canApply,false);
  assert.equal(f.stats().postCount,0);
  assert.equal(JSON.stringify(result).includes(other),false);
});

test('cria simultaneamente o Fundador e o admin quando ambos faltam',async()=>{
  const f=fixture();
  const result=await setupFounder({...f.options,apply:true});
  assert.equal(result.changedByThisCommand,true);
  assert.equal(result.ready,true);
  assert.equal(f.stats().postCount,1);
  assert.equal(f.stats().capturedWrites.length,2);
  assert.equal(f.stats().reads,6);
});

test('preserva outras informações no documento admin já existente',async()=>{
  const f=fixture({founder:uid,admin:true,adminEnabled:false});
  const result=await setupFounder({...f.options,apply:true});
  assert.equal(result.ready,true);
  assert.equal(f.stats().postCount,1);
  assert.equal(f.stats().capturedWrites.length,1);
  assert.deepEqual(f.stats().capturedWrites[0].updateMask,{fieldPaths:['enabled']});
});

test('conta admin habilitada, mas founder ausente: só cria founder',async()=>{
  const f=fixture({admin:true,adminEnabled:true});
  const result=await setupFounder({...f.options,apply:true});
  assert.equal(result.ready,true);
  assert.equal(f.stats().capturedWrites.length,1);
  assert.ok(f.stats().capturedWrites[0].update.name.endsWith('app_config/founder'));
});

test('qualquer alteração remota durante revisão interrompe a operação',async()=>{
  const f=fixture({mutateDuringReview:true});
  await assert.rejects(setupFounder({...f.options,apply:true}),
    /atrio_founder_setup_documents_changed_during_review/);
  assert.equal(f.stats().postCount,0);
});

test('UID inválido é recusado sem acesso ao Firebase',async()=>{
  const f=fixture();
  await assert.rejects(setupFounder({...f.options,uid:'nao/permitido',apply:true}),
    /atrio_founder_setup_invalid_uid/);
  assert.equal(f.stats().reads,0);
  assert.equal(f.stats().authCount,0);
});

test('401/403 do Firebase interrompe sem conceder privilégios',async()=>{
  const f=fixture({commitFails:true});
  await assert.rejects(setupFounder({...f.options,apply:true}),
    /atrio_founder_setup_permission_denied/);
  assert.equal(f.stats().postCount,1);
});

test('documentos incompletos ou corrompidos falham fechado',async()=>{
  const f=fixture();
  await assert.rejects(setupFounder({...f.options,fetcher:async()=>Response.json({
    name:project+'/app_config/founder',fields:{uid:{integerValue:'3'}}
  })}),/atrio_founder_setup_invalid_founder_document/);
});
