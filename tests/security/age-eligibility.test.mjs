/**
 * Valida a barreira etária em regras Firestore locais; não conecta à produção.
 */
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {deleteApp, initializeApp} from '@firebase/app';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  Timestamp,
} from '@firebase/firestore';

const projectId = 'demo-atrio-v11';
const policyVersion = '2026-11-18plus-v1';
const emulator = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8089').split(':');
const emulatorHost = emulator.slice(0, -1).join(':');
const emulatorPort = Number(emulator.at(-1));
const apps = [];

function createDb(name, mockUserToken) {
  const app = initializeApp({projectId}, `age-${name}-${process.pid}`);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, emulatorHost, emulatorPort, {mockUserToken});
  return db;
}

const owner = createDb('owner', 'owner');
const adultUid = `adult-${process.pid}`;
const missingUid = `missing-${process.pid}`;
const ineligibleUid = `ineligible-${process.pid}`;
const adult = createDb('adult', {sub: adultUid, user_id: adultUid});
const missing = createDb('missing', {sub: missingUid, user_id: missingUid});
const minor = createDb('minor', {sub: ineligibleUid, user_id: ineligibleUid});
const protectedProfile = (db, uid) => getDoc(doc(db, `users/${uid}/private/profile_v3`));
const proofPath = (uid) => `users/${uid}/private/age_eligibility`;
const proof = (status = 'eligible') => ({
  status,
  minimumAge: 18,
  policyVersion,
  method: 'local_birthdate_self_declaration',
  attestedAt: Timestamp.fromDate(new Date('2026-11-20T12:00:00Z')),
});

after(async () => Promise.all(apps.map(deleteApp)));

test('age gate remains staged and enforces only server-written eligible proof', async () => {
  const gateDoc = doc(owner, 'app_config/age_policy');
  const missingProof = doc(missing, proofPath(missingUid));

  // Ausência do switch mantém compatibilidade até a ativação administrativa.
  await setDoc(gateDoc, {enabled: false, version: policyVersion});
  await protectedProfile(missing, missingUid);

  await setDoc(gateDoc, {enabled: true, version: policyVersion});
  await assert.rejects(protectedProfile(missing, missingUid));
  await getDoc(missingProof); // Titular consulta a própria situação.
  await assert.rejects(setDoc(missingProof, proof())); // Cliente não cria prova.
  await assert.rejects(getDoc(doc(adult, proofPath(missingUid)))); // Sem acesso cruzado.

  await setDoc(doc(owner, proofPath(adultUid)), proof());
  await setDoc(doc(owner, proofPath(ineligibleUid)), proof('ineligible'));
  await protectedProfile(adult, adultUid);
  await assert.rejects(protectedProfile(minor, ineligibleUid));

  await setDoc(gateDoc, {enabled: false, version: policyVersion});
  await protectedProfile(minor, ineligibleUid);
});
