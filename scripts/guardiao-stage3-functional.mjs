// Etapa 3: testes funcionais isolados. Somente documentos, usuários e tokens sintéticos.
// Importa o motor real e a rota QA real; não cria usuários, nem acessa Firebase.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{processDocument,processReport,settingsOf,handleRequest} from '../cloudflare/guardian-worker/src/index.js';
import {classify} from '../cloudflare/guardian-worker/src/policy.js';
import {ROOT,str} from '../cloudflare/guardian-worker/src/firestore.js';
import {qaFixtureRequest} from '../cloudflare/guardian-worker/src/qa-user-firestore-bridge.js';
import {QA_D1_RESERVE_SQL,QA_DAILY_READ_LIMIT} from '../cloudflare/guardian-worker/src/qa-d1-budget.js';
import {runQaPolicyHeartbeat} from '../cloudflare/guardian-worker/src/qa-policy-heartbeat.js';

const qaFlags=Object.freeze({
 GUARDIAN_V2_TEST_MODE:'true',
 GUARDIAN_V2_ENABLED:'false',
 GUARDIAN_V2_HOLD_ENABLED:'false',
 GUARDIAN_V2_QA_SHADOW_READS:'false',
 GUARDIAN_V2_QA_AUTO_DISPATCH:'false',
 GUARDIAN_QA_DISPATCH_READY:'false',
 GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'false',
 GUARDIAN_V2_QA_READER_PROJECT:'atrio-catolico-qa-v2',
 GUARDIAN_V2_QA_POLICY_HEARTBEAT:'true',
 GUARDIAN_V2_QA_RUN_MONITOR:'false'
});
const signed=qaFlags;
const localSettings={enabled:true,allowHold:false};
const qaPost=(body,id='qa_post_1')=>({
 name:ROOT+'/posts/'+id,updateTime:'2026-10-30T12:00:01.000000Z',
 fields:{
  uid:str('qa_synthetic_user'),title:str('Discussão simulada'),
  body:str(body),createdAt:{timestampValue:'2026-10-30T12:00:00.000000Z'}
 }
});
class MemoryDb {
 constructor(docs=[]){
  this.docs=new Map(docs.map(d=>[d.name,structuredClone(d)]));
  this.commits=[];
  this.resource=ROOT;
 }
 async get(path){return this.docs.get(ROOT+'/'+path)||null;}
 async commit(writes){
  this.commits.push(writes);
  for(const w of writes){
   const name=w.update?.name||w.verify||w.delete;
   if(w.currentDocument?.exists===false&&this.docs.has(name))throw Object.assign(Error('duplicate'),{status:409});
   if(w.currentDocument?.updateTime&&this.docs.get(name)?.updateTime!==w.currentDocument.updateTime)
    throw Object.assign(Error('conflict'),{status:409});
  }
  for(const w of writes){
   if(w.update)this.docs.set(w.update.name,{
    name:w.update.name,updateTime:'2026-10-30T12:00:02.000000Z',fields:w.update.fields
   });
   if(w.delete)this.docs.delete(w.delete);
  }
 }
}

test('QA: cinco cenários católicos/fraude/ameaça/links e nenhuma ação',()=>{
 const outcome=runQaPolicyHeartbeat(qaFlags);
 assert.deepEqual(outcome,{status:'passed',checks:5});
 for(const text of ['Qual o sentido da Eucaristia?','No Evangelho, citando vou te matar amanhã, qual o contexto?']){
  assert.equal(classify(text).level,'clear');
 }
 assert.equal(classify('Clique https://example.invalid e informe sua senha').level,'hold_candidate');
 assert.equal(classify('Vou te matar amanhã').level,'review');
 assert.equal(classify('https://a.invalid https://b.invalid https://c.invalid https://d.invalid').level,'warning');
});

