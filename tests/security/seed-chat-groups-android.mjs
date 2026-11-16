import {readFileSync} from 'node:fs';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,serverTimestamp,Timestamp} from 'firebase/firestore';

const project = 'demo-atrio-v11';
const auth = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const rules = readFileSync('qa-parity.generated.rules', 'utf8');
if (!rules.includes('BEGIN QA PARITY ADDITIVE')) {
  throw new Error('As regras compostas são obrigatórias.');
}

async function authRequest(path, body, headers = {}) {
  const response = await fetch(auth + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Auth Emulator recusou a fixture: HTTP ' + response.status);
  return response.json();
}

const accounts = [
  {email: 'conversas.alice@qa.invalid', name: 'Alice QA', requests: 'none'},
  {email: 'conversas.bob@qa.invalid', name: 'Bob QA', requests: 'all'}
];
for (const account of accounts) {
  const {localId} = await authRequest('/accounts:signUp?key=local-emulator-test', {
    email: account.email, password: 'GrupoQa2026!Emulador', returnSecureToken: false
  });
  const verified = await authRequest('/projects/' + project + '/accounts:update',
    {localId, emailVerified: true}, {Authorization: 'Bearer owner'});
  if (verified.localId !== localId || verified.emailVerified !== true) {
    throw new Error('Auth Emulator não confirmou o e-mail da fixture.');
  }
  account.uid = localId;
}

const env = await initializeTestEnvironment({
  projectId: project, firestore: {host: '127.0.0.1', port: 8089, rules}
});
try {
  const expiration = Timestamp.fromMillis(Date.now() + 86_400_000);
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'app_config/conversations'), {
      enabled: true, version: '2026-11-v1', minorPolicyApproved: true,
      safetyReviewVersion: '2026-11-safety-v1'
    });
    await setDoc(doc(db, 'app_config/chat_groups'), {
      enabled: true, version: '2026-11-groups-v1', minorPolicyApproved: true
    });
    for (const {uid, name, requests} of accounts) {
      await setDoc(doc(db, 'users', uid, 'chatAgeEligibility', 'current'), {
        status: 'eligible', minimumAge: 18, policyVersion: '2026-11-18plus-qa-v1',
        reviewExpiresAt: expiration
      });
      await setDoc(doc(db, 'users', uid, 'chatGroupAccess', 'eligibility'), {
        status: 'approved', policyVersion: '2026-11-group-safety-v1',
        reviewExpiresAt: expiration
      });
      await setDoc(doc(db, 'public_profiles', uid), {
        uid, displayName: name, createdAt: serverTimestamp()
      });
      await setDoc(doc(db, 'users', uid, 'chatSettings', 'privacy'), {
        requests, readReceipts: false, showPushPreview: false, updatedAt: serverTimestamp()
      });
    }
  });
  console.log('Conversas QA: regras compostas e duas contas fictícias verificadas no emulador local.');
} finally {
  await env.cleanup();
}
