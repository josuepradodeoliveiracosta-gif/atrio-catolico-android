"use strict";

const TRACKS = Object.freeze({
  conversation: Object.freeze([15, 45, 100, 220, 450]),
  helpful: Object.freeze([15, 45, 100, 220, 450]),
  welcome: Object.freeze([10, 30, 65, 120, 200]),
});

function levelForPoints(track, points) {
  const thresholds = TRACKS[track];
  if (!thresholds) throw new Error("unknown_contribution_track");
  const total = Math.max(0, Math.floor(Number(points) || 0));
  return thresholds.filter((threshold) => total >= threshold).length;
}

function progressForPoints(track, points) {
  const thresholds = TRACKS[track];
  if (!thresholds) throw new Error("unknown_contribution_track");
  const total = Math.max(0, Math.floor(Number(points) || 0));
  const level = levelForPoints(track, total);
  const currentThreshold = level === 0 ? 0 : thresholds[level - 1];
  const nextThreshold = thresholds[level] ?? null;
  return {
    level,
    currentThreshold,
    nextThreshold,
    fraction: nextThreshold === null
      ? 1
      : Math.max(0, Math.min(1,
        (total - currentThreshold) / (nextThreshold - currentThreshold))),
    pointsRemaining: nextThreshold === null ? 0 : Math.max(0, nextThreshold - total),
  };
}

function millis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function oldestFirst(items) {
  return [...items].sort((left, right) =>
    millis(left.createdAtMs ?? left.createdAt) -
      millis(right.createdAtMs ?? right.createdAt) ||
    String(left.id ?? "").localeCompare(String(right.id ?? "")));
}

function deriveAwards({
  postId,
  postOwnerUid,
  firstPostIdByUid = new Map(),
  replies = [],
  replyReactions = [],
  postLikes = [],
  rolloutAtMs = 0,
}) {
  const awards = new Map();
  const replyById = new Map(replies.map((reply) => [reply.id, reply]));
  const orderedReplies = oldestFirst(replies);
  const eligible = (interaction) =>
    millis(interaction.createdAtMs ?? interaction.createdAt) >= rolloutAtMs;
  const add = (actionKey, actorUid, recipientUid, track, points, sourcePath, targetPath,
    allowActorCredit = false) => {
    if (!actorUid || !recipientUid || (!allowActorCredit && actorUid === recipientUid)) return;
    awards.set(actionKey, {
      actionKey,
      actorUid,
      recipientUid,
      track,
      points,
      sourcePath,
      targetPath,
      scopePostId: postId,
    });
  };

  // One first reply by each member to a discussion credits its author.
  const firstReplyByMember = new Map();
  for (const reply of orderedReplies) {
    if (reply.uid && !firstReplyByMember.has(reply.uid)) firstReplyByMember.set(reply.uid, reply);
  }
  for (const [actorUid, reply] of firstReplyByMember) {
    const actionKey = `conversation:${postId}:${actorUid}`;
    if (eligible(reply)) add(actionKey, actorUid, postOwnerUid, "conversation", 3,
      reply.sourcePath, `posts/${postId}`);
  }

  // One first direct reply from each member to a reply credits that reply's author.
  const firstDirectReply = new Map();
  for (const reply of orderedReplies) {
    const targetId = reply.replyToId;
    const target = targetId ? replyById.get(targetId) : null;
    if (!target || !reply.uid || target.uid !== reply.replyToUid || reply.uid === target.uid) continue;
    const actionKey = `helpful:${postId}:${targetId}:${reply.uid}`;
    if (!firstDirectReply.has(actionKey)) firstDirectReply.set(actionKey, { reply, target });
  }
  for (const [actionKey, { reply, target }] of firstDirectReply) {
    if (eligible(reply)) add(actionKey, reply.uid, target.uid, "helpful", 2,
      reply.sourcePath, `posts/${postId}/replies/${target.id}`);
  }

  const firstPostId = firstPostIdByUid.get(postOwnerUid) ?? "";
  if (firstPostId === postId) {
    // The host earns two points for their first top-level welcome to this newcomer.
    const firstWelcomeByHost = new Map();
    for (const reply of orderedReplies) {
      if (!reply.uid || reply.uid === postOwnerUid || reply.replyToId) continue;
      if (!firstWelcomeByHost.has(reply.uid)) firstWelcomeByHost.set(reply.uid, reply);
    }
    for (const [hostUid, reply] of firstWelcomeByHost) {
      const actionKey = `welcome:${postOwnerUid}:${hostUid}`;
      if (eligible(reply)) add(actionKey, hostUid, hostUid, "welcome", 2,
        reply.sourcePath, `posts/${postId}`, true);
    }

    // A direct reply from the newcomer to a host's top-level reply earns three points
    // for that host. This intentionally overlaps with the helpful-reply track.
    const firstReturnByHost = new Map();
    for (const reply of orderedReplies) {
      if (reply.uid !== postOwnerUid || !reply.replyToId) continue;
      const target = replyById.get(reply.replyToId);
      if (!target || target.replyToId || target.uid !== reply.replyToUid ||
          target.uid === postOwnerUid) continue;
      if (!firstReturnByHost.has(target.uid)) firstReturnByHost.set(target.uid, { reply, target });
    }
    for (const [hostUid, { reply, target }] of firstReturnByHost) {
      const actionKey = `welcome-return:${postOwnerUid}:${hostUid}`;
      if (eligible(reply)) add(actionKey, postOwnerUid, hostUid, "welcome", 3,
        reply.sourcePath, `posts/${postId}/replies/${target.id}`);
    }
  }

  for (const reaction of replyReactions) {
    const target = replyById.get(reaction.replyId);
    if (!target || !reaction.actorUid || reaction.actorUid === target.uid || !eligible(reaction)) continue;
    const actionKey = `reply-reaction:${postId}:${reaction.replyId}:${reaction.actorUid}`;
    awards.set(actionKey, {
      actionKey,
      actorUid: reaction.actorUid,
      recipientUid: target.uid,
      track: "helpful",
      points: 1,
      sourcePath: reaction.sourcePath,
      targetPath: `posts/${postId}/replies/${target.id}`,
      scopePostId: postId,
    });
  }

  for (const like of postLikes) {
    if (!like.actorUid || like.actorUid === postOwnerUid || !eligible(like)) continue;
    const actionKey = `post-reaction:${postId}:${like.actorUid}`;
    awards.set(actionKey, {
      actionKey,
      actorUid: like.actorUid,
      recipientUid: postOwnerUid,
      track: "conversation",
      points: 1,
      sourcePath: like.sourcePath,
      targetPath: `posts/${postId}`,
      scopePostId: postId,
    });
  }

  return awards;
}

function ledgerPointDelta(existing, desired) {
  const previous = existing?.active === true ? Math.max(0, Number(existing.points) || 0) : 0;
  const next = desired ? Math.max(0, Number(desired.points) || 0) : 0;
  return next - previous;
}

module.exports = {
  TRACKS,
  levelForPoints,
  progressForPoints,
  deriveAwards,
  ledgerPointDelta,
  millis,
  oldestFirst,
};