test('QA: ainda com env ENABLED true, leitura local nunca vira moderação',async()=>{
 const db=new MemoryDb([qaPost('Vou te matar amanhã')]);
 const cfg=settingsOf({fields:{enabled:{booleanValue:true},allowHold:{booleanValue:true}}},
  {...qaFlags,GUARDIAN_V2_ENABLED:'true',GUARDIAN_V2_HOLD_ENABLED:'true'});
 assert.deepEqual(cfg,{enabled:false,allowHold:false});
 assert.equal(await processDocument(db,qaPost('Vou te matar amanhã'),cfg),'disabled');
 assert.equal(db.commits.length,0);
});

test('simulação: alerta educativo grava caso, auditoria e aviso sem copiar texto sensível',async()=>{
 const post=qaPost('https://a.invalid https://b.invalid https://c.invalid https://d.invalid');
 const db=new MemoryDb([post]);
 assert.equal(await processDocument(db,post,localSettings),'warn');
 assert.equal(db.commits.length,1);
 const paths=db.commits[0].flatMap(w=>w.update?.name?[w.update.name]:[]);
 assert.equal(paths.length,3);
 assert.ok(paths.some(p=>p.includes('/guardian_cases/')));
 assert.ok(paths.some(p=>p.includes('/guardian_audit/')));
 assert.ok(paths.some(p=>p.includes('/guardian_notices/')));
 assert.equal(db.commits[0].filter(w=>Boolean(w.delete)).length,0);
 assert.ok(db.docs.has(post.name));
 assert.ok(!JSON.stringify(db.commits[0]).includes('https://a.invalid'));
});

test('simulação: ameaça vira revisão humana, nunca remoção automática',async()=>{
 const post=qaPost('Vou te matar amanhã','qa_threat');
 const db=new MemoryDb([post]);
 assert.equal(await processDocument(db,post,localSettings),'review');
 assert.equal(db.commits[0].length,4); // 3 registros e verificação de versão
 assert.ok(db.commits[0].some(w=>w.verify===post.name));
 assert.ok(db.docs.has(post.name));
 assert.ok([...db.docs.values()].some(d=>d.name.includes('/guardian_cases/')
  &&d.fields.status?.stringValue==='review'));
});

test('simulação: conteúdo legítimo não abre caso nem gera aviso',async()=>{
 const post=qaPost('Estudo sobre o Catecismo e a Santa Missa');
 const db=new MemoryDb([post]);
 assert.equal(await processDocument(db,post,localSettings),'clear');
 assert.equal(db.commits.length,0);
});

test('simulação: denúncia isolada não determina culpa nem escreve casos',async()=>{
 const target=qaPost('Conversa respeitosa sobre a liturgia','qa_reported');
 const report={
  name:ROOT+'/reports/qa_r1',updateTime:'2026-10-30T12:00:01.000000Z',
  fields:{postId:str('qa_reported'),source:str('user'),reason:str('Discordância respeitosa')}
 };
 const db=new MemoryDb([target,report]);
 assert.equal(await processReport(db,report,localSettings),'clear');
 assert.equal(db.commits.length,0);
});

test('simulação: falha no commit interrompe aviso sem retornar sucesso falso',async()=>{
 const post=qaPost('Vou te matar amanhã','qa_failure');
 const db=new MemoryDb([post]);
 db.commit=async()=>{throw Error('qa_write_unavailable');};
 await assert.rejects(processDocument(db,post,localSettings),/qa_write_unavailable/);
 assert.equal(db.docs.size,1);
});

test('Worker remoto configurado para QA: health, admin, revisão e ponte fechados',async()=>{
 for(const [path,method,expected,code] of [
  ['/health','GET',200,'guardian_v2_qa_safe'],
  ['/admin/config','POST',503,'qa_read_only'],
  ['/admin/review','POST',503,'qa_read_only'],
  ['/qa/firebase-fixture','POST',503,'qa_bridge_disabled'],
  ['/unrecognized','GET',404,'not_found']]){
  const res=await handleRequest(new Request('https://qa.invalid'+path,{method}),qaFlags);
  assert.equal(res.status,expected,path);
  assert.equal((await res.json()).status,code,path);
 }
});

