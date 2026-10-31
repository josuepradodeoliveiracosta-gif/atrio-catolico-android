// Átrio Guardião V2 — gateway Cloudflare sem credenciais de serviço.
// O Firestore autentica o Firebase ID token e aplica Security Rules.
// Resoluções administrativas ficam NEGADAS até a implantação de regras dedicadas.
const PROJECT='atrio-catolico';
const BASE='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents';
const ROOT='projects/'+PROJECT+'/databases/(default)/documents';
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const CASE=/^guard_[a-f0-9]{32}$/;
const TARGET=/^posts\/[A-Za-z0-9_-]{1,128}(?:\/replies\/[A-Za-z0-9_-]{1,128})?$/;
const FIELDS=['status','ruleCode','targetType','createdAt'];
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const response=(code,status)=>new Response(JSON.stringify({status}),{status:code,headers:HEADERS});
function asString(doc,key){return doc?.fields?.[key]?.stringValue||'';}
function tokenAndUid(request){
  const bearer=/^Bearer ([A-Za-z0-9._-]{100,5000})$/.exec(request.headers.get('authorization')||'');
  if(!bearer)return null;
  const token=bearer[1], parts=token.split('.');
  if(parts.length!==3||parts[1].length>3500)return null;
  let p;
  try{
    const t=parts[1].replace(/-/g,'+').replace(/_/g,'/');
    p=JSON.parse(atob(t.padEnd(Math.ceil(t.length/4)*4,'=')));
  }catch{return null;}
  if(p?.iss!=='https://securetoken.google.com/'+PROJECT || p.aud!==PROJECT ||
     !ID.test(p.sub||'') || typeof p.exp!=='number' ||
     p.exp<=Date.now()/1000 || typeof p.iat!=='number' || p.iat>Date.now()/1000)
    return null;
  // Payload nao verificado aqui: NUNCA autoriza sozinho. Todas as leituras
  // e commits passam pelas Security Rules do Firestore com o token original.
  return {token,uid:p.sub};
}
async function firestore(t,path,method='GET',body){
  let r;
  try{
    r=await fetch(BASE+path,{
      method,headers:{'authorization':'Bearer '+t,'content-type':'application/json'},
      body:body?JSON.stringify(body):undefined,
      signal:AbortSignal.timeout(9000),redirect:'error'
    });
  }catch{return {ok:false,code:503};}
  if(!r.ok)return {ok:false,code:(r.status===401||r.status===403)?403:503};
  try{
    const raw=await r.text();
    if(raw.length>90000)return {ok:false,code:503};
    return {ok:true,data:JSON.parse(raw)};
  }catch{return {ok:false,code:503};}
}
async function requireAdmin(creds){
  // A regra para admins/{uid} permite GET apenas ao proprio UID, impedindo
  // usar um sub nao verificado para consultar permissao de outra pessoa.
  const r=await firestore(creds.token,'/admins/'+creds.uid);
  return r.ok && r.data?.fields?.enabled?.booleanValue===true;
}
async function status(creds){
  const r=await firestore(creds.token,'/guardian_config/policy');
  if(!r.ok)return response(r.code,'config_unavailable');
  const f=r.data?.fields||{};
  return new Response(JSON.stringify({status:'ready',mode:'user_token_rules',
    autonomousWriteEnabled:f.autonomousWriteEnabled?.booleanValue===true,
    enabled:f.enabled?.booleanValue===true,
    emergencyStop:f.emergencyStop?.booleanValue!==false,
    holdEnabled:f.allowHold?.booleanValue===true,
    administrativeWritesEnabled:false}),{status:200,headers:HEADERS});
}
async function cases(creds){
  const query={structuredQuery:{
    from:[{collectionId:'guardian_cases'}],
    select:{fields:FIELDS.map(fieldPath=>({fieldPath}))},
    orderBy:[{field:{fieldPath:'createdAt'},direction:'DESCENDING'}],
    limit:15
  }};
  const r=await firestore(creds.token,':runQuery','POST',query);
  if(!r.ok)return response(r.code,'cases_unavailable');
  if(!Array.isArray(r.data))return response(503,'invalid_response');
  const items=[];
  for(const x of r.data){
    const d=x.document;
    if(!d)continue;
    const id=d.name?.split('/').at(-1);
    if(!CASE.test(id||''))return response(503,'invalid_case');
    items.push({caseId:id,status:asString(d,'status'),
      rule:asString(d,'ruleCode'),kind:asString(d,'targetType')});
  }
  return new Response(JSON.stringify({status:'ready',cases:items}),{
    status:200,headers:HEADERS});
}
// Revisao humana reversivel e sem exclusao, aplicada APENAS com aceite remoto.
async function resolveCase(request,env,creds){
  if(env.GUARDIAN_V2_ADMIN_WRITES_ENABLED!=='true')
    return response(503,'admin_write_not_enabled');
  let raw;
  try {
    if(Number(request.headers.get('content-length')||'0')>2048)
      return response(400,'invalid_request');
    raw=await request.text();
    if(raw.length>2048)return response(400,'invalid_request');
  }catch{return response(400,'invalid_request');}
  let input;
  try{input=JSON.parse(raw);}catch{return response(400,'invalid_request');}
  if(!input || Array.isArray(input) || typeof input!=='object' ||
     Object.keys(input).sort().join(',')!=='action,caseId,note' ||
     !CASE.test(input.caseId||'') ||
     !['dismiss','acknowledge'].includes(input.action) ||
     typeof input.note!=='string' || input.note.trim().length<5 ||
     input.note.length>300)
    return response(400,'invalid_resolution');

  const path='guardian_cases/'+input.caseId;
  const result=await firestore(creds.token,'/'+path);
  if(!result.ok)return response(result.code,'case_unavailable');
  const doc=result.data;
  if(!doc?.updateTime || doc.name!==ROOT+'/'+path ||
      asString(doc,'engine')!=='v2' ||
      !['review','warned'].includes(asString(doc,'status')))
    return response(409,'not_pending');
  const owner=asString(doc,'ownerUid');
  const target=asString(doc,'targetPath');
  const sourceRevision=asString(doc,'sourceUpdateTime');
  if(!ID.test(owner)||owner===creds.uid||!TARGET.test(target)||
     !sourceRevision || asString(doc,'targetType')!==(target.includes('/replies/')?'reply':'post'))
    return response(409,'invalid_source');
  const source=await firestore(creds.token,'/'+target);
  if(!source.ok)return response(source.code,'source_unavailable');
  if(source.data?.name!==ROOT+'/'+target ||
     source.data?.updateTime!==sourceRevision ||
     asString(source.data,'uid')!==owner)
    return response(409,'source_changed');

  const at=new Date().toISOString();
  const status=input.action==='dismiss'?'dismissed':'acknowledged';
  const stringValue=v=>({stringValue:v});
  const timestampValue=v=>({timestampValue:v});
  const fields={
    status:stringValue(status),reviewedBy:stringValue(creds.uid),
    reviewNote:stringValue(input.note.trim()),reviewedAt:timestampValue(at)
  };
  const message=status==='dismissed'
    ?'O aviso foi encerrado após análise humana, sem infração confirmada.'
    :'A administração concluiu a análise e registrou uma orientação educativa.';
  const auditId=input.caseId+'_'+status;
  const writes=[
    {update:{name:doc.name,fields},
      updateMask:{fieldPaths:Object.keys(fields)},
      currentDocument:{updateTime:doc.updateTime}},
    {update:{name:ROOT+'/guardian_audit/'+auditId,
      fields:{caseId:stringValue(input.caseId),actor:stringValue(creds.uid),
        event:stringValue(status),at:timestampValue(at)}},
      currentDocument:{exists:false}},
    {update:{name:ROOT+'/guardian_notices/'+owner+'/items/'+input.caseId+'_resolved',
      fields:{title:stringValue('Átrio Guardião'),body:stringValue(message),
        caseId:stringValue(input.caseId),action:stringValue(status),
        createdAt:timestampValue(at)}},currentDocument:{exists:false}},
    {verify:ROOT+'/'+target,currentDocument:{updateTime:sourceRevision}}
  ];
  const commit=await firestore(creds.token,':commit','POST',{writes});
  if(!commit.ok)return response(commit.code,'resolution_not_committed');
  return response(200,status);
}
// Com ID token Firebase, o proprio Firestore valida todas as 3 mutacoes
// e a revisao do documento original. Nenhum segredo de servidor e armazenado.
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path==='/health' && request.method==='GET')
      return new Response(JSON.stringify({status:'guardian_v2_gateway_online',
        auth:'firebase_id_token',writeMode:'disabled'}),{status:200,headers:HEADERS});
    if(!['/admin/status','/admin/cases','/admin/resolve'].includes(path))
      return response(404,'not_found');
    if((path==='/admin/resolve' && request.method!=='POST') ||
       (path!=='/admin/resolve' && request.method!=='GET'))
      return response(405,'method_not_allowed');
    const creds=tokenAndUid(request);
    if(!creds)return response(401,'authentication_required');
    if(!await requireAdmin(creds))return response(403,'forbidden');
    return path==='/admin/status'?status(creds):path==='/admin/cases'?cases(creds):resolveCase(request,env,creds);
  }
};
