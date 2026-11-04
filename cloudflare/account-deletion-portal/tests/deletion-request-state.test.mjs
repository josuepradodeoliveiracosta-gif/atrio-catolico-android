import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedPortalDeletionRequest,portalDeletionRequestState} from '../public/deletion-request-state.js';

const good={status:'requested',source:'web',requestedAt:{toMillis:()=>1790000000000}};
function document(fields=good, metadata={fromCache:false,hasPendingWrites:false}, exists=true){
  return {exists:()=>exists,data:()=>fields,metadata};
}

test('confirma somente pedido completo obtido do servidor',()=>{
  assert.equal(verifiedPortalDeletionRequest(document()),true);
  assert.equal(verifiedPortalDeletionRequest(document({...good,source:'android'})),true);
  assert.equal(verifiedPortalDeletionRequest(document(good,undefined,false)),false);
});

test('recusa cache, escrita pendente e metadados ausentes',()=>{
  for(const metadata of [
    {fromCache:true,hasPendingWrites:false},
    {fromCache:false,hasPendingWrites:true},
    {fromCache:false},
    {},
    null
  ]) assert.equal(verifiedPortalDeletionRequest(document(good,metadata)),false);
});

test('recusa pedidos incompletos, origem desconhecida e timestamp inválido',()=>{
  for(const data of [
    {...good,status:'done'}, {...good,source:'unknown'},
    {...good,requestedAt:null}, {...good,requestedAt:'yesterday'},
    {...good,requestedAt:{toMillis:()=>Infinity}},
    {...good,requestedAt:{toMillis:()=>{throw Error('invalid')}}},
    null
  ]) assert.equal(verifiedPortalDeletionRequest(document(data)),false);
  assert.equal(verifiedPortalDeletionRequest(null),false);
});

test('estados posteriores informam andamento sem comprovar exclusão',()=>{
  assert.equal(portalDeletionRequestState(document()),'requested');
  assert.equal(portalDeletionRequestState(document({...good,status:'processing'})),
    'processing');
  assert.equal(portalDeletionRequestState(document({...good,status:'completed'})),
    'completion_reported');
  assert.equal(portalDeletionRequestState(document({...good,status:'rejected'})),
    'review_required');
  for(const status of ['processing','completed','rejected']){
    assert.equal(verifiedPortalDeletionRequest(document({...good,status})),false);
  }
});
test('estado só é reconhecido com leitura remota íntegra',()=>{
  assert.equal(portalDeletionRequestState(document(good,{fromCache:true,hasPendingWrites:false})),
    'indeterminate');
  assert.equal(portalDeletionRequestState(document({...good,source:'other',status:'completed'})),
    'indeterminate');
  assert.equal(portalDeletionRequestState(document({...good,requestedAt:null,status:'completed'})),
    'indeterminate');
  assert.equal(portalDeletionRequestState(document(good,undefined,false)),
    'not_requested');
});