test('QA cron executa heartbeat sem Firebase ou operação privilegiada',async()=>{
 const notes=[],work=[],old=console.log;
 console.log=(...args)=>notes.push(args);
 try{
  await worker.scheduled({scheduledTime:Date.parse('2026-10-30T12:15:00Z')},qaFlags,{
   waitUntil:p=>work.push(p)
  });
 }finally{console.log=old;}
 assert.equal(work.length,0);
 const heartbeat=notes.find(([k])=>k==='guardian_v2_qa_policy_heartbeat');
 assert.equal(JSON.parse(heartbeat[1]).checks,5);
 assert.equal(JSON.parse(heartbeat[1]).status,'passed');
});

test('ponte simulada: limite D1 de 12/dia aplica-se também a tentativas concorrentes',async()=>{
 const token='a'.repeat(24)+'.'+'b'.repeat(24)+'.'+'c'.repeat(48);
 let used=0,fetches=0;
 const stored={prepare:sql=>{
  assert.equal(sql,QA_D1_RESERVE_SQL);
  return {bind:(day,limit)=>{
   assert.equal(day,'2026-10-30');
   assert.equal(limit,QA_DAILY_READ_LIMIT);
   return {first:async()=>{
    if(used>=limit)return null;
    used++;return {used};
   }};
  }};
 }};
 const env={...qaFlags,GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'true',
  GUARDIAN_QA_GLOBAL_LIMITER:{limit:async()=>({success:true})},
  GUARDIAN_QA_TOKEN_LIMITER:{limit:async()=>({success:true})},
  GUARDIAN_QA_BUDGET_DB:stored};
 const responses=await Promise.all(Array.from({length:24},()=>qaFixtureRequest(
  new Request('https://qa.invalid/qa/firebase-fixture',{
   method:'POST',headers:{Authorization:'Bearer '+token}}),env,{
   clock:()=>Date.parse('2026-10-30T12:10:00Z'),
   fetcher:async()=>{
    fetches++;
    return new Response(JSON.stringify({
     name:'projects/atrio-catolico-qa-v2/databases/(default)/documents/posts/qa_post_1',
     fields:{qaFixture:{booleanValue:true},title:{stringValue:'Missa'},
      body:{stringValue:'Dúvida sobre a Missa'}}
    }),{status:200});
   }
  })));
 assert.equal(responses.filter(r=>r.status===200).length,12);
 assert.equal(responses.filter(r=>r.status===429).length,12);
 assert.equal(fetches,12);
 assert.equal(used,12);
 assert.ok(responses.every(r=>r.headers.get('cache-control')==='no-store'));
});

test('ponte simulada: falta D1 e bloqueio do limite impedem qualquer GET Firebase',async()=>{
 const jwt='a'.repeat(24)+'.'+'b'.repeat(24)+'.'+'c'.repeat(48);
 const request=()=>new Request('https://qa.invalid/qa/firebase-fixture',{
  method:'POST',headers:{Authorization:'Bearer '+jwt}});
 let fetches=0;
 const cfg={...qaFlags,GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'true',
  GUARDIAN_QA_GLOBAL_LIMITER:{limit:async()=>({success:true})},
  GUARDIAN_QA_TOKEN_LIMITER:{limit:async()=>({success:true})}};
 const bad=await qaFixtureRequest(request(),cfg,{
  fetcher:async()=>{fetches++;throw Error('should not fetch');}
 });
 assert.equal(bad.status,503);
 assert.equal((await bad.json()).status,'qa_daily_budget_unavailable');
 const limited=await qaFixtureRequest(request(),{...cfg,GUARDIAN_QA_GLOBAL_LIMITER:{
  limit:async()=>({success:false})}},{
  fetcher:async()=>{fetches++;throw Error('should not fetch');}
 });
 assert.equal(limited.status,429);
 assert.equal(fetches,0);
});
