/**
 * Descoberta SOMENTE-LEITURA de referências relacionadas a um titular.
 * Recebe um adaptador do servidor de QA: queryPage(spec, uid, cursor, limit).
 * O adaptador NUNCA vem do cliente Android/navegador.
 *
 * Este módulo não faz exclusões, não é rota pública e deliberadamente NÃO
 * declara a varredura global completa: reações pelo ID, menções dinâmicas,
 * subcoleções órfãs e mídia exigem inspeção independente.
 */
import {validUid} from './plan.js';

const UID=/^[A-Za-z0-9_-]{1,128}$/;
const SEGMENT=/^[A-Za-z0-9_-]{1,160}$/;
const PAGE_SIZE=100;
const MAX_PAGES_PER_QUERY=100;
const MAX_CANDIDATES=15000;
const CURSOR=/^[A-Za-z0-9_+\/=().-]{1,2048}$/;

const SCOPES=Object.freeze([
  {id:'owned_posts',collectionGroup:'posts',field:'uid',path:'posts/*',review:'author_content'},
  {id:'owned_replies',collectionGroup:'replies',field:'uid',path:'posts/*/replies/*',review:'author_content'},
  {id:'notifications_actor',collectionGroup:'notifications',field:'actorUid',
    path:'users/*/notifications/*',review:'cross_account_reference'},
  {id:'notifications_mention',collectionGroup:'notifications',field:'mentionUid',
    path:'users/*/notifications/*',review:'cross_account_reference'},
  {id:'notifications_reply_to',collectionGroup:'notifications',field:'replyToUid',
    path:'users/*/notifications/*',review:'cross_account_reference'},
  {id:'reports_reporter',collectionGroup:'reports',field:'reporterUid',
    path:'reports/*',review:'moderation_retention'},
  {id:'guardian_cases_owner',collectionGroup:'guardian_cases',field:'ownerUid',
    path:'guardian_cases/*',review:'moderation_retention'},
  {id:'guardian_cases_reviewer',collectionGroup:'guardian_cases',field:'reviewedBy',
    path:'guardian_cases/*',review:'moderation_retention'},
  {id:'guardian_audit_actor',collectionGroup:'guardian_audit',field:'actor',
    path:'guardian_audit/*',review:'moderation_retention'},
  {id:'quarantine_owner',collectionGroup:'guardiao_quarantine',field:'ownerUid',
    path:'guardiao_quarantine/*',review:'moderation_retention'}
]);
export const RELATIONAL_QUERY_SPECS=SCOPES;

function matchesMask(path,mask) {
  if(typeof path!=='string' || path.length>400) return false;
  const actual=path.split('/'),expected=mask.split('/');
  if(actual.length!==expected.length || actual.length%2!==0) return false;
  return actual.every((part,index)=>SEGMENT.test(part) &&
    (expected[index]==='*' || expected[index]===part));
}
function goodCandidate(item,spec,uid) {
  if(!item || typeof item!=='object' || Array.isArray(item) ||
    !matchesMask(item.path,spec.path) ||
    !item.fields || typeof item.fields!=='object' ||
    Array.isArray(item.fields) ||
    item.fields[spec.field]!==uid) return false;
  // Apenas a projeção mínima de campos de identidade, nunca nome, texto,
  // razão da denúncia, imagem, e-mail ou token pode vir do adaptador.
  return Object.keys(item.fields).length===1;
}

/**
 * O caminho completo permanece no contexto administrativo; não exibir esse
 * resultado na UI. Use summarizeRelationalCandidates para contadores neutros.
 */
export async function discoverRelationalCandidates(uid,adapter) {
  if(!validUid(uid) || !UID.test(uid)) throw Error('invalid_uid');
  if(typeof adapter?.queryPage!=='function') throw Error('missing_query_adapter');
  const byPath=new Map();
  let total=0;
  for(const spec of SCOPES) {
    let cursor=null;
    const cursors=new Set();
    const pathsFromQuery=new Set();
    let finished=false;
    for(let page=0;page<MAX_PAGES_PER_QUERY;page++) {
      const result=await adapter.queryPage(Object.freeze({...spec}),uid,cursor,PAGE_SIZE);
      if(!result || !Array.isArray(result.items) ||
        result.items.length>PAGE_SIZE) throw Error('invalid_query_page');
      for(const item of result.items) {
        if(!goodCandidate(item,spec,uid)) throw Error('unexpected_relational_candidate');
        if(pathsFromQuery.has(item.path)) throw Error('duplicate_candidate_in_query');
        pathsFromQuery.add(item.path);
        total++;
        if(total>MAX_CANDIDATES) throw Error('too_many_candidates');
        const existing=byPath.get(item.path);
        if(existing) {
          existing.reasons.add(spec.id);
          existing.review.add(spec.review);
        } else {
          byPath.set(item.path,{
            path:item.path,reasons:new Set([spec.id]),review:new Set([spec.review])
          });
        }
      }
      const next=result.nextPageToken;
      if(next===null || next===undefined || next==='') {
        finished=true;break;
      }
      if(typeof next!=='string' || !CURSOR.test(next) ||
        cursors.has(next)) throw Error('invalid_query_cursor');
      cursors.add(next);
      cursor=next;
    }
    if(!finished) throw Error('query_pagination_incomplete');
  }
  const findings=[...byPath.values()].map(item=>({
    path:item.path,matchedQueries:[...item.reasons].sort(),
    requiresReview:[...item.review].sort(),
    // Um match de UID não autoriza excluir conteúdo público nem referências.
    automaticallyDeletable:false
  })).sort((a,b)=>a.path.localeCompare(b.path,'en'));
  return {
    uid,findings,
    queriedScopes:SCOPES.map(x=>x.id),
    queryPagesScanned:true,
    globalCoverageComplete:false,
    unverifiedScopes:[
      'reactions_by_document_id',
      'orphaned_nested_collections',
      'mentions_and_references_without_indexed_uid',
      'cloudinary_d1_media',
      'firebase_auth',
      'unknown_future_collections'
    ],
    safeToExecute:false
  };
}

/** Resposta pública não pode enumerar IDs de discussões, UID ou conteúdo. */
export function summarizeRelationalCandidates(result) {
  if(!result || !Array.isArray(result.findings) ||
    result.safeToExecute!==false || result.globalCoverageComplete!==false)
    throw Error('invalid_inventory_result');
  const counts={author_content:0,cross_account_reference:0,moderation_retention:0};
  for(const finding of result.findings) {
    if(finding?.automaticallyDeletable!==false ||
      !Array.isArray(finding.requiresReview) ||
      finding.requiresReview.some(x=>!(x in counts)))
      throw Error('invalid_inventory_result');
    for(const review of new Set(finding.requiresReview)) counts[review]++;
  }
  return {status:'review_required',safeToExecute:false,
    groups:counts,remainingScopes:result.unverifiedScopes.length};
}
