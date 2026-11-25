#!/usr/bin/env node
// Offline comparison only. Neither a deploy script nor a certification of Rules.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {renderConversationPushPilotRules} from '../firebase/qa-geral-celular/pilot/conversation-push-rules.mjs';

const PROJECT='atrio-catolico-qa-general';
const markers=['serverInboxControl','writeBoundary','qaInboxLegacySourceWrites',
  'serverInboxOwners','chatInboxByPeer','chatPushPending','chatPushAdmission'];
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const paths=s=>[...new Set([...s.matchAll(/^\s*match\s+(.+?)\s*\{\s*$/gm)]
  .map(m=>m[1].trim()))].sort();
const names=s=>[...new Set([...s.matchAll(/^\s*function\s+([A-Za-z_]\w*)\s*\(/gm)]
  .map(m=>m[1]))].sort();
const minus=(a,b)=>a.filter(x=>!b.includes(x));
function validate(s) {
  if(typeof s!=='string'||Buffer.byteLength(s,'utf8')>256000||
     !/^rules_version\s*=\s*['"]2['"];\s*service cloud\.firestore\s*\{/.test(s)||
     !s.includes('match /databases/{database}/documents'))
    throw Error('invalid_rules_source');
}

export function compareQaRules({projectId,release,rulesetName,source,sha256}) {
  if(projectId!==PROJECT||release!=='projects/'+PROJECT+'/releases/cloud.firestore'||
     typeof rulesetName!=='string'||!new RegExp('^projects/'+PROJECT+'/rulesets/[A-Za-z0-9_-]+$').test(rulesetName))
    throw Error('qa_rules_wrong_target');
  validate(source);
  if(hash(source)!==sha256)throw Error('qa_rules_snapshot_hash_mismatch');
  const candidate=renderConversationPushPilotRules();
  validate(candidate);
  const originalPaths=paths(source),candidatePaths=paths(candidate);
  const originalFunctions=names(source),candidateFunctions=names(candidate);
  return {
    projectId,release,rulesetName,
    publishedSha256:sha256,candidateSha256:hash(candidate),
    identical:source===candidate,
    publishedMarkers:Object.fromEntries(markers.map(k=>[k,source.includes(k)])),
    candidateMarkers:Object.fromEntries(markers.map(k=>[k,candidate.includes(k)])),
    removedMatches:minus(originalPaths,candidatePaths),
    addedMatches:minus(candidatePaths,originalPaths),
    removedFunctions:minus(originalFunctions,candidateFunctions),
    addedFunctions:minus(candidateFunctions,originalFunctions),
    // Structural names and hashes alone never establish equivalent authorization.
    deploymentAuthorized:false,
    status:'manual_semantic_review_required',
    remaining:['review_full_diff_and_overlapping_matches',
      'test_exact_candidate_with_qa_emulator',
      'inventory_privileged_writers_and_coordinate_cutover',
      'verify_iam_and_remote_ruleset_preconditions',
      'explicit_founder_authorization']
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==3)throw Error('usage: node scripts/qa-conversas-rules-preflight.mjs <qa-rules-snapshot.json>');
    const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
    console.log(JSON.stringify(compareQaRules(input),null,2));
  }catch(e){console.error('QA rules preflight denied:',e.message);process.exitCode=1;}
}
