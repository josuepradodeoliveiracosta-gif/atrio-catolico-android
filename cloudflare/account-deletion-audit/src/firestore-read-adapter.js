/**
 * Adaptador Firestore REST SOMENTE-LEITURA (não ligado a rota ou cron).
 * Token OAuth deve ser fornecido por backend com IAM limitado e jamais por
 * navegador/Android. As respostas públicas nunca incluem token, UID ou conteúdo.
 */
import {validUid} from './plan.js';
import {OWNED_ROOTS,USER_SUBCOLLECTIONS,GUARDIAN_SUBCOLLECTIONS}
  from './deletion-orchestrator.js';

const ROOT='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents';
const MAX_RESPONSE=2_000_000;
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
    const text=await response.text();
    if(text.length>MAX_RESPONSE) throw Error('firestore_response_too_large');
    try{return JSON.parse(text);}catch(_){throw Error('invalid_firestore_response');}
  }
  return Object.freeze({
    async getDocument(path) {
      if(!OWNED_ROOTS.some(root=>path===root+'/'+uid)) throw Error('disallowed_doc_path');
      return (await responseJson(ROOT+'/'+path.split('/').map(encodeURIComponent).join('/'),true))!==null;
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
          (json.nextPageToken!==undefined && typeof json.nextPageToken!=='string'))
        throw Error('invalid_firestore_response');
      const documents=json.documents||[];
      if(documents.length>pageSize) throw Error('firestore_page_too_large');
      return {
        paths:documents.map(d=>verifyRemoteName(d?.name,collection)),
        nextPageToken:json.nextPageToken||null
      };
    }
  });
}
