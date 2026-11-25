// Ensaio funcional restrito. Não publica regras nem configura credenciais.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {renderPushReceiverRules} from './push-receiver-rules.mjs';
const canonical='qa-nav-alice__qa-nav-bob';
const pinned='a41f9cd33fcfddfecb80ddcf8561fae6ce4d0df4';
function once(s,a,b){
  if(s.split(a).length!==2)throw Error('qa_simple_anchor_changed');
  return s.replace(a,()=>b);
}
function between(s,a,b){
  const i=s.indexOf(a),j=s.indexOf(b,i+1);
  if(i<0||j<0||s.indexOf(a,i+1)>=0||s.indexOf(b,j+1)>=0)throw Error('qa_simple_section_changed');
  return s.slice(i,j);
}
export function renderSimpleDirectRules(snapshot){
  let rules=renderPushReceiverRules(snapshot);
  let raw=readFileSync(new URL('../../atrio-conversas-v1.rules.fragment',import.meta.url),'utf8');
  const blob=createHash('sha1').update('blob '+Buffer.byteLength(raw)+'\0'+raw).digest('hex');
  if(blob!==pinned)throw Error('qa_simple_fragment_unreviewed');
  const head=between(raw,'    function chatEnabled() {','    match /app_config/conversations {');
  let functions=once(head,between(head,'    function chatEnabled() {','    function chatNoBlock(a, b) {'),
    '    function chatEnabled() { return qaPushReceiverEnabled()\n'+
    "      && get(/databases/$(database)/documents/app_config/conversations).data.get('qaSimpleDirectEnabled',false) == true; }\n");
  functions=once(functions,between(functions,'    function chatMember(data) {','    function chatMessagePath(chatId, messageId) {'),
    "    function chatMember(data) {\n"+
    "      return signedIn() && data.participants is list && data.participants.size() == 2\n"+
    "        && qaMemberUid(data.requesterUid) && qaMemberUid(data.recipientUid)\n"+
    "        && data.requesterUid != data.recipientUid\n"+
    "        && data.participants == [data.requesterUid, data.recipientUid]\n"+
    "        && request.auth.uid in data.participants;\n    }\n");
  const quotaAndSettings=between(raw,'    match /users/{uid}/chatLimits/requests {','    // #355: indice de inbox por titular E por contato.');
  let direct=between(raw,'    match /chats/{chatId} {','    match /chat_reports/{reportId} {');
  // Restrição de caminho no próprio allow, inclusive nas subcoleções.
  const restrict=(s)=>s.replace(/(allow [^:\n]+: if chatEnabled\(\))/g,"$1 && chatId == '"+canonical+"'");
  direct=restrict(direct);
  direct=once(direct,"      allow get: if chatEnabled() && chatId == '"+canonical+"' && chatMember(resource.data)\n        && chatNoBlock(resource.data.requesterUid, resource.data.recipientUid);",
    "      allow get: if chatEnabled() && chatId == '"+canonical+"'\n        && (resource == null || (chatMember(resource.data)\n          && chatNoBlock(resource.data.requesterUid, resource.data.recipientUid)));");
  direct=once(direct,'        && validId(request.resource.data.recipientUid)',
    '        && qaMemberUid(request.resource.data.recipientUid)');
  // Listar só mensagens da conversa fixa, nunca a coleção global chats.
  direct=once(direct,"        allow get, list: if chatEnabled() && chatId == '"+canonical+"'",
    "        allow get, list: if chatEnabled() && chatId == '"+canonical+"'");
  // Quota não contém chatId como variável de caminho; restringir separadamente.
  const hiddenStart='    match /users/{uid}/chatHidden/{chatId}/messages/{messageId} {';
  let settings=quotaAndSettings.slice(quotaAndSettings.indexOf(hiddenStart));
  if(!settings.startsWith(hiddenStart))throw Error('qa_simple_settings_changed');
  settings=restrict(settings);
  settings=once(settings,"      allow get, list: if chatEnabled() && chatId == '"+canonical+"' && me(uid);",
    "      allow get: if chatEnabled() && chatId == '"+canonical+"' && me(uid);\n      allow list: if false;");
  const quota=quotaAndSettings.slice(0,quotaAndSettings.indexOf(hiddenStart));
  // Mantém o contrato de denúncia já revisado, sem conceder nova leitura.
  let report=raw.slice(raw.indexOf('    match /chat_reports/{reportId} {'));
  report=once(report,"      allow get: if signedIn() && resource.data.reporterUid == request.auth.uid;\n      allow list: if false;\n",'');
  report=once(report,'      allow create: if chatEnabled()',
    "      allow create: if chatEnabled()\n        && request.resource.data.chatId == '"+canonical+"'");
  const adapters="    function signedIn() { return qaTester(); }\n"+
    "    function me(uid) { return qaOwner(uid); }\n"+
    "    function emailVerificationAllowsCommunityAccess() { return qaTester(); }\n";
  const blocks="    match /users/{uid}/blockedMembers/{peerUid} {\n"+
    "      allow create: if qaOwner(uid) && qaMemberUid(peerUid) && uid != peerUid\n"+
    "        && qaInboxLegacySourceWrites() && request.resource.data.keys().hasOnly(['createdAt'])\n"+
    "        && request.resource.data.createdAt == request.time;\n"+
    "      allow delete: if qaOwner(uid) && qaMemberUid(peerUid) && uid != peerUid\n"+
    "        && qaInboxLegacySourceWrites();\n    }\n";
  const readOnly=between(rules,'    match /chats/{chatId} {','    match /users/{uid}/chatPushAdmission/{item} {');
  return once(rules,readOnly,adapters+functions+quota+settings+direct+blocks+report);
}
