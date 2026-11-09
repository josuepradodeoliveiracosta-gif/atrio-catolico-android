import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/index.mjs';

const project='atrio-catolico-qa-geral';
const base=()=>({
  ATRIO_GENERAL_QA_MODE:'true',
  ATRIO_GENERAL_QA_PROJECT:project,
  ATRIO_QA_BOOTSTRAP_ONLY:'true',
  PUSH_ENABLED:'false',
  BROADCAST_ENABLED:'false',
  GUARDIAO_ENABLED:'false',
  QA_MANUAL_ENABLED:'false'
});
const d1=(projectId=project)=>({prepare(sql){
  assert.match(sql,/FROM atrio_qa_identity/);
  return {bind(name){
    assert.equal(name,'atrio-qa-geral');
    return {first:async()=>({project_id:projectId})};
  }};
}});
const request=(path='/health',method='GET')=>
  new Request('https://qa.example'+path,{method});

test('QA geral rejeita requisicoes sem ambiente e sem binding',async()=>{
  for(const env of [{},base()]){
    const r=await worker.fetch(request(),env);
    assert.equal(r.status,503);
  }
});
test('QA geral rejeita projeto de producao e ambiente de chat legado',async()=>{
  for(const projectId of ['atrio-catolico','qa-atrio-conversas-2026','atrio-catolico-qa-v2']){
    const r=await worker.fetch(request(),{...base(),ATRIO_GENERAL_QA_PROJECT:projectId,PUSH_DB:d1()});
    assert.equal(r.status,503);
  }
});
test('QA geral rejeita segredos, push e modulos administrativos ativos',async()=>{
  const dangerous=[
    {FIREBASE_SERVICE_ACCOUNT_JSON:'{}'},
    {FIREBASE_WEB_API_KEY:'synthetic'},
    {PUSH_ENABLED:'true'},
    {BROADCAST_ENABLED:'true'},
    {GUARDIAO_ENABLED:'true'},
    {QA_MANUAL_ENABLED:'true'},
    {ATRIO_QA_BOOTSTRAP_ONLY:'false'}
  ];
  for(const vars of dangerous){
    const r=await worker.fetch(request(),{...base(),...vars,PUSH_DB:d1()});
    assert.equal(r.status,503);
    assert.equal((await r.json()).state,'qa_configuration_denied');
  }
});
test('QA geral falha fechado com D1 ausente ou identidade errada',async()=>{
  for(const binding of [undefined,{},d1('atrio-catolico'),d1('qa-atrio-conversas-2026')]){
    const r=await worker.fetch(request(),{...base(),PUSH_DB:binding});
    assert.equal(r.status,503);
    assert.equal((await r.json()).state,'qa_d1_identity_denied');
  }
});
test('QA geral com D1 correto responde health desabilitado',async()=>{
  const r=await worker.fetch(request(),{...base(),PUSH_DB:d1()});
  assert.equal(r.status,200);
  assert.equal(r.headers.get('cache-control'),'no-store');
  const data=await r.json();
  assert.equal(data.state,'disabled');
  assert.equal(data.push_enabled,false);
  assert.equal(data.deploy_status,'bootstrap_only');
});
test('QA geral nao aceita eventos mesmo com D1 correto',async()=>{
  const r=await worker.fetch(request('/event','POST'),{...base(),PUSH_DB:d1()});
  assert.equal(r.status,503);
  assert.equal((await r.json()).state,'qa_events_disabled');
});
test('QA geral fecha todas as rotas adicionais',async()=>{
  for(const path of ['/moderation','/admin','/bots','/event']){
    const r=await worker.fetch(request(path),{...base(),PUSH_DB:d1()});
    assert.equal(r.status,404);
  }
});
