import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc, writeBatch} from 'firebase/firestore';
import {alice, bob, moderator, pilotDocuments, projectId}
  from '../../firebase/qa-geral-celular/pilot/fixtures.mjs';
import {renderClosedPilotRules} from '../../firebase/qa-geral-celular/pilot/rules.mjs';

const auth = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const password = 'GrupoQa2026!Emulador'; // senha pública, só para o Auth Emulator.
const outsider = {uid: 'qa-pilot-fora', email: 'fora@qa.invalid'};
const users = [alice, bob, moderator, outsider].map(({uid, email, name}) => ({
  localId: uid, email, emailVerified: true, displayName: name, rawPassword: password
}));
const imported = await fetch(auth + '/projects/' + projectId + '/accounts:batchCreate', {
  method: 'POST',
  headers: {Authorization: 'Bearer owner', 'Content-Type': 'application/json'},
  body: JSON.stringify({users}),
  signal: AbortSignal.timeout(10_000)
});
assert.ok(imported.ok, 'Falha ao provisionar Auth Emulator: HTTP ' + imported.status);
assert.deepEqual((await imported.json()).error ?? [], [], 'Identidades fictícias recusadas');

const rules = renderClosedPilotRules();
const env = await initializeTestEnvironment({
  projectId, firestore: {host: '127.0.0.1', port: 8089, rules}
});
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (const [path, data] of pilotDocuments(new Date())) batch.set(doc(db, path), data);
    batch.set(doc(db, 'users', bob.uid, 'chatSettings', 'privacy'), {
      requests: 'all', readReceipts: false, showPushPreview: false
    });
    await batch.commit();
  });
  console.log('SHA-256 das Rules do piloto:', createHash('sha256').update(rules).digest('hex'));
} finally {
  await env.cleanup();
}
