/**
 * Cloudinary Admin API: SOMENTE leitura de metadados de avatar por prefixo
 * e delivery type. Este adaptador não tem acesso a métodos POST/DELETE.
 * Apenas em backend privado, nunca no navegador nem no APK.
 */
import {validUid} from './plan.js';
const ASCII=/^[A-Za-z0-9_-]{1,128}$/;
const CURSOR=/^[A-Za-z0-9_+\/=.:()-]{1,2048}$/;
const MAX_BYTES=700000;

export function createCloudinaryAvatarReadAdapter({cloudName,apiKey,apiSecret}={},fetcher=fetch) {
  if(typeof cloudName!=='string' || !ASCII.test(cloudName) ||
    typeof apiKey!=='string' || !/^\d{8,32}$/.test(apiKey) ||
    typeof apiSecret!=='string' || !/^[A-Za-z0-9_-]{20,128}$/.test(apiSecret))
    throw Error('invalid_cloudinary_config');
  if(typeof fetcher!=='function') throw Error('invalid_cloudinary_transport');
  const basic='Basic '+btoa(apiKey+':'+apiSecret);
  const root='https://api.cloudinary.com/v1_1/'+cloudName+'/resources/image/';
  return Object.freeze({
    async readPage(uid,type,cursor=null,limit=100){
      if(!validUid(uid) || !['upload','authenticated'].includes(type) ||
        !Number.isInteger(limit)||limit<1||limit>100 ||
        (cursor!==null && (typeof cursor!=='string'||!CURSOR.test(cursor))))
        throw Error('invalid_cloudinary_query');
      const params=new URLSearchParams({
        prefix:'atrio-avatares/'+uid+'/',max_results:String(limit)
      });
      if(cursor)params.set('next_cursor',cursor);
      const response=await fetcher(root+type+'?'+params.toString(),{
        method:'GET',redirect:'error',headers:{
          Authorization:basic,Accept:'application/json'
        }
      });
      if(response.status!==200) throw Error('cloudinary_unavailable');
      const raw=await response.text();
      if(raw.length>MAX_BYTES) throw Error('cloudinary_response_too_large');
      let data;
      try{data=JSON.parse(raw);}catch(_){throw Error('invalid_cloudinary_response');}
      if(!data || !Array.isArray(data.resources) ||
        data.resources.length>limit ||
        (data.next_cursor!==undefined && typeof data.next_cursor!=='string'))
        throw Error('invalid_cloudinary_response');
      // Only return required fields; never return URLs, context, metadata,
      // tokens, tags, moderation comments, or other tenant information.
      const items=data.resources.map(item=>({
        type:item?.type,public_id:item?.public_id
      }));
      return {items,nextCursor:data.next_cursor||null};
    }
  });
}
