import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const src=readFileSync(new URL('./public-request-worker.js',import.meta.url),'utf8');
const listeners=[];
runInNewContext(src,{
 addEventListener:(name,fn)=>{assert.equal(name,'fetch');listeners.push(fn);},
 Request,Response,URL
});
assert.equal(listeners.length,1);
const fetcher=async(path,method='GET')=>{
 let response;
 listeners[0]({request:new Request('https://atrio-exclusao.atrio-catolico.workers.dev'+path,{method}),
   respondWith:r=>{response=r;}});
 return response;
};
test('supports public account deletion contact via HTTPS page',async()=>{
 const r=await fetcher('/exclusao');
 assert.equal(r.status,200);
 assert.match(r.headers.get('content-type'),/text\/html/);
 const html=await r.text();
 assert.match(html,/Átrio Católico/);
 assert.match(html,/exclusão da conta e dos dados associados/);
 assert.match(html,/mailto:atriocatolico\.privacidade@gmail\.com/);
 assert.match(html,/não realiza o apagamento automaticamente/);
 assert.doesNotMatch(html,/<script|<form|fetch\(/);
 assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
});
test('rejects mutation methods and unknown paths',async()=>{
 assert.equal((await fetcher('/exclusao','POST')).status,405);
 assert.equal((await fetcher('/admin')).status,404);
 assert.equal((await fetcher('/exclusao','HEAD')).status,200);
});
