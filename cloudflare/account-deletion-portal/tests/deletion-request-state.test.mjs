import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedPortalDeletionRequest} from '../public/deletion-request-state.js';

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
