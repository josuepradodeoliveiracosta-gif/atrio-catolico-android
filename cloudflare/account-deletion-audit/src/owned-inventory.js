/**
 * Inventário de caminhos exclusivos de uma conta, com paginação estrita.
 * Não lê o conteúdo dos documentos e não escreve nem apaga dados.
 *
 * Adapter é exclusivo do backend autorizado, com getDocument(path)
 * e listPage(collectionPath, cursor, pageSize) => {paths,nextPageToken}.
 * A coleta direta NUNCA afirma que todos os dados do usuário foram localizados.
 */
import {validUid} from './plan.js';
import {
  OWNED_ROOTS,USER_SUBCOLLECTIONS,GUARDIAN_SUBCOLLECTIONS
} from './deletion-orchestrator.js';

const PAGE_SIZE=100;
const MAX_PAGES=200;
const MAX_DOCUMENTS=20_000;
const MAX_DOCUMENT_SEGMENTS=12;
const TOKEN_PATTERN=/^[A-Za-z0-9_+\/=.-]{1,2048}$/;
const PART=/^[A-Za-z0-9_-]{1,160}$/;

const COLLECTION_ID=/^[A-Za-z0-9_-]{1,160}$/;
const EXPECTED_CHILDREN=Object.freeze({
  users:USER_SUBCOLLECTIONS,
  guardian_notices:GUARDIAN_SUBCOLLECTIONS
});

/**
 * Firestore deixa subcoleções órfãs quando seu documento pai é apagado.
 * Descobrir todos os IDs sob cada raiz própria evita confundir uma lista
 * estática de nomes esperados com inventário exaustivo.
 *
 * A descoberta é somente leitura e não habilita executar exclusões:
 * pagesComplete permanece false no inventário principal.
 */
export async function discoverOwnedSubcollectionIds(uid,adapter) {
  if(!validUid(uid))throw Error('invalid_uid');
  if(typeof adapter?.listChildCollections!=='function')
    throw Error('missing_read_only_discovery');
  const unexpected=[];
  const discovered={};
  let total=0;
  for(const root of OWNED_ROOTS) {
    const parent=root+'/'+uid;
    const found=[];
    const ids=new Set(),cursors=new Set();
    let cursor=null,done=false;
    for(let page=0;page<MAX_PAGES;page++) {
      const result=await adapter.listChildCollections(parent,cursor,PAGE_SIZE);
      if(!result || typeof result!=='object' || Array.isArray(result) ||
          !Object.hasOwn(result,'collectionIds') ||
          !Object.hasOwn(result,'nextPageToken') ||
          Object.keys(result).some(k=>k!=='collectionIds' && k!=='nextPageToken') ||
          !Array.isArray(result.collectionIds) ||
          result.collectionIds.length>PAGE_SIZE)
        throw Error('invalid_subcollection_page');
      for(const id of result.collectionIds) {
        if(typeof id!=='string' || !COLLECTION_ID.test(id) || ids.has(id))
          throw Error('invalid_or_duplicate_subcollection_id');
        ids.add(id);found.push(id);
        if(++total>MAX_DOCUMENTS)throw Error('subcollection_inventory_too_large');
        if(!(EXPECTED_CHILDREN[root]||[]).includes(id))
          unexpected.push(parent+'/'+id);
      }
      const token=result.nextPageToken;
      if(token===null){done=true;break;}
      if(typeof token!=='string' || !TOKEN_PATTERN.test(token) || cursors.has(token))
        throw Error('invalid_subcollection_cursor');
      cursors.add(token);cursor=token;
    }
    if(!done)throw Error('subcollection_pagination_limit');
    discovered[root]=found;
  }
  return Object.freeze({uid,discovered,unexpected,
    completeForKnownRootDocuments:true,readOnly:true});
}

function assertDocumentPath(path,collection) {
  if(typeof path!=='string') throw Error('invalid_document_path');
  const parts=path.split('/');
  if(parts.length!==collection.split('/').length+1 ||
      !path.startsWith(collection+'/') || !PART.test(parts.at(-1)))
    throw Error('unexpected_collection_document');
}

