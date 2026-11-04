/**
 * Narrow HTTP boundary for a private Cloud Run review-only candidate.
 * Cloud Run MUST enforce its own Google-signed IAM Invoker token before a
 * request reaches this handler. A Firebase founder ID token is separately
 * verified by reader.inspect(). This module cannot verify Cloud Run IAM.
 *
 * No health/public listing endpoints, deletion, account mutations, or logs
 * of request bodies/tokens. Use only behind internal ingress + Invoker IAM.
 */
const MAX_BYTES=8192;
const COUNTS=Object.freeze([
  'firestoreOwnedRootDocumentsAndDescendants',
  'ownedNestedCollectionCount','unexpectedDirectSubcollectionCount',
  'firestoreRelationalReferences','queriedRelationalScopeCount',
  'authorizationRechecks'
]);
const STATUS='read_only_review_required';
const flag=false;
function send(res,status,body){
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store, private, max-age=0',
    'Pragma':'no-cache',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'
  });
  res.end(JSON.stringify(body));
}
function invalid(reason){throw Error('private_http_'+reason);}
function boundedReport(report){
  if(!report || report.status!==STATUS ||
     report.privateBackendCodePrepared!==true ||
     report.runtimeServiceAccountNameMatched!==true ||
     report.accountDeletionAuthorized!==false ||
     report.googlePlayReleaseAuthorized!==false ||
     report.destructiveOperationsEnabled!==false ||
     report.cloudRunInvokerIamReviewed!==false ||
     report.readOnlyIamRolesIndependentlyVerified!==false)
    invalid('unverified_report');
  const summary={status:STATUS};
  for(const name of COUNTS){
    const value=report[name];
    if(!Number.isSafeInteger(value)||value<0||value>1000000)
      invalid('invalid_count');
    summary[name]=value;
  }
  const kinds=report.relationalKinds;
  if(!kinds || typeof kinds!=='object' || Array.isArray(kinds) ||
     Object.keys(kinds).length>20)invalid('invalid_kinds');
  const normalized={};
  for(const [name,value] of Object.entries(kinds)){
    if(!/^[a-z_]{1,64}$/.test(name) || !Number.isSafeInteger(value) ||
       value<0 ||value>1000000)invalid('invalid_kind');
    normalized[name]=value;
  }
  const scopes=report.unresolvedScopes;
  if(!Array.isArray(scopes)||scopes.length>100||
     !scopes.every(value=>typeof value==='string' &&
       /^[a-z_]{1,100}$/.test(value)))
    invalid('invalid_unresolved_scope');
  return {
    ...summary,relationalKinds:normalized,
    unresolvedScopes:[...new Set(scopes)].sort(),
    allAccountDataDiscovered:false,
    legalReviewComplete:false,
    cloudRunInvokerIamReviewed:false,
    readOnlyIamRolesIndependentlyVerified:false,
    destructiveOperationsEnabled:flag,
    accountDeletionAuthorized:flag,
    googlePlayReleaseAuthorized:flag
  };
}
async function parseRequest(req){
  const contentType=req.headers['content-type'];
  if(contentType!=='application/json')
    invalid('content_type');
  const length=req.headers['content-length'];
  if(length!==undefined &&
     (!/^[0-9]{1,5}$/.test(length)||Number(length)>MAX_BYTES))
    invalid('content_length');
  const chunks=[];let bytes=0;
  for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>MAX_BYTES)invalid('body_too_large');
    chunks.push(chunk);
  }
  if(bytes===0)invalid('empty_body');
  let body;
  try{
    body=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
  }catch{invalid('invalid_json');}
  if(!body || typeof body!=='object' ||
    Object.getPrototypeOf(body)!==Object.prototype ||
    Object.keys(body).sort().join(',')!=='idToken,uid' ||
    typeof body.uid!=='string'||
    !/^[A-Za-z0-9_-]{1,128}$/.test(body.uid) ||
    typeof body.idToken!=='string'||body.idToken.length>8192)
    invalid('invalid_request');
  return body;
}
export function createPrivateReviewHttpHandler({reader}={}){
  if(typeof reader?.inspect!=='function')invalid('reader_required');
  let inFlight=false;
  return async function handler(req,res){
    if(req.url!=='/v1/review'||req.method!=='POST')
      return send(res,404,{error:'not_found'});
    if(inFlight)
      return send(res,429,{error:'temporarily_unavailable'});
    inFlight=true;
    const controller=new AbortController();
    const close=()=>{
      if(!res.writableEnded)controller.abort();
    };
    const aborted=()=>controller.abort();
    req.once('aborted',aborted);
    res.once('close',close);
    try{
      const body=await parseRequest(req);
      if(controller.signal.aborted)invalid('request_cancelled');
      const report=await reader.inspect(body,{signal:controller.signal});
      if(controller.signal.aborted)invalid('request_cancelled');
      const safe=boundedReport(report);
      if(!res.destroyed)return send(res,200,safe);
    }catch{
      // Never include exception messages, Firestore paths, UIDs, tokens,
      // reports or retry details in client output.
      if(!res.headersSent && !res.destroyed)
        return send(res,403,{error:'review_unavailable'});
    }finally{
      req.off('aborted',aborted);
      res.off('close',close);
      inFlight=false;
    }
  };
}
