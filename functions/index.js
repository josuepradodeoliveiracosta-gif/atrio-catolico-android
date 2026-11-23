"use strict";

const crypto = require("node:crypto");
const admin = require("firebase-admin");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentWritten,
} = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { deriveAwards, millis, progressForPoints } = require("./contribution-core.cjs");

admin.initializeApp();
const db = getFirestore();
const PAGE_SIZE = 80;
const TRACK_NAMES = ["conversation", "helpful", "welcome"];

function eventTime(event) {
  const parsed = Date.parse(event.time || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

async function rolloutTimestamp(fallbackMillis) {
  const ref = db.doc("contribution_config/rollout");
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists && snapshot.get("startedAt")) return snapshot.get("startedAt");
    const startedAt = Timestamp.fromMillis(fallbackMillis);
    transaction.set(ref, {
      startedAt,
      scoringVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return startedAt;
  });
}

function earlierPost(left, right) {
  if (!left) return right;
  if (!right) return left;
  const difference = millis(left.createdAt) - millis(right.createdAt);
  return difference < 0 || (difference === 0 && left.id.localeCompare(right.id) < 0)
    ? left : right;
}

async function rememberFirstPost(uid, candidate = null) {
  if (!uid) return { postId: "", previousPostId: "" };
  const markerRef = db.doc(`contribution_first_posts/${uid}`);
  const matchingPosts = await db.collection("posts").where("uid", "==", uid).get();
  let earliest = candidate;
  for (const post of matchingPosts.docs) {
    earliest = earlierPost(earliest, {
      id: post.id,
      createdAt: post.get("createdAt") || post.createTime,
    });
  }

  return db.runTransaction(async (transaction) => {
    const marker = await transaction.get(markerRef);
    const previousPostId = marker.get("postId") || "";
    const previous = marker.exists ? {
      id: previousPostId,
      createdAt: marker.get("createdAt"),
    } : null;
    const chosen = earlierPost(previous, earliest);
    if (chosen && chosen.id && chosen.id !== previousPostId) {
      transaction.set(markerRef, {
        postId: chosen.id,
        createdAt: chosen.createdAt || Timestamp.fromMillis(0),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (chosen && !marker.exists) {
      transaction.set(markerRef, {
        postId: chosen.id,
        createdAt: chosen.createdAt || Timestamp.fromMillis(0),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return {
      postId: chosen?.id || previousPostId,
      previousPostId,
    };
  });
}

async function firstPostIdsFor(uidList) {
  const unique = [...new Set(uidList.filter(Boolean))];
  const entries = await Promise.all(unique.map(async (uid) => {
    const markerRef = db.doc(`contribution_first_posts/${uid}`);
    const marker = await markerRef.get();
    if (marker.exists) return [uid, marker.get("postId") || ""];
    const remembered = await rememberFirstPost(uid);
    return [uid, remembered.postId];
  }));
  return new Map(entries);
}

function reactionFromDocument(snapshot, actorUid, replyId) {
  return {
    actorUid,
    replyId,
    createdAt: snapshot.get("createdAt"),
    sourcePath: snapshot.ref.path,
  };
}

async function readPostLikes(postId) {
  const [indexed, mirrored] = await Promise.all([
    db.collectionGroup("likedPosts").where("postId", "==", postId).get(),
    db.collection("contribution_post_likes").doc(postId).collection("actors").get(),
  ]);
  const likesByActor = new Map();
  for (const like of mirrored.docs) {
    const actorUid = like.get("actorUid") || "";
    if (actorUid) likesByActor.set(actorUid, {
      actorUid,
      createdAt: like.get("createdAt"),
      sourcePath: like.get("sourcePath"),
    });
  }
  for (const like of indexed.docs) {
    const actorUid = like.ref.parent.parent?.id || "";
    if (actorUid && !likesByActor.has(actorUid)) likesByActor.set(actorUid, {
      actorUid,
      createdAt: like.get("createdAt"),
      sourcePath: like.ref.path,
    });
  }
  return [...likesByActor.values()];
}

function awardDocumentId(actionKey) {
  return crypto.createHash("sha256").update(actionKey).digest("hex");
}

async function nextPostGeneration(postId) {
  const generationRef = db.doc(`contribution_reconciliation/${postId}`);
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(generationRef);
    const next = (Number(current.get("generation")) || 0) + 1;
    transaction.set(generationRef, {
      generation: next,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });
}

function groupProgressDelta(deltaByUser, uid, track, points) {
  if (!uid || !TRACK_NAMES.includes(track) || !Number.isFinite(points) || points === 0) return;
  const userDelta = deltaByUser.get(uid) || {};
  userDelta[track] = (userDelta[track] || 0) + points;
  deltaByUser.set(uid, userDelta);
}

async function applyAwards(postId, generation, desiredAwards, existingEntries) {
  const byActionKey = new Map(desiredAwards);
  for (const [actionKey] of existingEntries) {
    if (!byActionKey.has(actionKey)) byActionKey.set(actionKey, null);
  }
  const entries = [...byActionKey.entries()];
  for (let offset = 0; offset < entries.length; offset += PAGE_SIZE) {
    const chunk = entries.slice(offset, offset + PAGE_SIZE);
    const completed = await db.runTransaction(async (transaction) => {
      const generationRef = db.doc(`contribution_reconciliation/${postId}`);
      const generationSnapshot = await transaction.get(generationRef);
      if (generationSnapshot.get("generation") !== generation) return false;

      const ledgerRefs = chunk.map(([actionKey]) =>
        db.doc(`contribution_ledger/${awardDocumentId(actionKey)}`));
      const ledgerSnapshots = await Promise.all(ledgerRefs.map((ref) => transaction.get(ref)));
      const updates = [];
      const deltaByUser = new Map();

      for (let index = 0; index < chunk.length; index++) {
        const [actionKey, desired] = chunk[index];
        const snapshot = ledgerSnapshots[index];
        const previous = snapshot.exists ? snapshot.data() : null;
        const previousPoints = previous?.active === true
          ? Math.max(0, Number(previous.points) || 0) : 0;
        const nextPoints = desired ? Math.max(0, Number(desired.points) || 0) : 0;
        const sameAward = desired && previous?.active === true &&
          previous.recipientUid === desired.recipientUid &&
          previous.track === desired.track &&
          previousPoints === nextPoints &&
          previous.sourcePath === desired.sourcePath &&
          previous.targetPath === desired.targetPath;
        if (sameAward) continue;
        if (previous?.active === true) {
          groupProgressDelta(deltaByUser, previous.recipientUid, previous.track, -previousPoints);
        }
        if (desired) {
          groupProgressDelta(deltaByUser, desired.recipientUid, desired.track, nextPoints);
          updates.push({
            ref: ledgerRefs[index],
            fields: {
              actionKey,
              actorUid: desired.actorUid,
              recipientUid: desired.recipientUid,
              track: desired.track,
              points: nextPoints,
              sourcePath: desired.sourcePath,
              targetPath: desired.targetPath,
              scopePostId: postId,
              active: true,
              createdAt: previous?.createdAt || FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
          });
        } else if (previous?.active === true) {
          updates.push({
            ref: ledgerRefs[index],
            fields: { active: false, updatedAt: FieldValue.serverTimestamp() },
          });
        }
      }

      // Remove the old contribution and add the desired one in the same transaction.
      // The net per-user delta preserves totals when an action's source document changes.
      const netDelta = new Map();
      for (const [uid, trackDeltas] of deltaByUser) {
        const current = {};
        for (const [track, value] of Object.entries(trackDeltas)) {
          if (!value) continue;
          current[track] = (current[track] || 0) + value;
        }
        if (Object.keys(current).length > 0) netDelta.set(uid, current);
      }
      const progressRefs = [...netDelta.keys()].map((uid) =>
        [uid, db.doc(`contribution_progress/${uid}`)]);
      const progressSnapshots = await Promise.all(
        progressRefs.map(([, ref]) => transaction.get(ref)));

      for (let index = 0; index < updates.length; index++) {
        const update = updates[index];
        transaction.set(update.ref, update.fields, { merge: true });
      }
      for (let index = 0; index < progressRefs.length; index++) {
        const [uid, ref] = progressRefs[index];
        const current = progressSnapshots[index].get("points") || {};
        const points = { ...current };
        for (const [track, delta] of Object.entries(netDelta.get(uid))) {
          points[track] = Math.max(0, (Number(points[track]) || 0) + delta);
        }
        transaction.set(ref, {
          points,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return true;
    });
    if (!completed) return false;
  }
  return true;
}

async function reconcilePost(postId, happenedAt) {
  if (!postId) return;
  const rolloutAt = await rolloutTimestamp(happenedAt);
  const generation = await nextPostGeneration(postId);

  const postRef = db.collection("posts").doc(postId);
  const [post, ledgerSnapshot] = await Promise.all([
    postRef.get(),
    db.collection("contribution_ledger").where("scopePostId", "==", postId).get(),
  ]);
  const existingEntries = new Map(ledgerSnapshot.docs.map((entry) => [
    entry.get("actionKey"),
    entry.data(),
  ]));
  if (!post.exists) {
    await applyAwards(postId, generation, new Map(), existingEntries);
    return;
  }

  const repliesSnapshot = await postRef.collection("replies").get();
  const replyDocs = repliesSnapshot.docs;
  const replies = replyDocs.map((reply) => ({
    id: reply.id,
    ...reply.data(),
    sourcePath: reply.ref.path,
  }));
  const firstPostIdByUid = await firstPostIdsFor([
    post.get("uid"),
    ...replies.map((reply) => reply.uid),
  ]);
  const replyReactionGroups = await Promise.all(
    replyDocs.map((reply) => reply.ref.collection("reactions").get()));
  const replyReactions = replyReactionGroups.flatMap((group, index) =>
    group.docs.map((reaction) =>
      reactionFromDocument(reaction, reaction.id, replyDocs[index].id)));
  const postLikes = await readPostLikes(postId);
  const desired = deriveAwards({
    postId,
    postOwnerUid: post.get("uid") || "",
    firstPostIdByUid,
    replies,
    replyReactions,
    postLikes,
    rolloutAtMs: rolloutAt.toMillis(),
  });
  await applyAwards(postId, generation, desired, existingEntries);
}

async function reconcileReplyAwards(postId, happenedAt) {
  if (!postId) return;
  const rolloutAt = await rolloutTimestamp(happenedAt);
  const generation = await nextPostGeneration(postId);
  const postRef = db.collection("posts").doc(postId);
  const [post, ledgerSnapshot] = await Promise.all([
    postRef.get(),
    db.collection("contribution_ledger").where("scopePostId", "==", postId).get(),
  ]);
  const isReplyAward = (actionKey) =>
    actionKey.startsWith("conversation:") ||
    actionKey.startsWith("helpful:") ||
    actionKey.startsWith("welcome:") ||
    actionKey.startsWith("welcome-return:");
  const existingEntries = new Map(ledgerSnapshot.docs
    .filter((entry) => isReplyAward(entry.get("actionKey") || ""))
    .map((entry) => [entry.get("actionKey"), entry.data()]));
  if (!post.exists) {
    await applyAwards(postId, generation, new Map(), existingEntries);
    return;
  }
  const repliesSnapshot = await postRef.collection("replies").get();
  const replies = repliesSnapshot.docs.map((reply) => ({
    id: reply.id,
    ...reply.data(),
    sourcePath: reply.ref.path,
  }));
  const firstPostIdByUid = await firstPostIdsFor([
    post.get("uid"),
    ...replies.map((reply) => reply.uid),
  ]);
  const allAwards = deriveAwards({
    postId,
    postOwnerUid: post.get("uid") || "",
    firstPostIdByUid,
    replies,
    rolloutAtMs: rolloutAt.toMillis(),
  });
  const replyAwards = new Map([...allAwards].filter(([actionKey]) =>
    isReplyAward(actionKey)));
  await applyAwards(postId, generation, replyAwards, existingEntries);
}

async function syncSingleAward(actionKey, scopePostId, happenedAt, readRefs, resolveAward) {
  const rolloutAt = await rolloutTimestamp(happenedAt);
  const ledgerRef = db.doc(`contribution_ledger/${awardDocumentId(actionKey)}`);
  await db.runTransaction(async (transaction) => {
    const [previousSnapshot, ...sourceSnapshots] = await Promise.all([
      transaction.get(ledgerRef),
      ...readRefs.map((ref) => transaction.get(ref)),
    ]);
    const previous = previousSnapshot.exists ? previousSnapshot.data() : null;
    const desired = resolveAward(sourceSnapshots, rolloutAt.toMillis());
    const previousPoints = previous?.active === true
      ? Math.max(0, Number(previous.points) || 0) : 0;
    const nextPoints = desired ? Math.max(0, Number(desired.points) || 0) : 0;
    const sameAward = desired && previous?.active === true &&
      previous.recipientUid === desired.recipientUid &&
      previous.track === desired.track &&
      previousPoints === nextPoints &&
      previous.sourcePath === desired.sourcePath &&
      previous.targetPath === desired.targetPath;
    if (sameAward || (!desired && previous?.active !== true)) return;

    const deltaByUser = new Map();
    if (previous?.active === true) {
      groupProgressDelta(deltaByUser, previous.recipientUid, previous.track, -previousPoints);
    }
    if (desired) {
      groupProgressDelta(deltaByUser, desired.recipientUid, desired.track, nextPoints);
    }
    const progressRefs = [...deltaByUser.keys()].map((uid) =>
      [uid, db.doc(`contribution_progress/${uid}`)]);
    const progressSnapshots = await Promise.all(
      progressRefs.map(([, ref]) => transaction.get(ref)));

    if (desired) {
      transaction.set(ledgerRef, {
        actionKey,
        actorUid: desired.actorUid,
        recipientUid: desired.recipientUid,
        track: desired.track,
        points: nextPoints,
        sourcePath: desired.sourcePath,
        targetPath: desired.targetPath,
        scopePostId,
        active: true,
        createdAt: previous?.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      transaction.set(ledgerRef, {
        active: false,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    for (let index = 0; index < progressRefs.length; index++) {
      const [uid, ref] = progressRefs[index];
      const current = progressSnapshots[index].get("points") || {};
      const points = { ...current };
      for (const [track, delta] of Object.entries(deltaByUser.get(uid))) {
        points[track] = Math.max(0, (Number(points[track]) || 0) + delta);
      }
      transaction.set(ref, {
        points,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });
}

async function reconcileReplyReaction(postId, replyId, actorUid, happenedAt) {
  const sourceRef = db.doc(`posts/${postId}/replies/${replyId}/reactions/${actorUid}`);
  const postRef = db.doc(`posts/${postId}`);
  const replyRef = db.doc(`posts/${postId}/replies/${replyId}`);
  const actionKey = `reply-reaction:${postId}:${replyId}:${actorUid}`;
  await syncSingleAward(actionKey, postId, happenedAt, [sourceRef, postRef, replyRef],
    ([source, post, reply], rolloutAtMs) => {
      if (!source.exists || !post.exists || !reply.exists ||
          !actorUid || actorUid === reply.get("uid") ||
          millis(source.get("createdAt")) < rolloutAtMs) return null;
      return {
        actionKey,
        actorUid,
        recipientUid: reply.get("uid") || "",
        track: "helpful",
        points: 1,
        sourcePath: sourceRef.path,
        targetPath: replyRef.path,
      };
    });
}

async function reconcilePostLike(postId, actorUid, happenedAt) {
  const sourceRef = db.doc(`users/${actorUid}/likedPosts/${postId}`);
  const postRef = db.doc(`posts/${postId}`);
  const actionKey = `post-reaction:${postId}:${actorUid}`;
  await syncSingleAward(actionKey, postId, happenedAt, [sourceRef, postRef],
    ([source, post], rolloutAtMs) => {
      if (!source.exists || !post.exists || !actorUid ||
          actorUid === post.get("uid") ||
          millis(source.get("createdAt")) < rolloutAtMs) return null;
      return {
        actionKey,
        actorUid,
        recipientUid: post.get("uid") || "",
        track: "conversation",
        points: 1,
        sourcePath: sourceRef.path,
        targetPath: postRef.path,
      };
    });
}

async function reconcileReactionsForReply(postId, replyId, happenedAt) {
  const reactionSnapshot = await db.doc(`posts/${postId}/replies/${replyId}`)
    .collection("reactions").get();
  await Promise.all(reactionSnapshot.docs.map((reaction) =>
    reconcileReplyReaction(postId, replyId, reaction.id, happenedAt)));
}

async function syncPublicHighlight(uid) {
  if (!uid) return;
  const settingsRef = db.doc(`contribution_highlight_settings/${uid}`);
  const progressRef = db.doc(`contribution_progress/${uid}`);
  const publicRef = db.doc(`contribution_public/${uid}`);
  await db.runTransaction(async (transaction) => {
    const [settings, progress] = await Promise.all([
      transaction.get(settingsRef),
      transaction.get(progressRef),
    ]);
    const selectedTrack = settings.get("track") || "";
    if (!TRACK_NAMES.includes(selectedTrack)) {
      transaction.delete(publicRef);
      return;
    }
    const points = progress.exists ? Number(progress.get(`points.${selectedTrack}`)) || 0 : 0;
    const level = progressForPoints(selectedTrack, points).level;
    if (level < 1) {
      transaction.delete(publicRef);
      return;
    }
    transaction.set(publicRef, {
      track: selectedTrack,
      level,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function syncPostLikeMirror(postId, actorUid) {
  if (!postId || !actorUid) return;
  const sourceRef = db.doc(`users/${actorUid}/likedPosts/${postId}`);
  const mirrorRef = db.doc(`contribution_post_likes/${postId}/actors/${awardDocumentId(actorUid)}`);
  await db.runTransaction(async (transaction) => {
    const source = await transaction.get(sourceRef);
    if (!source.exists) {
      transaction.delete(mirrorRef);
      return;
    }
    transaction.set(mirrorRef, {
      actorUid,
      sourcePath: sourceRef.path,
      createdAt: source.get("createdAt") || source.createTime,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function handleContributionEvent(event, postId, happenedAt = eventTime(event)) {
  try {
    await reconcilePost(postId, happenedAt);
  } catch (error) {
    logger.error("contribution_reconciliation_failed", {
      postId,
      errorCode: error?.code || "unknown",
    });
    throw error;
  }
}

async function forumRetired() {
  return (await db.doc("app_config/community_feed").get()).get("forumRetired") === true;
}

exports.contributionPostCreated = onDocumentCreated(
  { document: "posts/{postId}", retry: true },
  async (event) => {
    if (await forumRetired()) return;
    const snapshot = event.data;
    const uid = snapshot?.get("uid") || "";
    const first = await rememberFirstPost(uid, snapshot ? {
      id: snapshot.id,
      createdAt: snapshot.get("createdAt") || snapshot.createTime,
    } : null);
    const happenedAt = snapshot?.createTime?.toMillis?.() || eventTime(event);
    if (first.previousPostId && first.previousPostId !== first.postId) {
      await handleContributionEvent(event, first.previousPostId, happenedAt);
    }
    await handleContributionEvent(event, event.params.postId, happenedAt);
  },
);

exports.contributionPostDeleted = onDocumentDeleted(
  { document: "posts/{postId}", retry: true },
  async (event) => {
    if (!await forumRetired()) await handleContributionEvent(event, event.params.postId);
  },
);

exports.contributionReplyCreated = onDocumentCreated(
  { document: "posts/{postId}/replies/{replyId}", retry: true },
  async (event) => {
    if (await forumRetired()) return;
    const happenedAt = event.data?.createTime?.toMillis?.() || eventTime(event);
    await reconcileReplyAwards(event.params.postId, happenedAt);
    await reconcileReactionsForReply(event.params.postId, event.params.replyId, happenedAt);
  },
);

exports.contributionReplyDeleted = onDocumentDeleted(
  { document: "posts/{postId}/replies/{replyId}", retry: true },
  async (event) => {
    if (await forumRetired()) return;
    const happenedAt = eventTime(event);
    await reconcileReplyAwards(event.params.postId, happenedAt);
    await reconcileReactionsForReply(event.params.postId, event.params.replyId, happenedAt);
  },
);

exports.contributionReplyReactionCreated = onDocumentCreated(
  { document: "posts/{postId}/replies/{replyId}/reactions/{actorUid}", retry: true },
  async (event) => {
    if (!await forumRetired()) await reconcileReplyReaction(
      event.params.postId, event.params.replyId, event.params.actorUid,
      event.data?.createTime?.toMillis?.() || eventTime(event));
  },
);

exports.contributionReplyReactionDeleted = onDocumentDeleted(
  { document: "posts/{postId}/replies/{replyId}/reactions/{actorUid}", retry: true },
  async (event) => {
    if (!await forumRetired()) await reconcileReplyReaction(
      event.params.postId, event.params.replyId, event.params.actorUid, eventTime(event));
  },
);

exports.contributionPostLikeCreated = onDocumentCreated(
  { document: "users/{actorUid}/likedPosts/{postId}", retry: true },
  async (event) => {
    if (await forumRetired()) return;
    await syncPostLikeMirror(event.params.postId, event.params.actorUid);
    await reconcilePostLike(event.params.postId, event.params.actorUid,
      event.data?.createTime?.toMillis?.() || eventTime(event));
  },
);

exports.contributionPostLikeDeleted = onDocumentDeleted(
  { document: "users/{actorUid}/likedPosts/{postId}", retry: true },
  async (event) => {
    if (await forumRetired()) return;
    await syncPostLikeMirror(event.params.postId, event.params.actorUid);
    await reconcilePostLike(event.params.postId, event.params.actorUid, eventTime(event));
  },
);

exports.contributionProgressChanged = onDocumentWritten(
  { document: "contribution_progress/{uid}", retry: true },
  (event) => syncPublicHighlight(event.params.uid),
);

exports.contributionHighlightChanged = onDocumentWritten(
  { document: "contribution_highlight_settings/{uid}", retry: true },
  (event) => syncPublicHighlight(event.params.uid),
);