async function listBounded(adapter,collection) {
  const docs=[];
  const tokens=new Set();
  let cursor=null;
  for(let page=0;page<MAX_PAGES;page++) {
    const result=await adapter.listPage(collection,cursor,PAGE_SIZE);
    // O contrato é fechado: metadados desconhecidos ou cursor omitido
    // nunca podem ser confundidos com fim real do inventário.
    if(!result || typeof result!=='object' || Array.isArray(result) ||
        !Object.hasOwn(result,'paths') ||
        !Object.hasOwn(result,'nextPageToken') ||
        Object.keys(result).some(k=>k!=='paths' && k!=='nextPageToken') ||
        !Array.isArray(result.paths) || result.paths.length>PAGE_SIZE)
      throw Error('invalid_page');
    const seenPaths=new Set(docs);
    for(const path of result.paths) {
      assertDocumentPath(path,collection);
      if(seenPaths.has(path)) throw Error('duplicate_document');
      seenPaths.add(path);
      docs.push(path);
      if(docs.length>MAX_DOCUMENTS) throw Error('inventory_too_large');
    }
    const token=result.nextPageToken;
    if(token===null) return docs;
    if(typeof token!=='string' || !TOKEN_PATTERN.test(token) || tokens.has(token))
      throw Error('invalid_page_token');
    tokens.add(token);
    cursor=token;
  }
  throw Error('pagination_limit_exceeded');
}


/**
 * Varre todas as coleções de primeiro nível descobertas e, para CADA
 * documento, descobre e percorre seus filhos até o limite explícito.
 * getDoc não é usado: listDocuments(showMissing=true) alcança documentos
 * pais ausentes que ainda possuem netos órfãos.
 *
 * A lista é somente de caminhos, sem campos de documentos nem exclusão.
 */
export async function discoverOwnedNestedDocuments(uid,adapter,topology) {
  if(!validUid(uid))throw Error('invalid_uid');
  if(typeof adapter?.listChildCollections!=='function' ||
     typeof adapter?.listPage!=='function' ||
     topology?.uid!==uid || topology?.readOnly!==true)
    throw Error('invalid_nested_audit_context');
  const collections=[];
  for(const root of OWNED_ROOTS) {
    const ids=topology.discovered?.[root];
    if(!Array.isArray(ids))throw Error('invalid_nested_root_topology');
    for(const id of ids) {
      if(typeof id!=='string' || !COLLECTION_ID.test(id))
        throw Error('invalid_nested_collection');
      collections.push(root+'/'+uid+'/'+id);
    }
  }
  if(collections.length>MAX_DOCUMENTS)throw Error('nested_collection_limit');
  const seenCollections=new Set(),seenDocuments=new Set();
  const documents=[];
  let nestedCollections=0;
  for(let index=0;index<collections.length;index++) {
    const name=collections[index];
    const parts=name.split('/');
    if(parts.length>MAX_DOCUMENT_SEGMENTS-1 ||
       seenCollections.has(name))
      throw Error('nested_collection_invalid_or_duplicate');
    seenCollections.add(name);
    if(parts.length>3)nestedCollections++;
    const current=await listBounded(adapter,name);
    for(const path of current) {
      const segments=path.split('/');
      if(segments.length>MAX_DOCUMENT_SEGMENTS || seenDocuments.has(path))
        throw Error('nested_document_invalid_or_duplicate');
      seenDocuments.add(path);
      documents.push(path);
      if(documents.length>MAX_DOCUMENTS)
        throw Error('nested_document_limit');
      // Paginação estrita inclusive sob pais ausentes.
      const ids=new Set(),tokens=new Set();
      let cursor=null,complete=false;
      for(let page=0;page<MAX_PAGES;page++) {
        const result=await adapter.listChildCollections(path,cursor,PAGE_SIZE);
        if(!result || typeof result!=='object' || Array.isArray(result) ||
           !Object.hasOwn(result,'collectionIds') ||
           !Object.hasOwn(result,'nextPageToken') ||
           Object.keys(result).some(k=>k!=='collectionIds' && k!=='nextPageToken') ||
           !Array.isArray(result.collectionIds) ||
           result.collectionIds.length>PAGE_SIZE)
          throw Error('invalid_nested_subcollection_page');
        for(const id of result.collectionIds) {
          if(typeof id!=='string' || !COLLECTION_ID.test(id) || ids.has(id))
            throw Error('invalid_nested_subcollection_id');
          ids.add(id);
          if(segments.length>=MAX_DOCUMENT_SEGMENTS)
            throw Error('nested_depth_limit');
          collections.push(path+'/'+id);
          if(collections.length>MAX_DOCUMENTS)
            throw Error('nested_collection_limit');
        }
        const token=result.nextPageToken;
        if(token===null){complete=true;break;}
        if(typeof token!=='string' || !TOKEN_PATTERN.test(token) || tokens.has(token))
          throw Error('invalid_nested_subcollection_cursor');
        tokens.add(token);cursor=token;
      }
      if(!complete)throw Error('nested_subcollection_pagination_limit');
    }
  }
  return Object.freeze({uid,documents,nestedCollections,
    treeScanComplete:true,readOnly:true});
}

