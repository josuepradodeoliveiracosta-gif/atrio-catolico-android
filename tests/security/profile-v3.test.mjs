import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-atrio-v11',
  firestore: {
    host: '127.0.0.1',
    port: 8089,
    rules: readFileSync('firestore.rules', 'utf8')
  }
});
const owner = env.authenticatedContext('profile-v3-owner').firestore();
const visitor = env.authenticatedContext('profile-v3-visitor').firestore();
const ownerPath = 'profiles/profile-v3-owner';
const preferencesPath = 'users/profile-v3-owner/private/preferences';
const v3Path = 'users/profile-v3-owner/private/profile_v3';
const publicPath = 'public_profiles/profile-v3-owner';

const profileData = {
  displayName: 'Pessoa de teste',
  createdAt: serverTimestamp()
};
const preferences = {
  interests: ['Oração', 'Formação'],
  participation: '',
  city: '',
  parish: '',
  consentVersion: 'cadastro-v2-2026-11',
  consentAt: serverTimestamp(),
  updatedAt: serverTimestamp()
};
const details = {
  saint: 'Santa Teresinha',
  devotionPhrase: 'Fazer o simples com amor.',
  ageBand: '25–34',
  maritalStatus: 'Casado(a)',
  visibleFields: ['saint', 'ageBand'],
  publicInterests: ['Oração'],
  consentVersion: 'perfil-v3-2026-11',
  consentAt: serverTimestamp(),
  updatedAt: serverTimestamp()
};

try {
  await env.clearFirestore();
  await assertSucceeds(setDoc(doc(owner, ownerPath), profileData));
  await assertSucceeds(setDoc(doc(owner, preferencesPath), preferences));
  await assertSucceeds(setDoc(doc(owner, v3Path), details));
  const joinedAt = (await assertSucceeds(getDoc(doc(owner, ownerPath)))).data().createdAt;
  const visible = {
    displayName: profileData.displayName,
    bio: '',
    joinedAt,
    updatedAt: serverTimestamp(),
    saint: 'Santa Teresinha',
    devotionPhrase: 'Fazer o simples com amor.',
    ageBand: '25–34',
    interests: ['Oração']
  };
  await assertSucceeds(setDoc(doc(owner, publicPath), visible));
  const publicView = (await assertSucceeds(getDoc(doc(visitor, publicPath)))).data();
  assert.deepEqual(publicView.interests, ['Oração']);
  assert.equal(publicView.ageBand, '25–34');
  assert.equal(publicView.maritalStatus, undefined);
  assert.equal(publicView.city, undefined);
  assert.equal(publicView.dateOfBirth, undefined);

  await assertFails(getDoc(doc(visitor, v3Path)));
  await assertFails(updateDoc(doc(owner, v3Path), {
    dateOfBirth: '1994-02-03', ageBand: '34'
  }));
  await assertFails(updateDoc(doc(owner, publicPath), {
    maritalStatus: 'Casado(a)', updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(owner, publicPath), {
    ageBand: '34', updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(owner, publicPath), {
    interests: ['Oração', 'Formação', 'Comunidade', 'Notícias católicas'],
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(owner, preferencesPath), {
    interests: ['Formação'],
    consentAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));

  const privateUpdate = {
    ...details,
    visibleFields: [],
    publicInterests: [],
    consentAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const batch = writeBatch(owner);
  batch.set(doc(owner, v3Path), privateUpdate);
  batch.set(doc(owner, publicPath), {
    displayName: profileData.displayName,
    bio: '',
    joinedAt,
    updatedAt: serverTimestamp()
  });
  await assertSucceeds(batch.commit());
  const hidden = (await assertSucceeds(getDoc(doc(visitor, publicPath)))).data();
  assert.equal(hidden.saint, undefined);
  assert.equal(hidden.devotionPhrase, undefined);
  assert.equal(hidden.ageBand, undefined);
  assert.equal(hidden.maritalStatus, undefined);
  assert.equal(hidden.interests, undefined);
  await assertSucceeds(updateDoc(doc(owner, preferencesPath), {
    interests: ['Formação'],
    consentAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));

  const noConsent = {
    ...privateUpdate,
    consentVersion: 'old-version',
    consentAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await assertFails(setDoc(doc(owner, v3Path), noConsent));
  await assertFails(deleteDoc(doc(owner, v3Path)));
  console.log('PASS PROFILE V3 private fields, consent, projection and revocation');
} finally {
  await env.cleanup();
}
