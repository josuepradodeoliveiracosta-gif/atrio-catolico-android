import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qaDispatchAllowed,dueForDailyDispatch,dispatchQaWorkflow,DISPATCH_UTC_HOUR} from './github-qa-dispatch.js';

const fakePat='github_pat_'+'A'.repeat(50);
const safe={
  GUARDIAN_V2_TEST_MODE:'true',
  GUARDIAN_V2_ENABLED:'false',
  GUARDIAN_V2_HOLD_ENABLED:'false',
  GUARDIAN_V2_QA_SHADOW_READS:'false',
  GUARDIAN_V2_QA_AUTO_DISPATCH:'true',
  GUARDIAN_QA_DISPATCH_READY:'true',
  GUARDIAN_QA_GITHUB_DISPATCH_TOKEN:fakePat
};
const at=time=>Date.parse('2026-10-30T'+time+'Z');

test('desativado por padrão não aceita nem token válido',()=>{
  assert.equal(qaDispatchAllowed({...safe,GUARDIAN_V2_QA_AUTO_DISPATCH:'false'}),false);
  assert.equal(qaDispatchAllowed({...safe,GUARDIAN_QA_DISPATCH_READY:'false'}),false);
  assert.equal(qaDispatchAllowed({...safe,GUARDIAN_QA_GITHUB_DISPATCH_TOKEN:undefined}),false);
});
test('rejeita todas as formas de ativação da moderação ou Firebase',()=>{
 for(const [k,v]of Object.entries({
  GUARDIAN_V2_TEST_MODE:'false',GUARDIAN_V2_ENABLED:'true',
  GUARDIAN_V2_HOLD_ENABLED:'true',GUARDIAN_V2_QA_SHADOW_READS:'true',
  GUARDIAN_FIREBASE_PROJECT_ID:'atrio-catolico-qa-v2',
  GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:'{}'
 }))assert.equal(qaDispatchAllowed({...safe,[k]:v}),false,k);
});
test('somente token GitHub fine-grained e com caracteres seguros',()=>{
 for(const token of ['','ghp_'+'x'.repeat(90),'github_pat_short',
  'github_pat_'+'x'.repeat(40)+'\n','xyz'+'a'.repeat(90)]) {
  assert.equal(qaDispatchAllowed({...safe,GUARDIAN_QA_GITHUB_DISPATCH_TOKEN:token}),false);
 }
 assert.equal(qaDispatchAllowed(safe),true);
});
test('limite estrito: só uma vez ao dia 03:00 UTC',()=>{
 assert.equal(DISPATCH_UTC_HOUR,3);
 for(const time of ['00:00:00','02:45:00','03:15:00','04:00:00','03:00:01'])
  assert.equal(dueForDailyDispatch(at(time)),false,time);
 assert.equal(dueForDailyDispatch(at('03:00:00')),true);
 assert.equal(dueForDailyDispatch(NaN),false);
 assert.equal(dueForDailyDispatch(undefined),false);
});
test('não faz chamada de rede sem as duas autorizações explícitas',async()=>{
 let calls=0;
 const fetcher=()=>{calls++;throw Error('never invoke')};
 assert.deepEqual(await dispatchQaWorkflow({...safe,GUARDIAN_QA_DISPATCH_READY:'false'},at('03:00:00'),fetcher),{status:'disabled'});
 assert.deepEqual(await dispatchQaWorkflow({...safe,GUARDIAN_V2_QA_AUTO_DISPATCH:'false'},at('03:00:00'),fetcher),{status:'disabled'});
 assert.equal(calls,0);
});
test('hora incorreta não faz POST e não usa o token',async()=>{
 let calls=0;
 assert.deepEqual(await dispatchQaWorkflow(safe,at('02:45:00'),()=>{calls++;}),{status:'not_due'});
 assert.equal(calls,0);
});
test('POST enviado apenas ao workflow QA da feature branch',async()=>{
 let calls=0;
 const r=await dispatchQaWorkflow(safe,at('03:00:00'),async(url,options)=>{
  calls++;
  assert.equal(url,'https://api.github.com/repos/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/workflows/guardiao-autonomo-qa.yml/dispatches');
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer '+fakePat);
  assert.deepEqual(JSON.parse(options.body),{ref:'feature/guardiao-autonomo-20261029'});
  assert.equal(options.headers['Content-Type'],'application/json');
  return new Response(null,{status:204});
 });
 assert.deepEqual(r,{status:'dispatched'});
 assert.equal(calls,1);
 assert.ok(!JSON.stringify(r).includes('github_pat_'));
});
test('erros de API, permissão e rate limit nunca são tratados como sucesso',async()=>{
 for(const code of [400,401,403,404,409,422,429,500]){
  const r=await dispatchQaWorkflow(safe,at('03:00:00'),
   async()=>new Response('private-response-with-token',{status:code}));
  assert.deepEqual(r,{status:'unavailable'},String(code));
 }
});
test('falha de rede não vaza tokens nem dados no retorno',async()=>{
 const r=await dispatchQaWorkflow(safe,at('03:00:00'),async()=>{throw Error(fakePat)});
 assert.deepEqual(r,{status:'unavailable'});
});
test('aceita resposta 200 do endpoint mais novo GitHub',async()=>{
 const r=await dispatchQaWorkflow(safe,at('03:00:00'),async()=>new Response('{}',{status:200}));
 assert.deepEqual(r,{status:'dispatched'});
});
