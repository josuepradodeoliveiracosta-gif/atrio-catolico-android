// Deploy only to the isolated QA Google Cloud project with --no-allow-unauthenticated.
// Cloud Scheduler invokes POST /run using an OIDC token checked by Cloud Run IAM.
import {createServer} from 'node:http';
import {runCloudRunQa,allowCloudRunQa} from './reader.mjs';

const response=(res,status,payload)=>{
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(payload));
};
export function createQaHandler(env=process.env,read=runCloudRunQa) {
 return async (req,res)=>{
  if(req.url==='/healthz'&&req.method==='GET') {
    return response(res,200,{status:allowCloudRunQa(env)?'qa_ready':'qa_disabled'});
  }
  if(req.url!=='/run'||req.method!=='POST')
    return response(res,404,{status:'not_found'});
  if(!allowCloudRunQa(env))return response(res,503,{status:'qa_disabled'});
  // No client-supplied target IDs, text or arbitrary query/body accepted.
  const contentLength=Number(req.headers['content-length']||'0');
  if(!Number.isSafeInteger(contentLength)||contentLength!==0 ||
     req.headers['transfer-encoding'])
    return response(res,400,{status:'body_disallowed'});
  const result=await read(env);
  if(result.status!=='shadow_read_only') {
    console.log('guardian_qa_cloudrun_status','unavailable');
    return response(res,503,{status:'unavailable'});
  }
  console.log('guardian_qa_cloudrun_counts',JSON.stringify(result.counts));
  return response(res,200,{status:'shadow_read_only',counts:result.counts});
 };
}
if(process.env.GUARDIAN_QA_SERVER==='true') {
  const port=Number(process.env.PORT||'8080');
  if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('invalid_port');
  createServer(createQaHandler()).listen(port,'0.0.0.0');
}
