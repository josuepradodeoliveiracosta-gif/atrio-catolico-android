"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const projectId = process.env.GCLOUD_PROJECT || "demo-atrio-v11";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(projectId, /^demo-/, "Run only against a Firebase demo project.");
assert.match(emulatorHost, /^(127\.0\.0\.1|localhost):\d+$/,
  "Run only with the local Firestore emulator.");

admin.initializeApp({ projectId });
const db = getFirestore();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label, check, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await check();
    if (result) return result;
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function pointsFor(uid) {
  const snapshot = await db.doc(`contribution_progress/${uid}`).get();
  const points = snapshot.get("points") || {};
  return {
    conversation: Number(points.conversation) || 0,
    helpful: Number(points.helpful) || 0,
    welcome: Number(points.welcome) || 0,
  };
}

async function waitForPoints(uid, expected) {
  return waitFor(`points for ${uid}`, async () => {
    const points = await pointsFor(uid);
    return Object.entries(expected).every(([track, value]) => points[track] === value)
      ? points : null;
  });
}

async function run() {
  const suffix = crypto.randomBytes(6).toString("hex");
  const postId = `contribution-smoke-${suffix}`;
  const newcomerUid = `newcomer-${suffix}`;
  const hostUid = `host-${suffix}`;
  const likerOne = `liker-one-${suffix}`;
  const likerTwo = `liker-two-${suffix}`;
  const reactionUid = `reactor-${suffix}`;
  const hostReplyId = `welcome-${suffix}`;
  const returnReplyId = `return-${suffix}`;
  const postRef = db.doc(`posts/${postId}`);
  const hostReplyRef = postRef.collection("replies").doc(hostReplyId);
  const returnReplyRef = postRef.collection("replies").doc(returnReplyId);
  const reactionRef = hostReplyRef.collection("reactions").doc(reactionUid);

  await postRef.set({
    uid: newcomerUid,
    authorName: "Novato",
    title: "Uma conversa nova",
    body: "Conteúdo para teste de contribuição.",
    category: "Vida espiritual",
    createdAt: FieldValue.serverTimestamp(),
  });
  await waitFor("first-post marker", async () =>
    (await db.doc(`contribution_first_posts/${newcomerUid}`).get()).get("postId") === postId);

  await Promise.all([likerOne, likerTwo].map((actorUid) =>
    db.doc(`users/${actorUid}/likedPosts/${postId}`).set({
      postId,
      createdAt: FieldValue.serverTimestamp(),
    })));

  await hostReplyRef.set({
    uid: hostUid,
    authorName: "Acolhedor",
    body: "Bem-vindo à comunidade.",
    createdAt: FieldValue.serverTimestamp(),
  });
  await returnReplyRef.set({
    uid: newcomerUid,
    authorName: "Novato",
    body: "Obrigado pela acolhida.",
    replyToId: hostReplyId,
    replyToUid: hostUid,
    createdAt: FieldValue.serverTimestamp(),
  });
  await reactionRef.set({
    kind: "❤️",
    createdAt: FieldValue.serverTimestamp(),
  });

  await waitForPoints(newcomerUid, {conversation: 5});
  await waitForPoints(hostUid, {helpful: 3, welcome: 5});

  await reactionRef.delete();
  await waitForPoints(hostUid, {helpful: 2, welcome: 5});
  await returnReplyRef.delete();
  await waitForPoints(hostUid, {helpful: 0, welcome: 2});
  await hostReplyRef.delete();
  await waitForPoints(newcomerUid, {conversation: 2});
  await waitForPoints(hostUid, {welcome: 0});
  await db.doc(`users/${likerOne}/likedPosts/${postId}`).delete();
  await waitForPoints(newcomerUid, {conversation: 1});
  await postRef.delete();
  await waitForPoints(newcomerUid, {conversation: 0});

  const highlightUid = `highlight-${suffix}`;
  await db.doc(`contribution_progress/${highlightUid}`).set({
    points: {conversation: 15, helpful: 0, welcome: 0},
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`contribution_highlight_settings/${highlightUid}`).set({
    track: "conversation",
    updatedAt: FieldValue.serverTimestamp(),
  });
  await waitFor("public highlight", async () => {
    const badge = await db.doc(`contribution_public/${highlightUid}`).get();
    return badge.exists && badge.get("track") === "conversation" && badge.get("level") === 1;
  });
  await db.doc(`contribution_progress/${highlightUid}`).update({
    points: {conversation: 0, helpful: 0, welcome: 0},
    updatedAt: FieldValue.serverTimestamp(),
  });
  await waitFor("withdrawn public highlight", async () =>
    !(await db.doc(`contribution_public/${highlightUid}`).get()).exists);

  // Reuse the historical ID on purpose. Feed estornos must only affect its
  // own ledger entries, and the same member can comment in both destinations.
  const feedOwner = `feed-owner-${suffix}`;
  const feedHost = `feed-host-${suffix}`;
  const feedPost = db.doc(`feed_posts/${postId}`);
  const feedRoot = feedPost.collection("comments").doc("root");
  const feedRepeated = feedPost.collection("comments").doc("duplicate");
  const feedReply = feedPost.collection("comments").doc("response");
  const feedRollout = db.doc("contribution_config/feed_rollout");
  const baseComment = {
    authorUid: feedHost, parentId: "", body: "Comentário inicial",
    createdAt: FieldValue.serverTimestamp(),
  };

  await db.doc(`contribution_progress/${feedOwner}`).set({points: {conversation: 15}});
  await feedPost.set({
    authorUid: feedOwner, destination: "timeline", format: "post", published: true,
    body: "Conteúdo da linha do tempo", createdAt: FieldValue.serverTimestamp(),
  });
  // A later reconciliation must skip interactions created before the cutoff.
  await feedPost.collection("comments").doc("before-rollout").set({
    ...baseComment, authorUid: `early-${suffix}`,
  });
  await feedRollout.set({startedAt: FieldValue.serverTimestamp()});

  await feedRoot.set(baseComment);
  await feedRepeated.set({...baseComment, body: "Comentário repetido"});
  await waitForPoints(feedOwner, {conversation: 18, welcome: 0});
  await feedReply.set({
    authorUid: feedOwner, parentId: "root", body: "Resposta direta",
    createdAt: FieldValue.serverTimestamp(),
  });
  await waitForPoints(feedHost, {helpful: 2, welcome: 0});
  await feedRoot.update({removed: true, body: ""});
  await waitForPoints(feedHost, {helpful: 0, welcome: 0});
  await waitForPoints(feedOwner, {conversation: 18});
  await feedPost.update({published: false});
  await waitForPoints(feedOwner, {conversation: 15});

  const feedLedger = await db.collection("contribution_ledger").where("feedPostId", "==", postId).get();
  assert.ok(feedLedger.size > 0);
  assert.ok(feedLedger.docs.every((entry) => entry.get("active") === false && !entry.get("scopePostId")));
  console.log("OK feed: comentário, resposta, remoção, estorno e preservação do saldo anterior.");

  console.log("OK funções: três trilhas, reações, respostas diretas, destaque e estornos.");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.app().delete();
  });
