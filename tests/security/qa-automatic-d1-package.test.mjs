import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {buildLocalAutomaticCandidate} from '../../cloudflare/push-worker/scripts/build-automatic-candidate-local.mjs';
test('generated package contains no deploy config or activation; real relay is closed',async t=>{
 const folder=buildLocalAutomaticCandidate();t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const read=name=>readFileSync(resolve(folder,name),'utf8');
 assert.deepEqual(readdirSync(folder).sort(),['entry.mjs','manifest.json','schema-candidate.sql','worker.mjs']);
 const manifest=JSON.parse(read('manifest.json'));
 assert.equal(manifest.deployable,false);assert.equal(manifest.defaultMode,'off');
 for(const [name,hash] of Object.entries(manifest.generatedFiles))
  assert.equal(createHash('sha256').update(read(name)).digest('hex'),hash);
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec('CREATE TABLE delivered(event_key TEXT PRIMARY KEY,created_at INTEGER NOT NULL);');
 sql.exec("INSERT INTO delivered VALUES('existing-marker',1)");
 sql.exec(read('schema-candidate.sql'));sql.exec(read('schema-candidate.sql'));
 assert.equal(sql.prepare('SELECT count(*) AS n FROM qa_auto_d1_activation_lab').get().n,0);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM qa_auto_d1_trial_lab').get().n,0);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM delivered').get().n,1);
 const {default:worker}=await import(pathToFileURL(resolve(folder,'entry.mjs')).href);
 assert.deepEqual(Object.keys(worker),['fetch']);
 const network=t.mock.method(globalThis,'fetch',()=>assert.fail('unexpected network'));
 const env={QA_PUSH_ENABLED:'true',QA_CONVERSATION_PUSH_ENABLED:'true'};
 assert.equal((await worker.fetch(new Request('https://qa.invalid/notice'),env)).status,503);
 assert.equal((await worker.fetch(new Request('https://qa.invalid/event',{method:'POST',body:JSON.stringify({type:'chat_message'})}),env)).status,503);
 assert.equal((await worker.fetch(new Request('https://qa.invalid/notice'),{...env,QA_AUTO_MODE:'manual'})).status,503);
 assert.equal((await worker.fetch(new Request('https://qa.invalid/tick'),env)).status,404);
 assert.equal(network.mock.callCount(),0);
});

test('optional scheduled package has no config, activation, or public tick',async t=>{
 const folder=buildLocalAutomaticCandidate({scheduledCandidate:true});t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const manifest=JSON.parse(readFileSync(resolve(folder,'manifest.json'),'utf8'));
 assert.equal(manifest.deployable,false);assert.equal(manifest.scheduledCandidate,true);
 assert.deepEqual(readdirSync(folder).sort(),['entry.mjs','manifest.json','schema-candidate.sql','worker.mjs']);
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(readFileSync(resolve(folder,'schema-candidate.sql'),'utf8'));
 for(const table of ['qa_auto_d1_activation_lab','qa_auto_d1_trial_lab','qa_auto_d1_schedule_lab'])
  assert.equal(sql.prepare('SELECT count(*) AS n FROM '+table).get().n,0);
 const {default:w}=await import(pathToFileURL(resolve(folder,'entry.mjs')).href);
 assert.deepEqual(Object.keys(w).sort(),['fetch','scheduled']);
 const net=t.mock.method(globalThis,'fetch',()=>assert.fail('unexpected network'));
 assert.equal((await w.scheduled({cron:'* * * * *',scheduledTime:Date.now()},{})).reason,'schedule_disabled');
 assert.equal((await w.fetch(new Request('https://qa.invalid/tick'),{})).status,404);
 assert.equal(net.mock.callCount(),0);
});
