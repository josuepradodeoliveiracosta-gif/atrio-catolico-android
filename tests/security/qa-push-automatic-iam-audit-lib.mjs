// Read-only IAM inventory for an explicitly identified QA service account.
// No impersonation, secret reads, role grants, API activation or remote writes.
const project='atrio-catolico-qa-general';
const crm='https://cloudresourcemanager.googleapis.com/v1/';
const iam='https://iam.googleapis.com/v1/';
const validEmail=e=>typeof e==='string'&&/^[a-z][a-z0-9-]{4,29}@atrio-catolico-qa-general\.iam\.gserviceaccount\.com$/.test(e);
const roleName=r=>typeof r==='string'&&/^(roles\/[\w.]+|(?:projects|organizations)\/[\w-]+\/roles\/[\w.]+)$/.test(r);
const sensitive=['datastore.entities.get','datastore.entities.list','datastore.entities.create','datastore.entities.update','datastore.entities.delete','firebaseauth.users.get','firebaseauth.users.update','firebaseauth.users.create','firebaseauth.users.delete','cloudmessaging.messages.create','iam.serviceAccounts.getAccessToken','iam.serviceAccounts.signBlob','resourcemanager.projects.setIamPolicy','iam.serviceAccountKeys.create'];
export async function auditQaIdentity({email,request}={}){
 if(!validEmail(email)||typeof request!=='function')throw Error('invalid_qa_identity');
 const principal='serviceAccount:'+email,checks={},grants=[];
 async function read(label,url,body,projectResult){
  try{
   const res=await request({url,method:body?'POST':'GET',body});
   if(res?.status!==200){checks[label]={status:'unavailable',http:Number.isInteger(res?.status)?res.status:null};return null}
   checks[label]={status:'read',...projectResult(res.body)};return res.body;
  }catch{checks[label]={status:'unavailable'};return null}
 }
 const policyBody={options:{requestedPolicyVersion:3}};
 async function policy(label,url){
  return read(label,url,policyBody,p=>{
   if(!p||typeof p!=='object'||(p.bindings!==undefined&&!Array.isArray(p.bindings)))throw Error('invalid_policy');
   const bindings=p.bindings??[];
   const direct=bindings.filter(b=>roleName(b.role)&&Array.isArray(b.members)&&b.members.includes(principal));
   for(const b of direct)grants.push({source:label,role:b.role,conditional:!!b.condition});
   return {directRoles:direct.map(b=>({role:b.role,conditional:!!b.condition})),
    groupBindings:bindings.filter(b=>b.members?.some(m=>typeof m==='string'&&m.startsWith('group:'))).length,
    publicBindings:bindings.filter(b=>b.members?.some(m=>m==='allUsers'||m==='allAuthenticatedUsers')).length};
  });
 }
 const meta=await read('project',crm+'projects/'+project,null,x=>({identityMatches:x.projectId===project,parentType:x.parent?.type??null}));
 if(meta?.projectId!==project)return {project,remoteWrites:false,gate:'blocked_project_identity',checks};
 await read('billing','https://cloudbilling.googleapis.com/v1/projects/'+project+'/billingInfo',null,
  x=>({billingEnabled:typeof x.billingEnabled==='boolean'?x.billingEnabled:null}));
 const acct=iam+'projects/'+project+'/serviceAccounts/'+encodeURIComponent(email);
 await read('account',acct,null,x=>({identityMatches:x.email===email,disabled:typeof x.disabled==='boolean'?x.disabled:x.disabled===undefined?false:null}));
 await read('keyMetadata',acct+'/keys?keyTypes=USER_MANAGED',null,x=>({userManagedKeyCount:Array.isArray(x.keys)?x.keys.length:0}));
 await read('accountIam',acct+':getIamPolicy',policyBody,x=>({bindings:(x.bindings??[]).map(b=>({role:b.role,conditional:!!b.condition,memberCount:b.members?.length??0,publicMembers:(b.members??[]).filter(m=>m==='allUsers'||m==='allAuthenticatedUsers').length}))}));
 await policy('projectIam',crm+'projects/'+project+':getIamPolicy');
 let parent=meta.parent,ancestorsComplete=false;
 for(let i=0;i<12;i++){
  if(parent==null){ancestorsComplete=true;break}
  if(!/^\d+$/.test(parent.id??''))break;
  if(parent.type==='organization'){
   const p=await policy('organizationIam',crm+'organizations/'+parent.id+':getIamPolicy');
   ancestorsComplete=!!p;break;
  }
  if(parent.type!=='folder')break;
  const folder='https://cloudresourcemanager.googleapis.com/v2/folders/'+parent.id;
  if(!await policy('folderIam'+i,folder+':getIamPolicy'))break;
  const f=await read('folder'+i,folder,null,x=>({parentType:typeof x.parent==='string'?x.parent.split('/')[0]:null}));
  const m=/^(folders|organizations)\/(\d+)$/.exec(f?.parent??'');
  if(!m)break;parent={type:m[1]==='folders'?'folder':'organization',id:m[2]};
 }
 const roles=[...new Set(grants.map(g=>g.role))];
 for(let i=0;i<Math.min(roles.length,40);i++){
  const role=roles[i];
  await read('role'+i,iam+role,null,x=>({role,permissionsObserved:Array.isArray(x.includedPermissions),
   relevantPermissions:sensitive.filter(p=>x.includedPermissions?.includes(p))}));
 }
 return {project,remoteWrites:false,gate:'review_required',checks,grants,
  ancestorTraversalComplete:ancestorsComplete,roleDefinitionsComplete:roles.length<=40&&roles.every((_,i)=>checks['role'+i]?.status==='read'&&checks['role'+i]?.permissionsObserved===true),
  workerSecretIdentityVerified:false,groupMembershipReviewed:false,denyPoliciesReviewed:false,
  crossProjectPermissionsReviewed:false,effectivePermissionsVerified:false};
}
