import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {assertFails, assertSucceeds, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {
  Bytes, collection, deleteDoc, doc, getDocFromServer, getDocsFromServer,
  orderBy, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-atrio-v11',
  firestore: {
    host: '127.0.0.1',
    port: 8089,
    rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
  },
});
const alice = env.authenticatedContext('feed-alice').firestore();
const bob = env.authenticatedContext('feed-bob').firestore();
const carol = env.authenticatedContext('feed-carol').firestore();
const guest = env.unauthenticatedContext().firestore();
const friendship = 'feed_friendships/feed-alice/peers/feed-bob';
const reverse = 'feed_friendships/feed-bob/peers/feed-alice';
const timeline = 'feed_posts/feed-timeline';
const channel = 'feed_posts/feed-channel';
const follow = 'feed_following/feed-carol/channels/feed-alice';
const image = timeline + '/media/image';
const comment = timeline + '/comments/root';

const post = (destination, authorUid = 'feed-alice') => ({
  authorUid, destination, published: true, format: 'post',
  body: 'Uma publicação de exemplo', createdAt: serverTimestamp(),
});
const invite = () => ({status: 'pending', createdAt: serverTimestamp()});
const read = (db, path) => getDocFromServer(doc(db, path));
const recent = (db, destination, extra = []) => getDocsFromServer(query(
  collection(db, 'feed_posts'),
  where('destination', '==', destination),
  where('published', '==', true),
  ...extra,
  orderBy('createdAt', 'desc'),
));

try {
  await assertSucceeds(setDoc(doc(alice, timeline), post('timeline')));
  await assertFails(setDoc(doc(bob, channel), post('timeline')));
  await assertFails(setDoc(doc(alice, channel), post('channel')));
  await assertFails(setDoc(doc(bob, 'feed_channels/feed-alice'), {name: 'Outro', updatedAt: serverTimestamp()}));
  await assertSucceeds(setDoc(doc(alice, 'feed_channels/feed-alice'), {name: 'Canal', updatedAt: serverTimestamp()}));
  await assertSucceeds(setDoc(doc(alice, channel), post('channel')));

  await assertSucceeds(setDoc(doc(alice, image), {
    contentType: 'image/webp', bytes: Bytes.fromUint8Array(new Uint8Array([1, 2, 3])),
  }));
  await assertSucceeds(setDoc(doc(alice, comment), {
    authorUid: 'feed-alice', parentId: '', body: 'Comentário', createdAt: serverTimestamp(),
  }));
  await assertFails(read(guest, channel));
  assert.equal((await assertSucceeds(recent(carol, 'channel'))).size, 1);
  await assertFails(setDoc(doc(bob, follow), {createdAt: serverTimestamp()}));
  await assertFails(setDoc(doc(carol, 'feed_following/feed-carol/channels/feed-bob'),
    {createdAt: serverTimestamp()}));
  await assertSucceeds(setDoc(doc(carol, follow), {createdAt: serverTimestamp()}));
  await assertFails(read(bob, follow));
  assert.equal((await assertSucceeds(getDocsFromServer(
    collection(carol, 'feed_following/feed-carol/channels'),
  ))).size, 1);
  await assertSucceeds(deleteDoc(doc(carol, follow)));
  assert.equal((await assertSucceeds(recent(carol, 'channel'))).size, 1);
  await assertSucceeds(updateDoc(doc(alice, 'feed_channels/feed-alice'), {
    imageJpeg: Bytes.fromUint8Array(new Uint8Array([255, 216, 255, 217])),
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(carol, 'feed_channels/feed-alice'), {
    name: 'Canal alheio', updatedAt: serverTimestamp(),
  }));

  for (const path of [timeline, image, comment]) await assertFails(read(carol, path));

  await assertSucceeds(setDoc(doc(alice, friendship), invite()));
  await assertFails(setDoc(doc(bob, reverse), invite()));
  await assertFails(updateDoc(doc(alice, friendship), {status: 'accepted'}));
  await assertFails(read(bob, timeline));
  await assertSucceeds(updateDoc(doc(bob, friendship), {status: 'accepted'}));
  for (const path of [timeline, image, comment]) await assertSucceeds(read(bob, path));
  const author = [where('authorUid', '==', 'feed-alice')];
  assert.equal((await assertSucceeds(recent(bob, 'timeline', author))).size, 1);
  await assertFails(recent(carol, 'timeline', author));
  await assertFails(getDocsFromServer(collection(bob, 'feed_posts')));

  await assertSucceeds(deleteDoc(doc(bob, friendship)));
  for (const path of [timeline, image, comment]) await assertFails(read(bob, path));
  await assertFails(recent(bob, 'timeline', author));
  await assertSucceeds(setDoc(doc(alice, friendship), invite()));
  await assertFails(read(bob, timeline));
  await assertFails(updateDoc(doc(alice, timeline), {destination: 'channel'}));
  await assertSucceeds(updateDoc(doc(alice, timeline), {published: false}));
  await assertFails(read(alice, image));
  await assertFails(updateDoc(doc(alice, timeline), {published: true}));
  console.log('Publicações: acesso por amizade, revogação, imagem, comentários e canal validados.');
} finally {
  await env.cleanup();
}
