/**
 * Firestore StructuredQuery REST — SOMENTE LEITURA e NÃO conectado a endpoints.
 * :runQuery usa HTTP POST para executar uma QUERY, não uma escrita.
 *
 * Requer token OAuth de backend com IAM SOMENTE-LEITURA, injetado pela
 * infraestrutura confiável. Nunca aceitar tokens/UID/escopos de clientes.
 *
 * Sem aplicação em produção: índices, projeção e cursores precisam de
 * homologação no Firestore Emulator antes de conectar a um Worker.
 */
import {validUid} from './plan.js';
import {RELATIONAL_QUERY_SPECS} from './relational-inventory.js';

const PROJECT='atrio-catolico';
const ROOT='projects/'+PROJECT+'/databases/(default)/documents';
const URL='https://firestore.googleapis.com/v1/'+ROOT+':runQuery';
const MAX_RESPONSE_BYTES=2_000_000;
const PATH_PART=/^[A-Za-z0-9_-]{1,160}$/;
const tokenPattern=/^[A-Za-z0-9_+\/=.-]{20,4096}$/;

function maskMatches(path,mask) {
  const parts=path.split('/'),maskParts=mask.split('/');
  return parts.length===maskParts.length && parts.length%2===0 &&
    parts.every((part,index)=>PATH_PART.test(part) &&
      (maskParts[index]==='*'||part===maskParts[index]));
}
function verifySpec(spec) {
  const standard=RELATIONAL_QUERY_SPECS.find(x=>x.id===spec?.id);
  if(!standard ||
    standard.collectionGroup!==spec.collectionGroup ||
    standard.field!==spec.field ||
    standard.path!==spec.path ||
    standard.review!==spec.review)
    throw Error('disallowed_query_spec');
  return standard;
}
function validDocumentRef(value,spec) {
  if(typeof value!=='string'||!value.startsWith(ROOT+'/')) return false;
  return maskMatches(value.slice(ROOT.length+1),spec.path);
}
function queryBody(spec,uid,limit,cursor) {
  const q={
    select:{fields:[{fieldPath:spec.field}]},
    from:[{collectionId:spec.collectionGroup,allDescendants:true}],
    where:{fieldFilter:{
      field:{fieldPath:spec.field},
      op:'EQUAL',
      value:{stringValue:uid}
    }},
    orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],
    limit
  };
  if(cursor) q.startAt={
    values:[{referenceValue:cursor}],before:false
  };
  return {structuredQuery:q};
}
export function createRelationalFirestoreReadAdapter(uid,oauthToken,fetcher=fetch) {
  if(!validUid(uid)) throw Error('invalid_uid');
  if(typeof oauthToken!=='string'||!tokenPattern.test(oauthToken))
    throw Error('invalid_oauth_token');
  if(typeof fetcher!=='function') throw Error('invalid_transport');

  return Object.freeze({
    async queryPage(spec,queryUid,cursor=null,pageSize=100) {
      const chosen=verifySpec(spec);
      if(queryUid!==uid||!Number.isInteger(pageSize)||pageSize<1||pageSize>100 ||
        (cursor!==null&&!validDocumentRef(cursor,chosen)))
        throw Error('invalid_query_parameters');
      const response=await fetcher(URL,{
        method:'POST', // Firestore :runQuery is read-only despite POST.
        redirect:'error',
        headers:{Authorization:'Bearer '+oauthToken,
          'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify(queryBody(chosen,uid,pageSize,cursor))
      });
      if(response.status!==200) throw Error('firestore_query_unavailable');
      const raw=await response.text();
      if(raw.length>MAX_RESPONSE_BYTES) throw Error('firestore_response_too_large');
      let entries;
      try{entries=JSON.parse(raw);}catch(_){throw Error('invalid_query_response');}
      if(!Array.isArray(entries)||entries.length>pageSize+1)
        throw Error('invalid_query_response');
      const items=[];
      let previous=cursor;
      for(const entry of entries) {
        if(!entry||typeof entry!=='object'||Array.isArray(entry))
          throw Error('invalid_query_response');
        if(!('document' in entry)) {
          // Firestore can return a readTime-only envelope for empty queries.
          if(entries.length!==1||items.length!==0||
            entry.skippedResults!==undefined||!entry.readTime)
            throw Error('unexpected_empty_query_envelope');
          continue;
        }
        const doc=entry.document;
        if(!validDocumentRef(doc?.name,chosen) ||
          typeof doc.fields!=='object'||doc.fields===null||
          Array.isArray(doc.fields) ||
          Object.keys(doc.fields).length!==1 ||
          doc.fields[chosen.field]?.stringValue!==uid)
          throw Error('unexpected_query_document');
        if(previous!==null && doc.name<=previous)
          throw Error('out_of_order_query_response');
        previous=doc.name;
        items.push({
          path:doc.name.slice(ROOT.length+1),
          fields:{[chosen.field]:uid}
        });
      }
      if(items.length>pageSize) throw Error('invalid_query_response');
      return {
        items,
        // Full reference as server-internal cursor; never expose publicly.
        nextPageToken:items.length===pageSize?previous:null
      };
    }
  });
}
