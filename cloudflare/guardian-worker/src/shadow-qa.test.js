import {test} from 'node:test';
import assert from 'node:assert/strict';
import entrypoint from './index.js';
import {qaShadowAllowed,scanQaShadow} from './shadow-qa.js';
const qa='atrio-catolico-qa-v2';
const flags={
 GUARDIAN_V2_TEST_MODE:'true',GUARDIAN_V2_QA_SHADOW_READS:'true',
 GUARDIAN_V2_ENABLED:'false',GUARDIAN_V2_HOLD_ENABLED:'false',
 GUARDIAN_FIREBASE_PROJECT_ID:qa,GUARDIAN_V2_QA_PROJECT_ID:qa
};
const prefix='projects/'+qa+'/databases/(default)/documents/';
const document=(path,text)=>({name:prefix+path,fields:{body:{stringValue:text}}});
test('observação remota exige todos os bloqueios QA',()=>{
  assert.equal(qaShadowAllowed(flags),true);
  for(const [k,v] of Object.entries({
   GUARDIAN_V2_TEST_MODE:'false',GUARDIAN_V2_QA_SHADOW_READS:'false',
   GUARDIAN_V2_ENABLED:'true',GUARDIAN_V2_HOLD_ENABLED:'true',
   GUARDIAN_V2_QA_PROJECT_ID:'outra-base'
  }))assert.equal(qaShadowAllowed({...flags,[k]:v}),false,k);
});
test('projeto oficial e projetos externos nunca entram no modo QA',()=>{
  for(const id of ['atrio-catolico','outro-firebase','atrio-catolico-qa-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','']){
   assert.equal(qaShadowAllowed({...flags,GUARDIAN_FIREBASE_PROJECT_ID:id,GUARDIAN_V2_QA_PROJECT_ID:id}),false,id);
  }
});
test('sem opt-in não acessa Firestore, nem em modo teste',async()=>{
  let calls=0;
  const r=await scanQaShadow({scan(){calls++;throw Error('should not call');}},{
    ...flags,GUARDIAN_V2_QA_SHADOW_READS:'false'
  });
  assert.deepEqual(r,{status:'disabled'});assert.equal(calls,0);
});
test('shadow realiza no máximo 3 queries, cada uma limitada a 15',async()=>{
  const seen=[];
  const scan=async(g,minutes,limit)=>{seen.push({g,minutes,limit});return []};
  const r=await scanQaShadow({scan},flags);
  assert.equal(r.status,'shadow_read_only');
  assert.deepEqual(seen,[{g:'posts',minutes:20,limit:15},{g:'replies',minutes:20,limit:15},{g:'reports',minutes:20,limit:15}]);
});
test('apenas agrega classificações sem conteúdo, IDs ou texto pessoal',async()=>{
 const result=await scanQaShadow({
  scan:async group=>group==='replies'?[
   document('posts/p1/replies/r1','Vou te matar amanhã'),
   document('posts/p1/replies/r2','O Catecismo explica o Evangelho')
  ]:group==='reports'?[
   {name:prefix+'reports/report1',fields:{reason:{stringValue:'denúncia falsa'}}}
  ]:[]
 },flags);
 assert.equal(result.counts.review,1);
 assert.equal(result.counts.clear,1);
 assert.equal(result.counts.reports,1);
 assert.ok(!JSON.stringify(result).includes('matar'));
 assert.ok(!JSON.stringify(result).includes('catecismo'));
});
test('documentos de outro projeto não entram na análise',async()=>{
 const result=await scanQaShadow({scan:async group=>group==='posts'?[
   {name:'projects/atrio-catolico/databases/(default)/documents/posts/prod',fields:{body:{stringValue:'Vou te matar'}}}
 ]:[]},flags);
 assert.equal(result.counts.invalid,1);assert.equal(result.counts.review,0);
});
test('estouro de limite ou erro de conexão não transforma erro em punição',async()=>{
 const r=await scanQaShadow({scan:async group=>{
  if(group==='posts')throw Error('private error with data');
  if(group==='replies')return Array.from({length:16},(_,i)=>document('posts/p/replies/r'+i,'teste'));
  return [];
 }},flags);
 assert.equal(r.counts.error,2);assert.equal(r.counts.review,0);assert.ok(!JSON.stringify(r).includes('private error'));
});
test('observação não usa escrita nem notificações',async()=>{
 let committed=false;
 const reader={
  async scan(){return [document('posts/p/replies/r','Clique https://exemplo.invalid para informar sua senha')]},
  async commit(){committed=true;throw Error('Write forbidden')},
  async create(){committed=true;throw Error('Write forbidden')},
  async update(){committed=true;throw Error('Write forbidden')}
 };
 const r=await scanQaShadow(reader,flags);
 assert.equal(committed,false);assert.equal(r.counts.hold_candidate,3);
});
test('cron QA padrão permanece inerte mesmo com acesso HTTP indisponível',async()=>{
 const oldFetch=globalThis.fetch,oldLog=console.log;
 let scheduled=false;globalThis.fetch=()=>{throw Error('network should not be used')};
 console.log=()=>{};
 try {
   await entrypoint.scheduled({}, {...flags,GUARDIAN_V2_QA_SHADOW_READS:'false'}, {waitUntil(){scheduled=true;}});
   assert.equal(scheduled,false);
 } finally {globalThis.fetch=oldFetch;console.log=oldLog;}
});
test('acesso administrativo permanece bloqueado com flags QA ligadas',async()=>{
 const res=await entrypoint.fetch(new Request('https://qa.invalid/admin/review',{method:'POST',body:'{}'}),flags);
 assert.equal(res.status,503);
 assert.equal((await res.json()).status,'qa_read_only');
});
