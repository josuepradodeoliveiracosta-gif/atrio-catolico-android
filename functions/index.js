"use strict";

/**
 * Cloud Functions v2 do Átrio. Não executar no celular nem colocar credenciais
 * de conta de serviço no repositório: a plataforma fornece identidade gerenciada.
 *
 * Envio data-only para o app 0.17+ (uid/kind), sem conteúdo sensível.
 * A execução exige habilitação explícita do Blaze pelo proprietário.
 */
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");
const {onDocumentCreated, onDocumentWritten} = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const {
  replyRecipient, badgeEvents, reportAllowed, activeAdmins,
  recentTokens, dispatchId, safeKind, validUid, millis,
} = require("./events");

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

const OPTIONS = Object.freeze({
  region: "southamerica-east1",
  memory: "256MiB",
  cpu: "gcf_gen1",
  minInstances: 0,
  maxInstances: 2,
  concurrency: 1,
  timeoutSeconds: 60,
  retry: false,
});

async function recipients(exceptUid) {
  const snapshot = await db.collection("admins")
    .where("enabled", "==", true).limit(31).get();
  if (snapshot.size > 30) {
    logger.error("Limite de administradores excedido; envio administrativo suprimido");
    return [];
  }
  return activeAdmins(snapshot.docs.map(doc => ({
    uid:doc.id, enabled:doc.get("enabled"),
  })), exceptUid);
}

async function sendForEvent(eventId, uid, kind) {
  if (!validUid(uid) || !safeKind(kind)) return;
  if (kind === "admin") {
    const admin = await db.collection("admins").doc(uid).get();
    if (!admin.exists || admin.get("enabled") !== true) return;
  }
  const devices = await db.collection("users").doc(uid).collection("pushDevices")
    .orderBy("updatedAt", "desc").limit(5).get();
  const tokens = recentTokens(devices.docs.map(doc=>doc.data()));
  if (!tokens.length) return;

  // Única tentativa por evento + destinatário para limitar duplicação
  // quando um evento do Firestore é redespachado pela infraestrutura.
  const marker = db.collection("pushDispatch").doc(dispatchId(eventId, uid));
  try {
    await marker.create({
      kind, recipient:uid, state:"sending",
      createdAt:FieldValue.serverTimestamp(),
    });
  } catch (error) {
    if (error.code === 6 || error.code === "already-exists") return;
    throw error;
  }

  try {
    const outcome = await messaging.sendEachForMulticast({
      tokens,
      data:{uid,kind},
      android:{priority:"high",ttl:3600000},
    });
    await marker.update({
      state:outcome.successCount ? "sent" : "failed",
      sentCount:outcome.successCount,
      failedCount:outcome.failureCount,
      updatedAt:FieldValue.serverTimestamp(),
    });
    // O Firebase Admin não publica nomes, tokens ou conteúdo nos logs.
    logger.info("Aviso processado", {kind,sent:outcome.successCount,failed:outcome.failureCount});
  } catch (_error) {
    await marker.update({state:"failed",updatedAt:FieldValue.serverTimestamp()});
    logger.error("Falha no envio FCM; dados do destinatário omitidos");
  }
}

exports.onReplyNoticeCreated = onDocumentCreated({
  ...OPTIONS, document:"users/{uid}/notifications/{noticeId}",
},async event=>{
  const uid = event.params.uid;
  const noticeId = event.params.noticeId;
  const data = event.data?.data();
  if (!replyRecipient(data,uid,noticeId)) return;
  // Verificar que a resposta continua existente e pertence ao remetente;
  // nunca escolher o destinatário a partir de campos escritos pelo cliente.
  const postRef = db.collection("posts").doc(data.postId);
  const replyRef = postRef.collection("replies").doc(noticeId);
  const noticeRef = db.collection("users").doc(uid).collection("notifications").doc(noticeId);
  const [post,reply,notice] = await Promise.all([
    postRef.get(), replyRef.get(), noticeRef.get(),
  ]);
  if (!post.exists || post.get("uid")!==uid || !reply.exists
      || reply.get("uid")!==data.actorUid || !notice.exists
      || notice.get("read")!==false) return;
  if (!millis(reply.get("createdAt"))
    || millis(reply.get("createdAt"))!==millis(data.createdAt)) return;
  await sendForEvent(event.id,uid,"reply");
});

exports.onBadgeRequestChanged = onDocumentWritten({
  ...OPTIONS, document:"badge_requests/{uid}",
},async event=>{
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  const actions = badgeEvents(before,after,event.params.uid);
  if (!actions.length) return;
  const ref = db.collection("badge_requests").doc(event.params.uid);
  const current = await ref.get();
  if (!current.exists || current.get("status")!==after.status ||
    millis(current.get(after.status==="pending" ? "createdAt" : "reviewedAt")) !==
    millis(after[after.status==="pending" ? "createdAt" : "reviewedAt"])) return;
  for (const action of actions) {
    if (action.kind==="review") {
      await sendForEvent(event.id,event.params.uid,"review");
    } else {
      const admins = await recipients(event.params.uid);
      await Promise.all(admins.map(adminUid =>sendForEvent(event.id,adminUid,"admin")));
    }
  }
});

exports.onReportCreated = onDocumentCreated({
  ...OPTIONS, document:"reports/{reportId}",
},async event=>{
  const data = event.data?.data();
  if (!reportAllowed(data)) return;
  const current = await db.collection("reports").doc(event.params.reportId).get();
  if (!current.exists || !reportAllowed(current.data())) return;
  const admins = await recipients(data.reporterUid);
  await Promise.all(admins.map(uid=>sendForEvent(event.id,uid,"admin")));
});