export async function inventoryOwnedDocuments(uid,adapter) {
  if(!validUid(uid)) throw Error('invalid_uid');
  if(typeof adapter?.getDocument!=='function' ||
      typeof adapter?.listPage!=='function') throw Error('missing_read_only_adapter');
  const documents=[];
  for(const root of OWNED_ROOTS) {
    const path=root+'/'+uid;
    const exists=await adapter.getDocument(path);
    if(typeof exists!=='boolean') throw Error('invalid_document_response');
    if(exists) documents.push({path,kind:'owned'});
  }
  // Com RPC de descoberta disponível, fazer varredura profunda e única;
  // sem ela, manter apenas leitura conhecida e sinalizar lacunas.
  const topology=typeof adapter.listChildCollections==='function'
    ? await discoverOwnedSubcollectionIds(uid,adapter) : null;
  const nested=topology
    ? await discoverOwnedNestedDocuments(uid,adapter,topology) : null;
  if(nested) {
    for(const path of nested.documents)
      documents.push({path,kind:'owned'});
  }else{
    for(const child of USER_SUBCOLLECTIONS) {
      const collection='users/'+uid+'/'+child;
      for(const path of await listBounded(adapter,collection))
        documents.push({path,kind:'owned'});
    }
    for(const child of GUARDIAN_SUBCOLLECTIONS) {
      const collection='guardian_notices/'+uid+'/'+child;
      for(const path of await listBounded(adapter,collection))
        documents.push({path,kind:'owned'});
    }
  }
  if(documents.length>MAX_DOCUMENTS) throw Error('inventory_too_large');
  return {
    uid,documents,
    // Estes escopos exigem a varredura relacional, de mídia e de Auth.
    pagesComplete:false,
    scopesComplete:[],
    externalResources:[],
    // Esta descoberta cobre apenas o primeiro nível abaixo dos pais
    // conhecidos. Documentos nas subcoleções podem ter OUTROS descendentes.
    // Não afirmar ausência global de coleções desconhecidas sem auditoria
    // recursiva separada e validação de todos os escopos.
    hasUnknownCollections:true,
    hasUnknownDirectSubcollections:topology===null ||
      topology.unexpected.length>0,
    unknownDirectSubcollections:topology?.unexpected||[],
    directRootSubcollectionDiscoveryComplete:topology!==null,
    ownedNestedTreeScanComplete:nested?.treeScanComplete===true,
    nestedOwnedCollectionCount:nested?.nestedCollections||0,
    // A árvore própria pode estar inventariada, mas escopos globais,
    // referências cruzadas, mídia e Auth continuam NÃO homologados.
    contentReferencesUnresolved:true,
    mediaStateUncertain:true,
    directReadCompleted:true
  };
}
