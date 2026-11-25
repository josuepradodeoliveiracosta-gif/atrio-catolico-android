// Offline only; no network, credentials, deploy or active firebase.json.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const PROJECT='atrio-catolico-qa-general';
export const BASE_SHA256='2618b59e66914d78c3fc61e5b8812642429696f0064a85afac1c6ff44fef9f2f';
export const RULESET='projects/atrio-catolico-qa-general/rulesets/8eaa0b3f-5839-46cb-a380-d8a372bf2023';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const patches=[
  [
    "    match /users/{uid}/chatSettings/privacy {\n      allow get: if qaOwner(uid);\n    }",
    "    match /users/{uid}/chatSettings/privacy {\n      allow get: if qaOwner(uid);\n      allow list, delete: if false;\n      allow create, update: if qaOwner(uid)\n        && exists(/databases/$(database)/documents/app_config/conversations)\n        && get(/databases/$(database)/documents/app_config/conversations).data.get('enabled', false) == true\n        && get(/databases/$(database)/documents/app_config/conversations).data.get('minorPolicyApproved', false) == true\n        && get(/databases/$(database)/documents/app_config/conversations).data.get('safetyReviewVersion', '') == '2026-11-safety-v1'\n        && get(/databases/$(database)/documents/app_config/conversations).data.get('version', '') == '2026-11-v1'\n        && request.resource.data.keys().hasOnly([\n          'requests','readReceipts','showPushPreview','updatedAt'\n        ])\n        && request.resource.data.keys().hasAll([\n          'requests','readReceipts','showPushPreview','updatedAt'\n        ])\n        && request.resource.data.requests in ['all','none']\n        && request.resource.data.readReceipts is bool\n        && request.resource.data.showPushPreview is bool\n        && request.resource.data.updatedAt == request.time;\n    }"
  ],
  [
    "        'chatBox', 'likedPosts', 'savedPosts', 'blockedMembers'",
    "        'likedPosts', 'savedPosts', 'blockedMembers'"
  ],
  [
    "    match /chats/{chatId} {\n      allow get, list: if qaTester() && request.auth.uid in resource.data.participants;\n    }",
    "    function pilotEvidenceReadable() {\n      return qaModerator() || (qaTester() && resource.data.reporterUid == request.auth.uid);\n    }\n\n    match /chat_reports/{reportId} {\n      allow get: if pilotEvidenceReadable();\n      allow list: if qaModerator();\n    }\n\n    match /chat_group_reports/{reportId} {\n      allow get: if pilotEvidenceReadable();\n      allow list: if qaModerator();\n    }"
  ]
];
const tail='    match /{document=**} {\n      allow read, write: if false;\n    }\n  }\n}\n';
const addition="    // Candidato OFFLINE: leitura da mensagem canonica pelo receptor Push.\n    // Nenhum novo escritor de cliente, nenhum grupo e nenhuma listagem global.\n    function qaPushReceiverAge18(uid) {\n      let proof = get(/databases/$(database)/documents/users/$(uid)/chatAgeEligibility/current).data;\n      return qaMemberUid(uid)\n        && proof.keys().hasAll(['status','minimumAge','policyVersion','reviewExpiresAt'])\n        && proof.keys().hasOnly(['status','minimumAge','policyVersion','reviewExpiresAt'])\n        && proof.status == 'eligible' && proof.minimumAge is int\n        && proof.minimumAge == 18 && proof.policyVersion == '2026-11-18plus-qa-v1'\n        && proof.reviewExpiresAt is timestamp && proof.reviewExpiresAt > request.time;\n    }\n    function qaPushReceiverEnabled() {\n      let cfg = get(/databases/$(database)/documents/app_config/conversations).data;\n      let pilot = cfg.get('pushPilot',{});\n      return qaTester() && cfg.get('enabled',false) == true\n        && cfg.get('minorPolicyApproved',false) == true\n        && cfg.get('version','') == '2026-11-v1'\n        && cfg.get('safetyReviewVersion','') == '2026-11-safety-v1'\n        && pilot.get('enabled',false) == true\n        && pilot.get('projectId','') == 'atrio-catolico-qa-general'\n        && pilot.get('databaseId','') == '(default)'\n        && pilot.get('roundId','') == 'qa-199-push-isolado'\n        && pilot.get('ageMode','') == 'eligible'\n        && pilot.keys().hasAll(['expiresAt'])\n        && (pilot.expiresAt == null ||\n          (pilot.expiresAt is timestamp && pilot.expiresAt > request.time))\n        && qaPushReceiverAge18('qa-nav-alice') && qaPushReceiverAge18('qa-nav-bob')\n        && !exists(/databases/$(database)/documents/users/qa-nav-alice/blockedMembers/qa-nav-bob)\n        && !exists(/databases/$(database)/documents/users/qa-nav-bob/blockedMembers/qa-nav-alice);\n    }\n    function qaPushReceiverPair(chatId, room) {\n      return chatId == 'qa-nav-alice__qa-nav-bob'\n        && room.status == 'accepted'\n        && room.participants is list && room.participants.size() == 2\n        && room.requesterUid != room.recipientUid\n        && qaMemberUid(room.requesterUid) && qaMemberUid(room.recipientUid)\n        && room.participants == [room.requesterUid, room.recipientUid]\n        && request.auth.uid in room.participants;\n    }\n    match /chats/{chatId} {\n      allow get: if qaPushReceiverEnabled() && qaPushReceiverPair(chatId,resource.data);\n      allow list, create, update, delete: if false;\n      match /messages/{messageId} {\n        allow get: if qaPushReceiverEnabled()\n          && qaPushReceiverPair(chatId,\n            get(/databases/$(database)/documents/chats/$(chatId)).data)\n          && qaMemberUid(resource.data.uid);\n        allow list, create, update, delete: if false;\n      }\n    }\n    match /users/{uid}/chatPushAdmission/{item} {\n      allow read, write: if false;\n    }\n    match /users/{uid}/chatPushPending/{item} {\n      allow read, write: if false;\n    }\n";
function replaceOnce(s,a,b){
  if(s.split(a).length!==2)throw Error('qa_push_rules_anchor_changed');
  return s.replace(a,()=>b);
}
export function reconstructedBaseline(){
  let source=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
  for(const [a,b] of patches)source=replaceOnce(source,a,b);
  if(sha(source)!==BASE_SHA256)throw Error('qa_push_baseline_unreviewed');
  return source;
}
export function renderPushReceiverRules(snapshot){
  if(snapshot?.projectId!==PROJECT||snapshot.release!=='projects/'+PROJECT+'/releases/cloud.firestore'||
    snapshot.rulesetName!==RULESET||snapshot.sha256!==BASE_SHA256||
    typeof snapshot.source!=='string'||sha(snapshot.source)!==BASE_SHA256||
    snapshot.source!==reconstructedBaseline())throw Error('qa_push_snapshot_unreviewed');
  if(!snapshot.source.endsWith(tail))throw Error('qa_push_rules_tail_changed');
  return replaceOnce(snapshot.source,tail,addition+'\n'+tail);
}
export function reviewedSnapshot(){
  return {projectId:PROJECT,release:'projects/'+PROJECT+'/releases/cloud.firestore',
    rulesetName:RULESET,source:reconstructedBaseline(),sha256:BASE_SHA256};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3)throw Error('usage: node push-receiver-rules.mjs snapshot.json');
  const rules=renderPushReceiverRules(JSON.parse(readFileSync(process.argv[2],'utf8')));
  console.log(JSON.stringify({baselineSha256:BASE_SHA256,candidateSha256:sha(rules),
    candidateBytes:Buffer.byteLength(rules),mode:'receiver_read_only_offline',
    deploymentAuthorized:false},null,2));
}
