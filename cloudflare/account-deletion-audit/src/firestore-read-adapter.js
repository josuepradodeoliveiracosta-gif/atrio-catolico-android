/**
 * Adaptador Firestore REST SOMENTE-LEITURA (não ligado a rota ou cron).
 * Token OAuth deve ser fornecido por backend com IAM limitado e jamais por
 * navegador/Android. As respostas públicas nunca incluem token, UID ou conteúdo.
 */
import {validUid} from './plan.js';
import {readBoundedFirestoreJson} from './bounded-firestore-response.js';
import {OWNED_ROOTS,USER_SUBCOLLECTIONS,GUARDIAN_SUBCOLLECTIONS}
  from './deletion-orchestrator.js';

const ROOT='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents';
const MAX_RESPONSE=2_000_000;
const COLLECTION_ID=/^[A-Za-z0-9_-]{1,160}$/;
const KEY=/^[A-Za-z0-9_-]{1,160}$/;
const tokenOK=cursor=>typeof cursor==='string' &&
  /^[A-Za-z0-9_+\/=.-]{1,2048}$/.test(cursor);

function fixedCollection(uid,value) {
  return USER_SUBCOLLECTIONS.some(x=>value==='users/'+uid+'/'+x) ||
    GUARDIAN_SUBCOLLECTIONS.some(x=>value==='guardian_notices/'+uid+'/'+x);
}

function verifyRemoteName(name,collection) {
  const prefix='projects/atrio-catolico/databases/(default)/documents/';
  if(typeof name!=='string' || !name.startsWith(prefix))
    throw Error('unexpected_firestore_resource');
  const path=name.slice(prefix.length);
  const parts=path.split('/');
  if(parts.length!==collection.split('/').length+1 ||
      !path.startsWith(collection+'/') || !KEY.test(parts.at(-1)))
    throw Error('unexpected_firestore_resource');
  return path;
}

export function createFirestoreReadAdapter(uid,oauthToken,fetcher=fetch) {
  if(!validUid(uid)) throw Error('invalid_uid');
  if(typeof oauthToken!=='string' || oauthToken.length<20 ||
      oauthToken.length>4096 || /[\s\u0000-\u001f]/.test(oauthToken))
    throw Error('invalid_oauth_token');
  if(typeof fetcher!=='function') throw Error('invalid_read_transport');

  const auth={Authorization:'Bearer '+oauthToken,Accept:'application/json'};
  async function responseJson(url,notFound=false) {
    const response=await fetcher(url,{method:'GET',headers:auth,redirect:'error'});
    if(response.status===404 && notFound) return null;
    if(response.status!==200) throw Error('firestore_read_failed');
    return readBoundedFirestoreJson(response,{
      limit:MAX_RESPONSE,sizeError:'firestore_response_too_large',
      parseError:'invalid_firestore_response'
    });
  }
  return Object.freeze({
    async getDocument(path) {
      if(!OWNED_ROOTS.some(root=>path===root+'/'+uid)) throw Error('disallowed_doc_path');
      const remote=await responseJson(ROOT+'/'+path.split('/').map(encodeURIComponent).join('/'),true);
      if(remote===null) return false;
      // HTTP 200 without the exact requested resource is not ownership proof.
      const expectedName='projects/atrio-catolico/databases/(default)/documents/'+path;
      if(!remote || typeof remote!=='object' || Array.isArray(remote) ||
          remote.name!==expectedName)
        throw Error('unexpected_firestore_resource');
      return true;
    },
    // listCollectionIds é uma operação de LEITURA da API Firestore REST,
    // apesar do verbo HTTP POST. Não adiciona documentos nem escreve dados.
    // Inspeciona inclusive pais ausentes, cujas subcoleções podem sobreviver.
    async listChildCollections(parent,cursor=null,pageSize=100) {
      if(!OWNED_ROOTS.some(root=>parent===root+'/'+uid) ||
          !Number.isInteger(pageSize) || pageSize<1 || pageSize>100 ||
          (cursor!==null && !tokenOK(cursor)))
        throw Error('disallowed_collection_discovery');
      const body={pageSize};
      if(cursor!==null)body.pageToken=cursor;
      const url=ROOT+'/'+parent.split('/').map(encodeURIComponent).join('/')+
        ':listCollectionIds';
      const response=await fetcher(url,{
        method:'POST',
        headers:{...auth,'Content-Type':'application/json'},
        redirect:'error',body:JSON.stringify(body)
      });
      if(response.status!==200)throw Error('firestore_discovery_failed');
      const json=await readBoundedFirestoreJson(response,{
        limit:MAX_RESPONSE,sizeError:'firestore_response_too_large',
        parseError:'invalid_firestore_response'
      });
      if(!json || typeof json!=='object' || Array.isArray(json) ||
          (json.collectionIds!==undefined && !Array.isArray(json.collectionIds)) ||
          (json.nextPageToken!==undefined &&
            (typeof json.nextPageToken!=='string' || !tokenOK(json.nextPageToken))) ||
          Object.keys(json).some(k=>k!=='collectionIds' && k!=='nextPageToken'))
        throw Error('invalid_firestore_response');
      const collections=json.collectionIds||[];
      if(collections.length>pageSize ||
          collections.some(c=>typeof c!=='string' || !COLLECTION_ID.test(c)))
        throw Error('invalid_firestore_collection_id');
      return {collectionIds:collections,nextPageToken:json.nextPageToken??null};
    },
    async listPage(collection,cursor=null,pageSize=100) {
      if(!fixedCollection(uid,collection) || !Number.isInteger(pageSize) ||
          pageSize<1 || pageSize>100 || (cursor!==null && !tokenOK(cursor)))
        throw Error('disallowed_collection_query');
      const query=new URLSearchParams({pageSize:String(pageSize)});
      if(cursor) query.set('pageToken',cursor);
      const json=await responseJson(ROOT+'/'+collection.split('/').map(encodeURIComponent).join('/')+
        '?'+query.toString());
      if(!json || typeof json!=='object' || Array.isArray(json) ||
          (json.documents!==undefined && !Array.isArray(json.documents)) ||
          (json.nextPageToken!==undefined &&
            (typeof json.nextPageToken!=='string' || !tokenOK(json.nextPageToken))) ||
          Object.keys(json).some(k=>k!=='documents' && k!=='nextPageToken'))
        throw Error('invalid_firestore_response');
      const documents=json.documents||[];
      if(documents.length>pageSize) throw Error('firestore_page_too_large');
      return {
        paths:documents.map(d=>verifyRemoteName(d?.name,collection)),
        nextPageToken:json.nextPageToken??null
      };
    }
  });
}
