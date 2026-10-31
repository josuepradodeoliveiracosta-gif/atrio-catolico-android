/**
 * Átrio Católico — plano conservador de exclusão de dados.
 *
 * SOMENTE PLANEJAMENTO. Não importa SDK Admin, não lê produção, não emite
 * DELETE, não altera status no Firestore. Antes de implementar o processador:
 * revisar retenções, subcoleções dinâmicas, mídia e conteúdo de terceiros.
 */
import {validUid} from './plan.js';

const PRIVATE_COLLECTIONS = Object.freeze(new Set([
  'profiles', 'public_profiles', 'profile_photos', 'badges', 'badge_requests',
  'users', 'guardian_notices'
]));
const AUDIT_COLLECTION = 'account_deletion_requests';

/** Igualdade por segmento: não confundir UID "abc" com "abcd". */
export function ownedPrivatePath(uid, path) {
  if (!validUid(uid) || typeof path !== 'string' || path.length > 1024) return false;
  const pieces = path.split('/');
  return pieces.length >= 2 && pieces.every(Boolean) &&
    PRIVATE_COLLECTIONS.has(pieces[0]) && pieces[1] === uid;
}

export function reviewReason(path) {
  if (typeof path !== 'string') return 'invalid_path';
  if (path.startsWith('posts/')) return 'shared_posts_and_nested_replies';
  if (path.startsWith('reports/') || path.startsWith('guardian_cases/') ||
      path.startsWith('guardian_audit/') ||
      path.startsWith('guardiao_quarantine/') ||
      path.startsWith('admins/')) return 'moderation_legal_retention';
  if (path.startsWith(AUDIT_COLLECTION + '/')) return 'request_audit_retention';
  return 'unknown_or_cross_account_record';
}

const onlyUnique = values => [...new Set(values)].sort();

/**
 * snapshot é um INVENTÁRIO FICTÍCIO, não uma leitura exaustiva do Firebase.
 * A propriedade completeInventory não é aceita de entrada: o executor real terá
 * de provar por busca paginada que todos os vínculos foram inventariados.
 */
export function makeDeletionPlan(uid, request, snapshot) {
  if (!validUid(uid)) throw Error('invalid_uid');
  if (request?.fields?.status?.stringValue !== 'requested')
    throw Error('missing_verified_request');
  if (!snapshot || !Array.isArray(snapshot.documents) ||
      !Array.isArray(snapshot.media) || !Array.isArray(snapshot.pushTokens))
    throw Error('invalid_inventory');
  const privatePaths = [];
  const manual = [];
  for (const row of snapshot.documents) {
    if (!row || typeof row.path !== 'string' || !row.path ||
        row.path.startsWith('/') || row.path.endsWith('/') ||
        row.path.split('/').some(segment => !segment || segment === '..')) {
      throw Error('invalid_document_path');
    }
    if (ownedPrivatePath(uid,row.path)) {
      if (row.ownerUid != null && row.ownerUid !== uid)
        throw Error('private_document_owner_conflict');
      privatePaths.push(row.path);
    } else if (row.ownerUid === uid ||
               row.path === AUDIT_COLLECTION + '/' + uid) {
      manual.push(reviewReason(row.path));
    }
  }
  const media = snapshot.media.filter(x => x?.ownerUid === uid)
    .map(x => {
      if (typeof x.publicId !== 'string' ||
          !/^atrio-avatares\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]{1,150}$/.test(x.publicId) ||
          !x.publicId.startsWith('atrio-avatares/' + uid + '/')) {
        throw Error('untrusted_media_ownership');
      }
      return x.publicId;
    });
  const tokens = snapshot.pushTokens.filter(x => x?.ownerUid === uid)
    .map(x => {
      if (typeof x.tokenId !== 'string' ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(x.tokenId)) throw Error('invalid_token_id');
      return x.tokenId;
    });
  return Object.freeze({
    uid,
    privatePaths: Object.freeze(onlyUnique(privatePaths)),
    mediaIds: Object.freeze(onlyUnique(media)),
    pushTokenIds: Object.freeze(onlyUnique(tokens)),
    requiresManualReview: Object.freeze(onlyUnique([
      ...manual,
      'cross_account_references_not_exhaustively_queried',
      'firestore_recursive_subcollections_must_be_enumerated',
      'retention_and_identity_verification_required'
    ])),
    completeInventory: false,
    approvedForProduction: false,
    authDeletionAuthorized: false
  });
}
