"use strict";

const crypto = require("node:crypto");

const TYPES = new Set(["reply", "review", "admin"]);
const DECISIONS = new Set(["approved", "rejected"]);
const CLERGY = new Set(["padre", "diacono"]);

function validUid(uid) {
  return typeof uid === "string" && uid.length > 0 && uid.length <= 128 && !uid.includes("/");
}
function millis(value) {
  if (!value || typeof value.toMillis !== "function") return 0;
  const n = value.toMillis();
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}
function replyRecipient(data, uid, noticeId) {
  if (!validUid(uid) || !data || data.read !== false) return null;
  if (typeof data.postId !== "string" || !data.postId || data.postId.includes("/")) return null;
  if (data.replyId !== noticeId || !validUid(data.actorUid) || data.actorUid === uid) return null;
  if (!millis(data.createdAt)) return null;
  return uid;
}
function badgeEvents(before, after, uid) {
  if (!validUid(uid) || !after || !CLERGY.has(after.kind) || !millis(after.createdAt)) return [];
  const previous = before?.status;
  const result = [];
  if (after.status === "pending" && previous !== "pending") {
    result.push({kind:"admin", excludeUid:uid, recipient:null});
  }
  if (previous === "pending" && DECISIONS.has(after.status)
    && millis(after.reviewedAt) && validUid(after.reviewedBy)) {
    result.push({kind:"review",recipient:uid});
  }
  return result;
}
function reportAllowed(data) {
  return Boolean(data && (!data.status || data.status === "pending")
    && validUid(data.reporterUid) && millis(data.createdAt)
    && typeof data.postId === "string" && !!data.postId && !data.postId.includes("/"));
}
function activeAdmins(adminDocs, excludeUid, max=30) {
  if (!Array.isArray(adminDocs) || adminDocs.length > max) return [];
  return adminDocs.filter(d => d?.enabled === true && validUid(d.uid)
    && d.uid !== excludeUid).map(d => d.uid);
}
function recentTokens(documents, now=Date.now(), max=5) {
  const seen = new Set();
  for (const doc of documents.slice(0,max)) {
    const token = doc?.token;
    const at = millis(doc?.updatedAt);
    if (typeof token === "string" && token.length >= 20 && token.length <= 4096
      && at > now - 60 * 86400000 && at <= now + 60000) seen.add(token);
  }
  return [...seen];
}
function dispatchId(eventId, uid) {
  if (!validUid(uid) || typeof eventId !== "string" || !eventId || eventId.length > 512) {
    throw Error("Parâmetro inválido para idempotência");
  }
  return crypto.createHash("sha256").update(eventId + "\n" + uid).digest("hex");
}
function safeKind(kind) { return TYPES.has(kind); }

module.exports = {validUid,millis,replyRecipient,badgeEvents,reportAllowed,activeAdmins,
  recentTokens,dispatchId,safeKind};
