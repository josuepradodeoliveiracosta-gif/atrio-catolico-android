import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {assertFails, assertSucceeds, initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {
  Bytes, collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer,
  orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
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
const friendship = 'feed_friendships/feed-alice/feed_friendship_edges/feed-bob';
const reverse = 'feed_friendships/feed-bob/feed_friendship_edges/feed-alice';
const timeline = 'feed_posts/feed-timeline';
const channel = 'feed_posts/feed-channel';
const follow = 'feed_following/feed-carol/channels/feed-alice';
const image = timeline + '/media/image';
const comment = timeline + '/comments/root';

const post = (destination, authorUid = 'feed-alice') => ({
  authorUid, destination, published: true, format: 'post',
  body: 'Uma publicação de exemplo', createdAt: serverTimestamp(),
});
const invite = (senderUid = 'feed-alice', recipientUid = 'feed-bob') => ({
  status: 'pending', createdAt: serverTimestamp(), senderUid, recipientUid,
});
const read = (db, path) => getDocFromServer(doc(db, path));
const recent = (db, destination, extra = []) => getDocsFromServer(query(
  collection(db, 'feed_posts'),
  where('destination', '==', destination),
  where('published', '==', true),
  ...extra,
  orderBy('createdAt', 'desc'),
));

try {
  await assertFails(setDoc(doc(alice, timeline), post('timeline')));
  await assertFails(setDoc(doc(alice, 'feed_channels/feed-alice'),
    {name: 'Canal', updatedAt: serverTimestamp()}));
  await env.withSecurityRulesDisabled(ctx => setDoc(
    doc(ctx.firestore(), 'app_config/community_feed'), {enabled: true},
  ));
  await assertSucceeds(setDoc(doc(alice, timeline), post('timeline')));
  await assertFails(setDoc(doc(bob, channel), post('timeline')));
  await assertFails(setDoc(doc(alice, channel), post('channel')));
  await assertFails(setDoc(doc(bob, 'feed_channels/feed-alice'), {name: 'Outro', updatedAt: serverTimestamp()}));
  await assertSucceeds(setDoc(doc(alice, 'feed_channels/feed-alice'), {name: 'Canal', updatedAt: serverTimestamp()}));
  await assertSucceeds(setDoc(doc(alice, channel), post('channel')));
  const questionRef = doc(alice, 'feed_posts/feed-question');
  const question = {...post('channel'), format: 'question', title: 'Como participar?', body: '', hasImage: true};
  await assertFails(setDoc(questionRef, question));
  await assertFails(setDoc(questionRef, {...question, title: '', hasImage: false}));
  const upload = writeBatch(alice).set(questionRef, question)
    .set(doc(questionRef, 'media', 'image'), {
      contentType: 'image/jpeg', bytes: Bytes.fromUint8Array(new Uint8Array([255, 216, 255, 217])),
    });
  await assertSucceeds(upload.commit());
  await assertFails(setDoc(questionRef, {...question, body: 'Outro conteúdo'}));
  await assertSucceeds(read(carol, 'feed_posts/feed-question/media/image'));


  await assertSucceeds(setDoc(doc(alice, image), {
    contentType: 'image/webp', bytes: Bytes.fromUint8Array(new Uint8Array([1, 2, 3])),
  }));
  await assertSucceeds(setDoc(doc(alice, comment), {
    authorUid: 'feed-alice', parentId: '', body: 'Comentário', createdAt: serverTimestamp(),
  }));
  await assertFails(read(guest, channel));
  assert.equal((await assertSucceeds(recent(carol, 'channel'))).size, 2);
  await assertFails(setDoc(doc(bob, follow), {createdAt: serverTimestamp()}));
  await assertFails(setDoc(doc(carol, 'feed_following/feed-carol/channels/feed-bob'),
    {createdAt: serverTimestamp()}));
  await assertSucceeds(setDoc(doc(carol, follow), {createdAt: serverTimestamp()}));
  await assertFails(read(bob, follow));
  assert.equal((await assertSucceeds(getDocsFromServer(
    collection(carol, 'feed_following/feed-carol/channels'),
  ))).size, 1);
  await assertSucceeds(deleteDoc(doc(carol, follow)));
  assert.equal((await assertSucceeds(recent(carol, 'channel'))).size, 2);
  await assertSucceeds(updateDoc(doc(alice, 'feed_channels/feed-alice'), {
    imageJpeg: Bytes.fromUint8Array(new Uint8Array([255, 216, 255, 217])),
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(carol, 'feed_channels/feed-alice'), {
    name: 'Canal alheio', updatedAt: serverTimestamp(),
  }));

  for (const path of [timeline, image, comment]) await assertFails(read(carol, path));

  await assertSucceeds(setDoc(doc(alice, friendship), invite()));
  await assertFails(setDoc(doc(bob, reverse), invite('feed-bob', 'feed-alice')));
  await assertFails(updateDoc(doc(alice, friendship), {status: 'accepted'}));
  await assertFails(read(bob, timeline));
  await assertSucceeds(updateDoc(doc(bob, friendship), {status: 'accepted'}));
  const replyPath = timeline + '/comments/feed-reply';
  const noticePath = 'feed_notices/feed-alice/items/feed-reply';
  const notice = {postId: 'feed-timeline', kind: 'reply', read: false, createdAt: serverTimestamp()};
  await assertFails(setDoc(doc(bob, noticePath), notice));
  await assertSucceeds(writeBatch(bob)
    .set(doc(bob, replyPath), {
      authorUid: 'feed-bob', parentId: 'root', body: 'Resposta',
      createdAt: serverTimestamp(),
    })
    .set(doc(bob, noticePath), notice)
    .commit());
  await assertSucceeds(read(alice, noticePath));
  await assertFails(read(bob, noticePath));
  const thirdReply = timeline + '/comments/feed-two-notices';
  await assertFails(writeBatch(carol)
    .set(doc(carol, thirdReply), {
      authorUid: 'feed-carol', parentId: 'root', body: 'Sem acesso',
      createdAt: serverTimestamp(),
    })
    .set(doc(carol, 'feed_notices/feed-alice/items/feed-two-notices'), notice)
    .commit());
  const channelReply = channel + '/comments/feed-channel-reply';
  await assertSucceeds(setDoc(doc(bob, channel + '/comments/feed-root-bob'), {
    authorUid: 'feed-bob', parentId: '', body: 'Comentário no canal', createdAt: serverTimestamp(),
  }));
  const authorNotice = 'feed_notices/feed-alice/items/feed-channel-reply';
  const parentNotice = 'feed_notices/feed-bob/items/feed-channel-reply';
  await assertSucceeds(writeBatch(carol)
    .set(doc(carol, channelReply), {
      authorUid: 'feed-carol', parentId: 'feed-root-bob', body: 'Resposta no canal',
      createdAt: serverTimestamp(),
    })
    .set(doc(carol, authorNotice), {...notice, postId: 'feed-channel', kind: 'comment'})
    .set(doc(carol, parentNotice), {...notice, postId: 'feed-channel'})
    .commit());
  await assertSucceeds(read(alice, authorNotice));
  await assertSucceeds(read(bob, parentNotice));
  // O autor não pode gerar um aviso atrasado para um comentário já salvo.
  await assertFails(setDoc(doc(bob, 'feed_notices/feed-alice/items/feed-root-bob'), {
    ...notice, postId: 'feed-channel', kind: 'comment',
  }));

  await assertFails(setDoc(doc(bob, timeline + '/comments/feed-too-deep'), {
    authorUid: 'feed-bob', parentId: 'feed-reply', body: 'Segundo nível',
    createdAt: serverTimestamp(),
  }));
  const report = {
    reporterUid: 'feed-bob', targetUid: 'feed-alice', targetId: 'feed-timeline',
    targetType: 'comment', commentId: 'root', title: '', body: 'Comentário',
    reason: 'Contexto para revisão', status: 'pending', createdAt: serverTimestamp(),
  };
  const reportPath = 'feed_reports/feed-test-report';
  await assertFails(setDoc(doc(bob, reportPath), {...report, body: 'Contexto inventado'}));
  await assertSucceeds(setDoc(doc(bob, reportPath), report));
  await assertFails(read(carol, reportPath));
  await assertSucceeds(updateDoc(doc(alice, comment), {removed: true, body: ''}));
  assert.equal((await assertSucceeds(read(bob, comment))).get('body'), '');
  await assertSucceeds(read(bob, replyPath));
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'admins/feed-admin'), {enabled: true});
  });
  const admin = env.authenticatedContext('feed-admin').firestore();
  assert.equal((await assertSucceeds(read(admin, reportPath))).get('body'), 'Comentário');
  await assertSucceeds(updateDoc(doc(admin, reportPath), {
    status: 'reviewed', reviewedBy: 'feed-admin', reviewedAt: serverTimestamp(),
  }));

  const incoming = db => query(collectionGroup(db, 'feed_friendship_edges'),
    where('recipientUid', '==', 'feed-bob'));
  assert.equal((await assertSucceeds(getDocsFromServer(incoming(bob)))).size, 1);
  await assertFails(getDocsFromServer(incoming(carol)));
  await assertFails(getDocsFromServer(collectionGroup(bob, 'feed_friendship_edges')));

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
  const oldPost = 'posts/feed-legacy-example';
  const oldReply = oldPost + '/replies/legacy-reply';
  const oldNotice = 'users/feed-bob/notifications/legacy-reply';
  const oldSaved = 'users/feed-bob/savedPosts/feed-legacy-example';
  const seed = ctx => Promise.all([
    setDoc(doc(ctx.firestore(), oldPost), {title: 'Fórum antigo'}),
    setDoc(doc(ctx.firestore(), oldReply), {body: 'Resposta antiga'}),
    setDoc(doc(ctx.firestore(), oldNotice), {postId: 'feed-legacy-example'}),
    setDoc(doc(ctx.firestore(), oldSaved), {createdAt: serverTimestamp()}),
    setDoc(doc(ctx.firestore(), 'profiles/feed-bob'), {displayName: 'Conta de QA'}),
  ]);
  await env.withSecurityRulesDisabled(seed);
  for (const path of [oldPost, oldReply, oldNotice, oldSaved]) {
    await assertSucceeds(read(bob, path));
  }
  const oldDraft = () => ({
    uid: 'feed-bob', authorName: 'Conta de QA', title: 'Tópico de teste',
    body: 'Publicação fictícia', category: 'Sagradas Escrituras', createdAt: serverTimestamp(),
  });
  await assertSucceeds(setDoc(doc(bob, 'posts/before-retirement'), oldDraft()));
  await assertFails(setDoc(doc(bob, 'app_config/community_feed'), {forumRetired: true}));
  await env.withSecurityRulesDisabled(ctx => setDoc(
    doc(ctx.firestore(), 'app_config/community_feed'), {enabled: false},
  ));
  await assertFails(read(bob, channel));
  await assertFails(getDocsFromServer(collection(bob, 'feed_following/feed-bob/channels')));

  await env.withSecurityRulesDisabled(ctx => setDoc(
    doc(ctx.firestore(), 'app_config/community_feed'), {forumRetired: true},
  ));
  for (const path of [oldPost, oldReply, oldNotice, oldSaved]) {
    await assertFails(read(bob, path));
  }
  await assertFails(getDocsFromServer(collection(bob, 'posts')));
  await assertFails(setDoc(doc(bob, 'posts/legacy-write'), oldDraft()));
  await assertFails(deleteDoc(doc(admin, oldPost)));
  await assertSucceeds(read(bob, channel));
  await assertSucceeds(read(bob, 'app_config/community_feed'));
  await env.withSecurityRulesDisabled(async ctx => {
    assert.equal((await read(ctx.firestore(), oldPost)).exists(), true);
  });
  console.log('Publicações: acesso por amizade, revogação, imagem, comentários e canal validados.');
} finally {
  await env.cleanup();
}
