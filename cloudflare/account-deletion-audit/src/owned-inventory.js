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
const TOKEN_PATTERN=/^[A-Za-z0-9_+\/=.-]{1,2048}$/;
const PART=/^[A-Za-z0-9_-]{1,160}$/;

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
    if(!result || !Array.isArray(result.paths) ||
        result.paths.length>PAGE_SIZE) throw Error('invalid_page');
    const seenPaths=new Set(docs);
    for(const path of result.paths) {
      assertDocumentPath(path,collection);
      if(seenPaths.has(path)) throw Error('duplicate_document');
      seenPaths.add(path);
      docs.push(path);
      if(docs.length>MAX_DOCUMENTS) throw Error('inventory_too_large');
    }
    const token=result.nextPageToken;
    if(!token) return docs;
    if(typeof token!=='string' || !TOKEN_PATTERN.test(token) || tokens.has(token))
      throw Error('invalid_page_token');
    tokens.add(token);
    cursor=token;
  }
  throw Error('pagination_limit_exceeded');
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
  for(const child of USER_SUBCOLLECTIONS) {
    // Mesmo que /users/{uid} não exista, suas subcoleções podem persistir.
    const collection='users/'+uid+'/'+child;
    for(const path of await listBounded(adapter,collection))
      documents.push({path,kind:'owned'});
  }
  for(const child of GUARDIAN_SUBCOLLECTIONS) {
    const collection='guardian_notices/'+uid+'/'+child;
    for(const path of await listBounded(adapter,collection))
      documents.push({path,kind:'owned'});
  }
  if(documents.length>MAX_DOCUMENTS) throw Error('inventory_too_large');

  return {
    uid,documents,
    // Estes escopos exigem a varredura relacional, de mídia e de Auth.
    pagesComplete:false,
    scopesComplete:[],
    externalResources:[],
    hasUnknownCollections:true,
    contentReferencesUnresolved:true,
    mediaStateUncertain:true,
    directReadCompleted:true
  };
}
