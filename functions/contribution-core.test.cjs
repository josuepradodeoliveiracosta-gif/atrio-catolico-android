"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveAwards,
  deriveFeedAwards,
  ledgerPointDelta,
  levelForPoints,
  progressForPoints,
} = require("./contribution-core.cjs");

const path = (...parts) => parts.join("/");
const createdAtMs = 2_000;

test("tracks keep independent thresholds and progress within the current level", () => {
  assert.equal(levelForPoints("conversation", 14), 0);
  assert.equal(levelForPoints("conversation", 15), 1);
  assert.equal(levelForPoints("helpful", 450), 5);
  assert.equal(levelForPoints("welcome", 10), 1);
  assert.equal(levelForPoints("welcome", 200), 5);
  assert.deepEqual(progressForPoints("conversation", 26), {
    level: 1,
    currentThreshold: 15,
    nextThreshold: 45,
    fraction: 11 / 30,
    pointsRemaining: 19,
  });
  assert.equal(progressForPoints("welcome", 240).fraction, 1);
  assert.equal(progressForPoints("welcome", 240).nextThreshold, null);
});

test("discussion reactions and first replies award the conversation track once", () => {
  const replies = [
    { id: "a", uid: "r1", createdAtMs, sourcePath: path("posts", "p", "replies", "a") },
    { id: "b", uid: "r1", createdAtMs: createdAtMs + 1, sourcePath: path("posts", "p", "replies", "b") },
    { id: "c", uid: "r2", createdAtMs: createdAtMs + 2, sourcePath: path("posts", "p", "replies", "c") },
  ];
  const postLikes = ["l1", "l2", "l3", "l4"].map((actorUid, index) => ({
    actorUid,
    createdAtMs: createdAtMs + index,
    sourcePath: path("users", actorUid, "likedPosts", "p"),
  }));
  postLikes.push({
    actorUid: "owner",
    createdAtMs: createdAtMs + 10,
    sourcePath: path("users", "owner", "likedPosts", "p"),
  });

  const awards = deriveAwards({
    postId: "p",
    postOwnerUid: "owner",
    replies,
    postLikes,
    rolloutAtMs: 1_000,
  });
  const conversation = [...awards.values()].filter((award) => award.track === "conversation");
  assert.equal(conversation.filter((award) => award.points === 3).length, 2);
  assert.equal(conversation.filter((award) => award.points === 1).length, 4);
  assert.equal(conversation.reduce((total, award) => total + award.points, 0), 10);
  assert.ok(!conversation.some((award) => award.actorUid === "owner"));
});

test("a direct newcomer reply can score in both applicable tracks", () => {
  const replies = [
    { id: "welcome", uid: "host", createdAtMs, sourcePath: "posts/newcomer-post/replies/welcome" },
    {
      id: "return", uid: "newcomer", replyToId: "welcome", replyToUid: "host",
      createdAtMs: createdAtMs + 1, sourcePath: "posts/newcomer-post/replies/return",
    },
  ];
  const awards = deriveAwards({
    postId: "newcomer-post",
    postOwnerUid: "newcomer",
    firstPostIdByUid: new Map([["newcomer", "newcomer-post"]]),
    replies,
    rolloutAtMs: 1_000,
  });
  assert.equal(awards.get("welcome:newcomer:host").points, 2);
  assert.equal(awards.get("welcome-return:newcomer:host").points, 3);
  assert.equal(awards.get("helpful:newcomer-post:welcome:newcomer").points, 2);
  assert.equal(awards.get("conversation:newcomer-post:host").points, 3);
  assert.equal(awards.has("conversation:newcomer-post:newcomer"), false);
});

