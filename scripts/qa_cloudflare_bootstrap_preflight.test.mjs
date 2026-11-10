import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectQaBootstrap} from './qa_cloudflare_bootstrap_preflight.mjs';
const wrangler=readFileSync(new URL('../cloudflare/qa-general-worker/wrangler.toml',import.meta.url),'utf8');
const current=JSON.parse(readFileSync(new URL('../docs/qa-homologacao/CLOUDFLARE-QA-CAPTURA-20261110.json',import.meta.url),'utf8'));
const testOne=(w=wrangler,c=current)=>inspectQaBootstrap(w,c);
const blocked=r=>{
 assert.equal(r.status,'NO_GO');
 assert.equal(r.qaDeploymentAuthorized,false);
 assert.equal(r.eventProcessingAuthorized,false);
 assert.equal(r.snapshotIsLiveNow,false);
 assert.equal(r.workerCodeVerifiedRemotely,false);
 assert.equal(r.d1RowsAudited,false);
};
test('estado versionado deve combinar com leitura sanitizada histórica',()=>{
 const r=testOne();blocked(r);assert.equal(r.sourceMatchesSnapshot,true);
});
test('Worker oficial nunca é aceito como QA',()=>{
 const r=testOne(wrangler.replace('name = "atrio-qa-geral"','name = "atrio-push"'));
 blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
});
test('binding de produção no D1 falha fechado',()=>{
 const r=testOne(wrangler.replace('database_name = "atrio-qa-geral-db"','database_name = "atrio-push-delivery"'));
 blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
});
test('trocar ID do banco QA falha sem consultar nenhuma tabela',()=>{
 const r=testOne(wrangler.replace(current.d1DatabaseId,'00000000-0000-0000-0000-000000000001'));
 blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
});
test('mudar projeto Firebase para produção falha fechado',()=>{
 const r=testOne(wrangler.replace('ATRIO_GENERAL_QA_PROJECT = "atrio-catolico-qa-geral"','ATRIO_GENERAL_QA_PROJECT = "atrio-catolico"'));
 blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
});
test('Worker não pode habilitar workers.dev',()=>{
 const r=testOne(wrangler.replace('workers_dev = false','workers_dev = true'));
 blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
});
test('Worker não pode habilitar URL de preview',()=>{
 const r=testOne(wrangler.replace('preview_urls = false','preview_urls = true'));
 blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
});
test('push, broadcast e Guardião não podem ser habilitados',()=>{
 for(const v of ['PUSH_ENABLED','BROADCAST_ENABLED','GUARDIAO_ENABLED','QA_MANUAL_ENABLED']){
  const r=testOne(wrangler.replace(v+' = "false"',v+' = "true"'));
  blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
 }
});
test('bootstrap não pode ser desligado por configuração',()=>{
 const r=testOne(wrangler.replace('ATRIO_QA_BOOTSTRAP_ONLY = "true"','ATRIO_QA_BOOTSTRAP_ONLY = "false"'));
 blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
});
test('seção desconhecida ou binding adicional não passa',()=>{
 for(const append of ['\n[[d1_databases]]\nbinding="PROD"\n',
  '\n[triggers]\ncrons = []\n',
  '\n[vars]\nFIREBASE_SERVICE_ACCOUNT_JSON = "secret"\n']){
  const r=testOne(wrangler+append);
  blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
 }
});
test('TOML sem valores ou com duplicações falha fechado',()=>{
 for(const txt of [null,'',wrangler+'\nworkers_dev = true\n',
   wrangler.replace('workers_dev = false','workers_dev = "false"')]){
  const r=testOne(txt);blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
 }
});
test('captura histórica forjada com segredo ou valor inesperado é rejeitada',()=>{
 const c={...current,serviceAccountToken:'ABC-SECRET'};
 const r=testOne(wrangler,c);blocked(r);
 assert.equal(r.sourceMatchesSnapshot,false);
 assert.equal(JSON.stringify(r).includes('ABC-SECRET'),false);
});
test('evidência com URL ativa ou preview ativo bloqueia revisão',()=>{
 for(const key of ['workersDevEnabled','previewUrlsEnabled']){
   const r=testOne(wrangler,{...current,[key]:true});
   blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
 }
});
test('captura sem identidade D1 não comprova isolamento',()=>{
 const r=testOne(wrangler,{...current,d1DatabaseName:null});
 blocked(r);assert.equal(r.sourceMatchesSnapshot,false);
});
test('captura não substitui autenticação remota atual',()=>{
 const x=testOne();
 blocked(x);
 assert.equal(x.sourceMatchesSnapshot,true);
 assert.equal(x.snapshotIsLiveNow,false);
});
