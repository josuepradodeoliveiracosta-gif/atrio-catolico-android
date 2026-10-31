/**
 * Apenas lê photoPublicId de profile_photos/{uid} por REST.
 * Não conecta ao Worker existente nem executa mutações no Firestore.
 * Exige token OAuth de serviço SOMENTE-LEITURA mantido exclusivamente no backend.
 */
import {validUid} from './plan.js';
const ROOT='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents';
const TOKEN=/^[A-Za-z0-9_+\/=.-]{20,4096}$/;
const MAX_BYTES=10000;
const V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createAvatarFirestorePhotoReadAdapter(uid,oauthToken,fetcher=fetch) {
  if(!validUid(uid))throw Error('invalid_uid');
  if(typeof oauthToken!=='string' || !TOKEN.test(oauthToken))
    throw Error('invalid_oauth_token');
  if(typeof fetcher!=='function')throw Error('invalid_firestore_transport');
  return Object.freeze({
    async getPublicId(requestUid){
      if(requestUid!==uid)throw Error('disallowed_photo_owner');
      const url=ROOT+'/profile_photos/'+encodeURIComponent(uid)+
        '?mask.fieldPaths=photoPublicId';
      const response=await fetcher(url,{
        method:'GET',redirect:'error',
        headers:{Authorization:'Bearer '+oauthToken,Accept:'application/json'}
      });
      if(response.status===404)return null;
      if(response.status!==200)throw Error('firestore_photo_unavailable');
      const raw=await response.text();
      if(raw.length>MAX_BYTES)throw Error('firestore_photo_response_too_large');
      let value;
      try{value=JSON.parse(raw);}catch(_){throw Error('invalid_photo_response');}
      if(!value || typeof value!=='object' ||
        value.name!=='projects/atrio-catolico/databases/(default)/documents/profile_photos/'+uid ||
        !value.fields || typeof value.fields!=='object' ||
        Array.isArray(value.fields) ||
        Object.keys(value.fields).length!==1 ||
        typeof value.fields.photoPublicId?.stringValue!=='string')
        throw Error('invalid_photo_response');
      const id=value.fields.photoPublicId.stringValue;
      if(!id.startsWith('atrio-avatares/'+uid+'/') ||
        !V4.test(id.slice(('atrio-avatares/'+uid+'/').length)))
        throw Error('invalid_photo_reference');
      return id;
    }
  });
}
