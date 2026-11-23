import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-atrio-v11',
  firestore: {
    host: '127.0.0.1',
    port: 8089,
    rules: readFileSync('../../firestore.rules', 'utf8')
  }
});
const owner = env.authenticatedContext('contribution-owner').firestore();
const visitor = env.authenticatedContext('contribution-visitor').firestore();
const anon = env.unauthenticatedContext().firestore();

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    await setDoc(doc(admin, 'contribution_progress/contribution-owner'), {
      points: {conversation: 15, helpful: 14, welcome: 10},
      updatedAt: serverTimestamp()
    });
    await setDoc(doc(admin, 'posts/contribution-post'), {
      uid: 'another-member',
      title: 'Discussão de teste',
      body: 'Conteúdo de teste',
      createdAt: serverTimestamp()
    });
    await setDoc(doc(admin, 'posts/contribution-other'), {
      uid: 'another-member',
      title: 'Outra discussão',
      body: 'Conteúdo de teste',
      createdAt: serverTimestamp()
    });
    await setDoc(doc(admin, 'contribution_public/contribution-owner'), {
      track: 'conversation',
      level: 1,
      updatedAt: serverTimestamp()
    });
  });

  await assertSucceeds(getDoc(doc(owner, 'contribution_progress/contribution-owner')));
  await assertFails(getDoc(doc(visitor, 'contribution_progress/contribution-owner')));
  await assertFails(getDocs(collection(owner, 'contribution_progress')));
  await assertFails(setDoc(doc(owner, 'contribution_progress/contribution-owner'), {
    points: {conversation: 999}
  }));
  await assertFails(setDoc(doc(owner, 'contribution_progress/forged-member'), {
    points: {conversation: 999}
  }));

  await assertSucceeds(setDoc(doc(owner,
    'contribution_highlight_settings/contribution-owner'), {
    track: 'conversation',
    updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(owner,
    'contribution_highlight_settings/contribution-owner'), {
    track: 'helpful',
    updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(visitor,
    'contribution_highlight_settings/contribution-owner'), {
    track: 'conversation',
    updatedAt: serverTimestamp()
  }));
  await assertFails(getDoc(doc(visitor,
    'contribution_highlight_settings/contribution-owner')));
  await assertSucceeds(deleteDoc(doc(owner,
    'contribution_highlight_settings/contribution-owner')));

  const visible = await assertSucceeds(getDoc(doc(visitor,
    'contribution_public/contribution-owner')));
  assert.deepEqual(Object.keys(visible.data()).sort(), ['level', 'track', 'updatedAt']);
  await assertFails(getDoc(doc(anon, 'contribution_public/contribution-owner')));
  await assertFails(getDocs(collection(visitor, 'contribution_public')));
  await assertFails(setDoc(doc(owner, 'contribution_public/contribution-owner'), {
    track: 'welcome', level: 5
  }));
  await assertFails(getDoc(doc(owner, 'contribution_ledger/private-ledger-entry')));
  await assertFails(getDoc(doc(owner, 'contribution_first_posts/contribution-owner')));
  await assertFails(getDoc(doc(owner, 'contribution_first_posts/contribution-owner/feed/first')));
  await env.withSecurityRulesDisabled(context => setDoc(
    doc(context.firestore(), 'contribution_config/feed_rollout'), {startedAt: serverTimestamp()},
  ));
  const feedConfig = await assertSucceeds(getDoc(doc(owner, 'contribution_config/feed_rollout')));
  assert.deepEqual(Object.keys(feedConfig.data()), ['startedAt']);
  await assertFails(getDoc(doc(anon, 'contribution_config/feed_rollout')));
  await assertFails(getDoc(doc(owner, 'contribution_config/rollout')));
  await assertFails(getDocs(collection(owner, 'contribution_config')));
  await assertFails(setDoc(doc(owner, 'contribution_config/feed_rollout'), {startedAt: serverTimestamp()}));

  await assertFails(getDoc(doc(owner,
    'contribution_post_likes/contribution-post/actors/private-actor')));

  await assertSucceeds(setDoc(doc(owner,
    'users/contribution-owner/likedPosts/contribution-post'), {
    postId: 'contribution-post',
    createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(owner,
    'users/contribution-owner/likedPosts/contribution-other'), {
    postId: 'contribution-post',
    createdAt: serverTimestamp()
  }));

  console.log('OK contribuição: progressos privados, destaque autorizado, leitura pública limitada e curtidas vinculadas ao post.');
} finally {
  await env.cleanup();
}
