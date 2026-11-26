import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../cloudflare/push-worker/'+p,import.meta.url),'utf8');
test('automatic laboratory remains outside the existing deployable QA relay and builder',()=>{
 for(const path of ['src/qa-geral.js','scripts/build-conversation-push-pilot.mjs','scripts/conversation-push-pilot.mjs']){
  const source=read(path);
  assert.doesNotMatch(source,/qa-automatic-free-|qa-automatic-d1-|qa-push-automatic-worker-lab|bindLabActor|dispatchInternal/);
  assert.doesNotMatch(source,/\b(?:async\s+)?scheduled\s*\(/);
 }
 const config=read('wrangler.qa-geral.example.toml');
 assert.doesNotMatch(config,/\[triggers\]|^\s*crons\s*=/m);
 assert.match(config,/^QA_PUSH_ENABLED = "false"$/m);
 assert.match(config,/^QA_CONVERSATION_PUSH_ENABLED = "false"$/m);
});
