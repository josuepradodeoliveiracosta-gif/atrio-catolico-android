// Read-only audit of the *QA* Firestore index configuration.
// Uses the existing GitHub OIDC/WIF short-lived token. No writes, no credentials
// in the repository, and no calls to projects outside atrio-catolico-qa-v2.
const PROJECT='atrio-catolico-qa-v2';
const API='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/collectionGroups';
const REQUIRED=[
  ['posts','COLLECTION',[['qaFixture','ASCENDING'],['createdAt','DESCENDING']]],
  ['replies','COLLECTION_GROUP',[['qaFixture','ASCENDING'],['createdAt','DESCENDING']]],
  ['reports','COLLECTION',[['qaFixture','ASCENDING'],['createdAt','DESCENDING']]]
];

export function auditAllowed(project,approved) {
 return project===PROJECT && approved===PROJECT;
}
const indexesOf=(res)=>Array.isArray(res?.indexes)?res.indexes:[];
const matchComposite=(idx,[group,scope,fields])=>
 idx?.name?.includes('/collectionGroups/'+group+'/indexes/')
 && idx.queryScope===scope
 && fields.every(([name,order],i)=>idx.fields?.[i]?.fieldPath===name&&idx.fields?.[i]?.order===order);
const summaryOf=(field)=>{
 const indexes=indexesOf(field?.indexConfig);
 const found=indexes.find(i=>i.queryScope==='COLLECTION_GROUP'&&
  i.fields?.some(f=>f.fieldPath==='createdAt'&&f.order==='DESCENDING'));
 return found?.state==='READY'?'ready':found?'building':'missing';
};
export async function readQaIndexes({project,approved,accessToken,fetcher=fetch}) {
 if(!auditAllowed(project,approved))return {status:'blocked'};
 if(typeof accessToken!=='string'||accessToken.length<20)return {status:'unavailable'};
 async function get(path){
  const url=API+path;
  const response=await fetcher(url,{method:'GET',headers:{
   Authorization:'Bearer '+accessToken,Accept:'application/json'
  },redirect:'error',signal:AbortSignal.timeout(8000)});
  if(response.status===404)return null;
  if(!response.ok)throw Error('index_read_failed');
  return response.json();
 }
 try{
  const composites=[];
  let next='';
  for(let page=0;page<5;page++){
   const payload=await get('/-/indexes?pageSize=100'+(next?'&pageToken='+encodeURIComponent(next):''));
   if(!payload||!Array.isArray(payload.indexes))throw Error('invalid_index_response');
   composites.push(...payload.indexes);
   next=payload.nextPageToken||'';
   if(!next)break;
   if(page===4)throw Error('index_listing_exceeded_limit');
  }
  const field=await get('/replies/fields/createdAt');
  return {status:'observed',
   composites:REQUIRED.map(([group,scope,fields])=>{
    const match=composites.find(i=>matchComposite(i,[group,scope,fields]));
    return {group,state:match?.state==='READY'?'ready':match?'building':'missing'};
   }),
   repliesCreatedAtGroup:summaryOf(field)};
 }catch{return {status:'unavailable'};}
}
