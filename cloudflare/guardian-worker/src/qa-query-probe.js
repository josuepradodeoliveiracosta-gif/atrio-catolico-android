// Index-readiness smoke: a bounded, read-only Firestore REST runQuery.
// Firestore uses HTTP POST for queries; this is NOT a write or moderation action.
// The projection returns document references only; never a user's text, profile
// or response content. Fail closed and expose only fixed status values.
const PROJECT='atrio-catolico-qa-v2';
const API='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents:runQuery';
export function repliesQueryPreview(now=Date.now()){
 if(!Number.isFinite(now)||now<0)throw Error('invalid_qa_probe_time');
 const start=new Date(now-20*60000).toISOString();
 const end=new Date(now).toISOString();
 return {structuredQuery:{
  select:{fields:[{fieldPath:'__name__'}]},
  from:[{collectionId:'replies',allDescendants:true}],
  where:{compositeFilter:{op:'AND',filters:[
   {fieldFilter:{field:{fieldPath:'createdAt'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:start}}},
   {fieldFilter:{field:{fieldPath:'createdAt'},op:'LESS_THAN_OR_EQUAL',value:{timestampValue:end}}}
  ]}},
  orderBy:[
   {field:{fieldPath:'createdAt'},direction:'DESCENDING'},
   {field:{fieldPath:'__name__'},direction:'DESCENDING'}
  ],
  limit:1
 }};
}
export async function probeQaRepliesIndex({project,approved,accessToken,fetcher=fetch,now=Date.now()}) {
 if(project!==PROJECT||approved!==PROJECT)return {status:'blocked'};
 if(typeof accessToken!=='string'||accessToken.length<20)return {status:'unavailable'};
 try {
  const payload=repliesQueryPreview(now);
  const response=await fetcher(API,{
   method:'POST',
   headers:{
    Authorization:'Bearer '+accessToken,
    Accept:'application/json',
    'Content-Type':'application/json'
   },
   body:JSON.stringify(payload),
   redirect:'error',
   signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)return {status:'unavailable'};
  const data=await response.json();
  if(!Array.isArray(data)||data.some(x=>x?.error))return {status:'unavailable'};
  // No document IDs or contents are disclosed, even if QA fixtures exist.
  return {status:'query_ok'};
 }catch{return {status:'unavailable'};}
}
