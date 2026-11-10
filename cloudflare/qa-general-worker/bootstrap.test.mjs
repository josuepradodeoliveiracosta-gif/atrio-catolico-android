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

test('QA geral rejeita metodos nao autorizados sem consultar D1',async()=>{
  let reads=0;
  const db={prepare(){reads++;throw Error('D1 nao deve ser consultado');}};
  for(const [path,method] of [
    ['/health','POST'],['/health','PUT'],['/health','DELETE'],
    ['/event','GET'],['/event','PUT'],['/event','DELETE'],
    ['/admin','POST'],['/moderation','POST'],['/bots','POST']
  ]){
    const r=await worker.fetch(request(path,method),{...base(),PUSH_DB:db});
    assert.equal(r.status,404);
    assert.equal((await r.json()).state,'qa_route_denied');
    assert.equal(r.headers.get('cache-control'),'no-store');
  }
  assert.equal(reads,0);
});

test('QA geral nao aceita configuracao parcial ou flags nao textuais',async()=>{
  const variants=[
    {ATRIO_GENERAL_QA_MODE:false},
    {ATRIO_GENERAL_QA_MODE:'false'},
    {ATRIO_GENERAL_QA_PROJECT:'atrio-catolico'},
    {PUSH_ENABLED:false},
    {PUSH_ENABLED:true},
    {BROADCAST_ENABLED:false},
    {GUARDIAO_ENABLED:false},
    {QA_MANUAL_ENABLED:false},
    {ATRIO_QA_BOOTSTRAP_ONLY:false}
  ];
  for(const delta of variants){
    const r=await worker.fetch(request(),{...base(),...delta,PUSH_DB:d1()});
    assert.equal(r.status,503);
    assert.equal((await r.json()).state,'qa_configuration_denied');
  }
  const missing={...base(),PUSH_DB:d1()};
  delete missing.PUSH_ENABLED;
  const denied=await worker.fetch(request(),missing);
  assert.equal(denied.status,503);
  assert.equal((await denied.json()).state,'qa_configuration_denied');
});

test('QA geral falha fechado se D1 nao responder, sem expor diagnostico',async()=>{
  const broken=[
    {prepare(){throw Error('segredo-d1-qa-sintetico');}},
    {prepare(){return {bind(){throw Error('segredo-d1-qa-sintetico');}};}},
    {prepare(){return {bind(){return {first:async()=>{throw Error('segredo-d1-qa-sintetico');}};}};}},
    {prepare(){return {bind(){return {first:async()=>null};}};}}
  ];
  for(const PUSH_DB of broken){
    for(const req of [request('/health'),request('/event','POST')]){
      const r=await worker.fetch(req,{...base(),PUSH_DB});
      assert.equal(r.status,503);
      const raw=await r.text();
      assert.equal(raw.includes('segredo-d1-qa-sintetico'),false);
      assert.equal(JSON.parse(raw).state,'qa_d1_identity_denied');
      assert.equal(r.headers.get('cache-control'),'no-store');
    }
  }
});

test('QA geral continua sem FCM mesmo em evento com dados sinteticos',async()=>{
  let queries=0;
  const PUSH_DB={prepare(sql){
    queries++;
    assert.match(sql,/SELECT project_id FROM atrio_qa_identity/);
    return {bind(name){
      assert.equal(name,'atrio-qa-geral');
      return {first:async()=>({project_id:project})};
    }};
  }};
  const req=new Request('https://qa.example/event',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({type:'chat_message',text:'Nao enviar',uid:'qa-sintetico'})
  });
  const res=await worker.fetch(req,{...base(),PUSH_DB});
  assert.equal(res.status,503);
  const out=await res.json();
  assert.equal(out.state,'qa_events_disabled');
  assert.equal(out.push_enabled,false);
  assert.equal(out.deploy_status,'bootstrap_only');
  assert.equal(JSON.stringify(out).includes('Nao enviar'),false);
  assert.equal(queries,1); // apenas leitura do marcador de identidade QA
});
