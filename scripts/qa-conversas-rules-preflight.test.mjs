import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {compareQaRules} from './qa-conversas-rules-preflight.mjs';
import {renderConversationPushPilotRules} from '../firebase/qa-geral-celular/pilot/conversation-push-rules.mjs';
const projectId='atrio-catolico-qa-general';
const snapshot=source=>({projectId,release:'projects/'+projectId+'/releases/cloud.firestore',
  rulesetName:'projects/'+projectId+'/rulesets/test-only',
  source,sha256:createHash('sha256').update(source,'utf8').digest('hex')});

test('offline preflight compares exact sources and never authorizes deploy',()=>{
  const s=readFileSync(new URL('../firebase/qa-geral-celular/firestore.rules',import.meta.url),'utf8');
  const r=compareQaRules(snapshot(s));
  assert.equal(r.identical,false);
  assert.equal(r.candidateMarkers.writeBoundary,true);
  assert.equal(r.candidateMarkers.chatPushPending,true);
  assert.equal(r.deploymentAuthorized,false);
  assert.ok(r.addedMatches.length>0);
  const same=compareQaRules(snapshot(renderConversationPushPilotRules()));
  assert.equal(same.identical,true);
  assert.equal(same.deploymentAuthorized,false);
});
test('rejects production, mismatched release, tampering and invalid input',()=>{
  const s=snapshot(renderConversationPushPilotRules());
  assert.throws(()=>compareQaRules({...s,projectId:'atrio-catolico'}),/wrong_target/);
  assert.throws(()=>compareQaRules({...s,release:'projects/atrio-catolico/releases/cloud.firestore'}),/wrong_target/);
  assert.throws(()=>compareQaRules({...s,rulesetName:'projects/atrio-catolico/rulesets/test'}),/wrong_target/);
  assert.throws(()=>compareQaRules({...s,source:s.source+'\n// changed'}),/hash_mismatch/);
  assert.throws(()=>compareQaRules(snapshot('not rules')),/invalid_rules_source/);
});
