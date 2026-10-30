import {test} from 'node:test';
import assert from 'node:assert/strict';
import entrypoint from './index.js';
import {qaMonitorAllowed,readQaWorkflowStatus} from './github-qa-monitor.js';
const safe={
 GUARDIAN_V2_TEST_MODE:'true',GUARDIAN_V2_ENABLED:'false',
 GUARDIAN_V2_HOLD_ENABLED:'false',GUARDIAN_V2_QA_SHADOW_READS:'false',
 GUARDIAN_V2_QA_RUN_MONITOR:'true'
};
const recent=new Date('2026-10-29T23:00:00Z').valueOf();
const run={id:40966233058,event:'workflow_dispatch',head_branch:'feature/guardiao-autonomo-20261029',status:'completed',conclusion:'success',updated_at:'2026-10-29T22:29:33Z'};
const feed={workflow_runs:[run]};
const jobs={jobs:[{name:'remote-qa-readonly',status:'completed',conclusion:'success'}]};
const mock=(one=feed,two=jobs)=>{
  const requests=[];
  const fetcher=async(url,options)=>{
    requests.push({url,options});
    return new Response(JSON.stringify(requests.length===1?one:two),{status:200});
  };
  return {requests,fetcher};
};
test('monitor só liga com modo seguro e ausência de credenciais Firebase',()=>{
 assert.equal(qaMonitorAllowed(safe),true);
 for(const [key,value] of Object.entries({
  GUARDIAN_V2_TEST_MODE:'false',GUARDIAN_V2_ENABLED:'true',
  GUARDIAN_V2_HOLD_ENABLED:'true',GUARDIAN_V2_QA_SHADOW_READS:'true',
  GUARDIAN_V2_QA_RUN_MONITOR:'false',
  GUARDIAN_FIREBASE_PROJECT_ID:'atrio-catolico-qa-v2',
  GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:'{}'
 }))assert.equal(qaMonitorAllowed({...safe,[key]:value}),false,key);
});
test('monitor desativado nunca envia chamada de rede',async()=>{
 let calls=0;
 const r=await readQaWorkflowStatus({...safe,GUARDIAN_V2_QA_RUN_MONITOR:'false'},()=>{calls++;throw Error('should not call')},recent);
 assert.deepEqual(r,{status:'disabled'});assert.equal(calls,0);
});
test('monitor leitura apenas GET à API pública de resultados do GitHub',async()=>{
 const {requests,fetcher}=mock();
 const result=await readQaWorkflowStatus(safe,fetcher,recent);
 assert.deepEqual(result,{status:'observed',remote:'success',run:'success',ageHours:0});
 assert.equal(requests.length,2);
 for(const {url,options} of requests) {
  assert.equal(options.method,'GET');
  assert.ok(url.startsWith('https://api.github.com/repos/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/'));
  assert.equal(options.headers.Authorization,undefined);
  assert.ok(!url.includes('firebase'));
 }
 assert.ok(requests[0].url.includes('event=workflow_dispatch'));
 assert.ok(requests[1].url.endsWith('/actions/runs/40966233058/jobs?per_page=100'));
});
test('monitor recusa tratar job skipped como sucesso',async()=>{
 const {fetcher}=mock(feed,{jobs:[{name:'remote-qa-readonly',status:'completed',conclusion:'skipped'}]});
 const a=await readQaWorkflowStatus(safe,fetcher,recent);
 assert.equal(a.remote,'skipped');
});
test('monitor recusa tratar falha do job remoto como aprovação',async()=>{
 const {fetcher}=mock(feed,{jobs:[{name:'remote-qa-readonly',status:'completed',conclusion:'failure'}]});
 const a=await readQaWorkflowStatus(safe,fetcher,recent);
 assert.equal(a.remote,'failure');
});
test('monitor não confunde execução em progresso com aprovação',async()=>{
 const {requests,fetcher}=mock({workflow_runs:[{...run,status:'in_progress',conclusion:null}]});
 const a=await readQaWorkflowStatus(safe,fetcher,recent);
 assert.equal(a.remote,'in_progress');assert.equal(requests.length,1);
});
test('monitor ignora execução de outra branch e eventos não manuais',async()=>{
 const {fetcher}=mock({workflow_runs:[{...run,head_branch:'main'},{...run,event:'push'}]});
 assert.deepEqual(await readQaWorkflowStatus(safe,fetcher,recent),{status:'missing'});
});
test('monitor classifica resultado antigo como stale sem requerer detalhes',async()=>{
 const {requests,fetcher}=mock();
 const a=await readQaWorkflowStatus(safe,fetcher,recent+3*86400000);
 assert.deepEqual(a,{status:'stale'});assert.equal(requests.length,1);
});
test('monitor falha fechado se GitHub estiver indisponível sem expor dados',async()=>{
 let n=0;
 const a=await readQaWorkflowStatus(safe,async()=>{n++;return new Response('private data',{status:403})},recent);
 assert.deepEqual(a,{status:'unavailable'});assert.equal(n,1);
});
test('monitor não inventa aprovação de job ausente',async()=>{
 const {fetcher}=mock(feed,{jobs:[{name:'Compilar Debug',status:'completed',conclusion:'success'}]});
 const a=await readQaWorkflowStatus(safe,fetcher,recent);
 assert.equal(a.remote,'missing');
});
test('cron QA de 15 min agenda monitor apenas na virada UTC da hora',async()=>{
 const originalFetch=globalThis.fetch,originalLog=console.log;
 let called=0, scheduled=0;const logs=[];
 // O agendamento simulado usa data fixa, mas o monitor valida a idade da
 // execução contra Date.now() real. Usar uma resposta atual APENAS neste
 // teste evita que a fixture expire após 24h e falsifique falha do cron.
 // Os testes explícitos de resultado antigo continuam cobrindo "stale".
 const recentCronFeed={workflow_runs:[{...run,updated_at:new Date().toISOString()}]};
 globalThis.fetch=async(url)=>{
  called++;
  return new Response(JSON.stringify(called===1?recentCronFeed:jobs),{status:200});
 };
 console.log=(...a)=>logs.push(a.join(' '));
 try{
  await entrypoint.scheduled({scheduledTime:Date.parse('2026-10-29T22:45:00Z')},safe,{waitUntil(){scheduled++;}});
  assert.equal(called,0);assert.equal(scheduled,0);
  const pending=[];
  await entrypoint.scheduled({scheduledTime:Date.parse('2026-10-29T23:00:00Z')},safe,{waitUntil(p){pending.push(p)}});
  await Promise.all(pending);
  assert.equal(pending.length,1);assert.equal(called,2);
  assert.ok(logs.some(x=>x.includes('guardian_v2_qa_monitor')));
  assert.ok(logs.every(x=>!x.includes('qa-post-')&&!x.includes('secret')));
 }finally{globalThis.fetch=originalFetch;console.log=originalLog;}
});
