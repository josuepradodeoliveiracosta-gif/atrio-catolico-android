#!/usr/bin/env node
// Composicao LOCAL de regras de QA geral. Nao le firestore.rules oficial.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=[
 "rules_version = '2';",
 'service cloud.firestore {',
 '  match /databases/{database}/documents {',
 '    function signedIn() { return request.auth != null; }',
 '    function me(uid) { return signedIn() && request.auth.uid == uid; }',
 '    function isAdmin() {',
 '      return signedIn()',
 '        && exists(/databases/$(database)/documents/admins/$(request.auth.uid))',
 "        && get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.get('enabled', false) == true;",
 '    }',
 '    function validText(value, minimum, maximum) {',
 '      return value is string && value.size() >= minimum && value.size() <= maximum;',
 '    }',
 '    function validId(value) {',
 "      return validText(value, 1, 128) && !value.matches('.*[/].*');",
 '    }',
 '    // QA: email verificado obrigatorio, mesmo sem documento de politica.',
 '    function emailVerificationAllowsCommunityAccess() {',
 "      return signedIn() && request.auth.token.get('email_verified',false) == true;",
 '    }',
 '    match /users/{uid}/blockedMembers/{blockedUid} {',
 '      allow get, list: if me(uid);',
 '      allow create: if me(uid) && validId(blockedUid) && blockedUid != uid',
 "        && request.resource.data.keys().hasOnly(['createdAt'])",
 "        && request.resource.data.keys().hasAll(['createdAt'])",
 '        && request.resource.data.createdAt == request.time;',
 '      allow delete: if me(uid);',
 '      allow update: if false;',
 '    }',
 '    match /public_profiles/{uid} {',
 '      allow get: if signedIn();',
 '      allow list, create, update, delete: if false;',
 '    }'
].join('\n');
const ending=[
 '    match /{document=**} {',
 '      allow read, write: if false;',
 '    }',
 '  }',
 '}'
].join('\n');
export function render(chat,group) {
 if(typeof chat!=='string'||typeof group!=='string'||
    !chat.includes('match /chats/{chatId}') ||
    !group.includes('match /chat_groups/{groupId}') ||
    !chat.includes('minorPolicyApproved') ||
    !group.includes('minorPolicyApproved') ||
    !chat.includes('chatNoBlock') ||
    !group.includes('atrioGroupEligible') ||
    chat.length>70000||group.length>70000)
   throw Error('qa_source_fragment_incompatible');
 if([chat,group].some(s=>/allow\s+read\s*,\s*write\s*:\s*if\s+true\s*;/.test(s)||
     s.includes('rules_version')))
   throw Error('qa_source_grant_unexpected');
 return base+'\n'+chat+'\n'+group+'\n'+ending+'\n';
}
export function generate(){
 const chat=fs.readFileSync(path.join(ROOT,'firebase/atrio-conversas-v1.rules.fragment'),'utf8');
 const group=fs.readFileSync(path.join(ROOT,'firebase/atrio-grupos-v1.rules.fragment'),'utf8');
 const out=path.join(ROOT,'tests/security/qa-general.generated.rules');
 if(fs.existsSync(out)&&fs.lstatSync(out).isSymbolicLink())
   throw Error('qa_destination_symlink');
 fs.writeFileSync(out,render(chat,group),{encoding:'utf8',mode:0o600});
 return out;
}
try {
 if(process.argv[1]===fileURLToPath(import.meta.url)){
   generate();
   console.log('QA geral: regras candidatas geradas offline. SEM DEPLOY.');
 }
}catch(e){console.error('QA geral: falha na composicao',String(e.message));process.exitCode=1;}
