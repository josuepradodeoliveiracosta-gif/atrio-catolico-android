/**
 * Plano determinístico para exclusão de conta do Átrio.
 *
 * NÃO É UM EXECUTOR DE PRODUÇÃO: nenhuma API de escrita, remoção, Cloudinary
 * destroy ou Firebase Auth deleteUser é chamada neste arquivo.
 *
 * Uma exclusão não pode ser declarada concluída só porque a identidade Auth
 * foi eliminada: o Firestore mantém subcoleções depois da remoção do pai.
 */
import {validUid} from './plan.js';

export const OWNED_ROOTS = Object.freeze([
  'profiles', 'public_profiles', 'profile_photos', 'badges',
  'badge_requests', 'admins', 'users', 'guardian_notices'
]);

export const USER_SUBCOLLECTIONS = Object.freeze([
  'likedPosts', 'savedPosts', 'followedPosts', 'pushDevices', 'notifications'
]);

export const GUARDIAN_SUBCOLLECTIONS = Object.freeze(['items']);

/**
 * Dados relacionais são descobertos por consultas de escopo global e não
 * podem ser apagados cegamente só pelo ID. Requer scan em todas as páginas.
 */
export const RELATIONAL_SCOPES = Object.freeze([
  'posts/*', 'posts/*/replies/*', 'posts/*/replies/*/reactions/*',
  'users/*/notifications/*', 'reports/*', 'guardian_cases/*',
  'guardian_audit/*', 'guardiao_quarantine/*'
]);

export const EXTERNAL_SCOPES = Object.freeze([
  'cloudinary_avatar_upload', 'cloudinary_avatar_pending',
  'cloudinary_avatar_authenticated', 'firebase_auth', 'fcm_devices'
]);

export const ACCOUNT_RETENTION_REVIEW = Object.freeze([
  'moderation_and_reporting',
  'references_to_other_members',
  'legal_and_security_obligations'
]);

const LIMIT = 20_000;
const MAX_PATH = 400;

function safePath(value) {
  if (typeof value !== 'string' || value.length > MAX_PATH || value.startsWith('/') ||
      value.endsWith('/') || value.includes('//')) return false;
  const parts = value.split('/');
  return parts.length % 2 === 0 &&
    parts.every(x => /^[A-Za-z0-9_-]{1,160}$/.test(x) && x !== '.' && x !== '..');
}

function safeItem(item) {
  return item && typeof item === 'object' && !Array.isArray(item) &&
    safePath(item.path) && typeof item.kind === 'string' &&
    (item.kind === 'owned' || item.kind === 'relational') &&
    (item.kind === 'owned' ||
      (typeof item.ownerUid === 'string' && validUid(item.ownerUid)));
}

function ownedPaths(uid) {
  const paths=[];
  for(const root of OWNED_ROOTS) paths.push(root+'/'+uid);
  for(const child of USER_SUBCOLLECTIONS) paths.push('users/'+uid+'/'+child+'/*');
  for(const child of GUARDIAN_SUBCOLLECTIONS) paths.push('guardian_notices/'+uid+'/'+child+'/*');
  return paths;
}

/**
 * Uma etapa pode ter N documentos. O motor exige prova de inventário
 * completo por fonte; o default é bloquear se algo não foi auditado.
 * inventory.pagesComplete/scopesComplete must be provided by trusted backend,
 * NOT by client request. legalHoldApproved means a formal retention decision,
 * not permission to ignore data.
 */
