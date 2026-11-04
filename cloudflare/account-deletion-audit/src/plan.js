/**
 * Plano de auditoria somente-leitura do pedido de exclusão do Átrio.
 * NENHUMA operação aqui exclui dados. Exigir análise de retenção e de referências
 * antes de implementar a fase destrutiva, em outra revisão.
 */
const UID = /^[A-Za-z0-9_-]{1,128}$/;

export function validUid(uid) {
  return typeof uid === 'string' && UID.test(uid);
}

export const ACCOUNT_DATA_CLASSES = Object.freeze([
  'firebase_auth',
  'private_profile',
  'public_profile',
  'profile_photo_cloudinary',
  'posts_and_nested_replies',
  'reactions_and_references',
  'user_preferences_and_notifications',
  'badges_and_roles',
  'moderation_and_legal_retention'
]);

export function buildAuditPlan(uid, record) {
  if (!validUid(uid)) throw new Error('invalid_uid');
  // Firestore Admin REST representa status como {stringValue: 'requested'}.
  const status = record?.fields?.status?.stringValue;
  if (status !== 'requested') {
    return {ready: false, received: Boolean(record), reason: 'not_requested'};
  }
  return {
    ready: false,
    received: true,
    reason: 'human_review_and_processor_required',
    dataClasses: [...ACCOUNT_DATA_CLASSES],
    // Até existir executor homologado e auditoria de retenção, nunca permitir execução.
    destructiveOperationsEnabled: false
  };
}