test("self-reactions, repeated direct replies, and pre-rollout actions earn no extra credit", () => {
  const replies = [
    { id: "root", uid: "owner", createdAtMs, sourcePath: "posts/p/replies/root" },
    { id: "old", uid: "member", createdAtMs: 400, sourcePath: "posts/p/replies/old" },
    { id: "first", uid: "member", replyToId: "root", replyToUid: "owner",
      createdAtMs: 1_500, sourcePath: "posts/p/replies/first" },
    { id: "second", uid: "member", replyToId: "root", replyToUid: "owner",
      createdAtMs: 1_600, sourcePath: "posts/p/replies/second" },
  ];
  const awards = deriveAwards({
    postId: "p",
    postOwnerUid: "owner",
    replies,
    replyReactions: [
      { replyId: "root", actorUid: "owner", createdAtMs: 1_700, sourcePath: "posts/p/replies/root/reactions/owner" },
      { replyId: "root", actorUid: "member", createdAtMs: 1_700, sourcePath: "posts/p/replies/root/reactions/member" },
    ],
    rolloutAtMs: 1_000,
  });
  assert.equal(awards.has("conversation:p:member"), false);
  assert.equal(awards.has("helpful:p:root:member"), true);
  assert.equal(awards.get("helpful:p:root:member").sourcePath, "posts/p/replies/first");
  assert.equal(awards.has("reply-reaction:p:root:owner"), false);
  assert.equal(awards.has("reply-reaction:p:root:member"), true);
});

test("ledger transitions are idempotent and reverse only active points", () => {
  assert.equal(ledgerPointDelta(null, { points: 3 }), 3);
  assert.equal(ledgerPointDelta({ active: true, points: 3 }, { points: 3 }), 0);
  assert.equal(ledgerPointDelta({ active: true, points: 3 }, null), -3);
  assert.equal(ledgerPointDelta({ active: false, points: 3 }, null), 0);
});

const feedComment = (id, authorUid, parentId = "", createdAtMs = 2_000) =>
  ({id, authorUid, parentId, createdAtMs});

test("feed credits direct interactions once without touching legacy ledger keys", () => {
  const comments = [
    feedComment("welcome", "host"),
    feedComment("again", "host", "", 2_001),
    feedComment("self", "newcomer"),
    feedComment("return", "newcomer", "welcome", 2_002),
    feedComment("return2", "newcomer", "welcome", 2_003),
    feedComment("nested", "visitor", "welcome", 2_004),
  ];
  for (const destination of ["timeline", "channel"]) {
    const awards = deriveFeedAwards({
      postId: "first",
      post: {authorUid: "newcomer", destination, published: true},
      firstFeedPublicationId: "first",
      comments,
    });
    assert.deepEqual([...awards].map(([id, {points}]) => [id, points]), [
      ["feed:conversation:first:host", 3],
      ["feed:helpful:first:welcome:newcomer", 2],
      ["feed:helpful:first:welcome:visitor", 2],
      ["feed:welcome:newcomer:host", 2],
      ["feed:welcome-return:newcomer:host", 3],
    ]);
    const welcomeReturn = awards.get("feed:welcome-return:newcomer:host");
    assert.equal(welcomeReturn.scopePostId, "feed:first");
    assert.equal(welcomeReturn.targetPath, "feed_posts/first/comments/welcome");
    assert.equal(welcomeReturn.sourcePath, "feed_posts/first/comments/return");
  }
});

test("feed excludes tombstones, orphaned replies and inherited forum newcomers", () => {
  const post = {authorUid: "owner", destination: "channel", published: true};
  const root = feedComment("root", "host");
  const reply = feedComment("reply", "owner", "root");
  const derive = (options) => deriveFeedAwards({postId: "p", post, ...options});

  assert.equal(derive({comments: [root, reply]}).has("feed:welcome:owner:host"), false);
  assert.equal(derive({comments: [{...root, removed: true}, reply]}).size, 0);
  assert.equal(derive({post: {...post, published: false}, comments: [root, reply]}).size, 0);
  assert.equal(derive({firstFeedPublicationId: "p", rolloutAtMs: 2_001, comments: [root, reply]}).size, 0);
});