export function buildDeletionPlan(uid, requestRecord, inventory, approvals) {
  if (!validUid(uid)) throw Error('invalid_uid');
  const request = requestRecord?.fields?.status?.stringValue;
  const received = request === 'requested';
  const issues=[];
  if (!received) issues.push('missing_verified_request');

  if (!approvals || approvals.identityVerified !== true)
    issues.push('identity_verification_required');
  if (!approvals || approvals.retentionReviewed !== true)
    issues.push('retention_policy_review_required');
  if (!approvals || approvals.operatorApproved !== true)
    issues.push('human_operator_approval_required');

  if (inventory?.uid !== uid) issues.push('inventory_uid_mismatch');
  if (inventory?.pagesComplete !== true) issues.push('incomplete_pagination');
  if (!Array.isArray(inventory?.scopesComplete) ||
      [...RELATIONAL_SCOPES, ...EXTERNAL_SCOPES].some(
        scope => !inventory.scopesComplete.includes(scope)))
    issues.push('unverified_external_or_relational_scope');

  if (!Array.isArray(inventory?.documents) ||
      inventory.documents.length > LIMIT ||
      !inventory.documents.every(safeItem))
    issues.push('invalid_document_inventory');
  if (!Array.isArray(inventory?.externalResources) ||
      inventory.externalResources.length > LIMIT)
    issues.push('unverified_external_resource_inventory');

  const documents=Array.isArray(inventory?.documents) && inventory.documents.length <= LIMIT
    ? inventory.documents : [];
  const ownedPrefixes=ownedPaths(uid);
  const matchesOwned=path => ownedPrefixes.some(prefix =>
    prefix.endsWith('/*')
      ? path.startsWith(prefix.slice(0,-1)) && path.split('/').length === prefix.split('/').length
      : path === prefix);
  const unique=new Set();
  for (const doc of documents) {
    if (!safeItem(doc)) continue;
    if (unique.has(doc.path)) issues.push('duplicate_inventory_entry');
    unique.add(doc.path);
    if (doc.kind === 'owned' && !matchesOwned(doc.path))
      issues.push('owned_path_outside_allowlist');
    if (doc.kind === 'relational' && doc.ownerUid !== uid)
      issues.push('cross_account_record_not_owned');
    if (doc.kind === 'relational' &&
        !RELATIONAL_SCOPES.some(scope => {
          const pattern='^'+scope.split('/').map(part =>
            part==='*'?'[A-Za-z0-9_-]+':part).join('/')+'$';
          return new RegExp(pattern).test(doc.path);
        })) issues.push('relational_path_outside_allowlist');
  }
  for(const resource of Array.isArray(inventory?.externalResources)
    ? inventory.externalResources : []) {
    if (!resource || resource.ownerUid !== uid ||
        !EXTERNAL_SCOPES.includes(resource.scope) ||
        typeof resource.key !== 'string' || resource.key.length > 256 ||
        /[\u0000-\u001f]/.test(resource.key))
      issues.push('external_resource_not_verified');
  }
  if (inventory?.hasUnknownCollections === true) issues.push('unknown_collections_present');
  if (inventory?.hasLegalHold === true && approvals?.retentionDecisionRecorded !== true)
    issues.push('legal_hold_requires_decision');
  if (inventory?.contentReferencesUnresolved === true)
    issues.push('references_to_others_unresolved');
  if (inventory?.mediaStateUncertain === true) issues.push('cloudinary_state_unverified');

  // Explicit phases, never user-supplied commands. The Auth identity is last.
  const phases=Object.freeze([
    {id:'freeze_new_writes', description:'bloquear novas escritas durante o processamento'},
    {id:'remove_user_owned_nested', description:'revisar e limpar subcoleções privadas de usuário'},
    {id:'remove_relational_data', description:'tratar posts, respostas, reações e referências de terceiros'},
    {id:'handle_moderation_retention', description:'aplicar decisão documentada de retenção'},
    {id:'remove_cloudinary_media', description:'eliminar imagens e entradas pendentes verificadas'},
    {id:'remove_owned_documents', description:'eliminar perfis e registros privados após subcoleções'},
    {id:'verify_absence', description:'nova varredura integral; bloquear se restarem dados'},
    {id:'remove_firebase_auth_last', description:'eliminar identidade Auth somente após verificação'},
    {id:'verify_and_finalize', description:'confirmar estado final e preservar comprovante mínimo'}
  ]);
  return {
    safeToExecute:false, // Bloqueio imutável até existir implementação homologada.
    simulatedOnly:true,
    received,
    blockers:[...new Set(issues)].sort(),
    phases,
    summary:{
      ownedDocuments:documents.filter(d=>d?.kind==='owned').length,
      relationalDocuments:documents.filter(d=>d?.kind==='relational').length,
      externalResources:Array.isArray(inventory?.externalResources)
        ? inventory.externalResources.length : 0
    },
    // Nunca retornar os documentos, e-mails, nomes, FCM tokens ou IDs de mídia.
    retentionCategories:[...ACCOUNT_RETENTION_REVIEW]
  };
}

/**
 * Simulador de checkpoint: não possui adaptador de exclusão, nem pode conectar
 * a um ambiente real. Reexecutar uma fase não a marca duas vezes.
 */
export function simulatePhases(plan, checkpoint={}, options={}) {
  if (!plan?.simulatedOnly || plan.safeToExecute !== false ||
      !Array.isArray(plan.phases)) throw Error('not_a_simulation_plan');
  const completed=new Set(Array.isArray(checkpoint.completed)
    ? checkpoint.completed : []);
  const known=new Set(plan.phases.map(s=>s.id));
  if([...completed].some(x=>!known.has(x))) throw Error('unknown_checkpoint_phase');
  if(plan.blockers.length) return {state:'blocked',completed:[...completed],next:null};
  for (const step of plan.phases) {
    if(completed.has(step.id)) continue;
    if(options.failAt === step.id)
      return {state:'retry_required',completed:[...completed],next:step.id};
    completed.add(step.id);
    // O simulador NÃO muda serviços, não exclui usuário, não grava em banco.
    if(options.singleStep === true)
      return {state:'simulating',completed:[...completed],next:
        plan.phases.find(s=>!completed.has(s.id))?.id||null};
  }
  return {state:'simulated_only',completed:[...completed],next:null};
}
