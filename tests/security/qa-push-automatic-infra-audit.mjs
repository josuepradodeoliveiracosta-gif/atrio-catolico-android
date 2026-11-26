// Read-only Google Cloud inventory. Run locally using existing ADC.
// Never print tokens, principal names, raw IAM policies, user data or secret values.
import {applicationDefault} from 'firebase-admin/app';
const project='atrio-catolico-qa-general';
const scope='https://www.googleapis.com/auth/cloud-platform';
const checks={};
for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_EMULATOR_HUB'])
 if(process.env[name])throw Error('unexpected_emulator');
for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])
 if(process.env[name]&&process.env[name]!==project)throw Error('unexpected_project');
const adc=applicationDefault();
const {access_token:token}=await adc.getAccessToken();
if(!token)throw Error('adc_unavailable');
const headers={Authorization:'Bearer '+token,'x-goog-user-project':project};
const safeRole=r=>typeof r==='string'&&/^(roles\/[\w.]+|(?:projects|organizations)\/[\w-]+\/roles\/[\w.]+)$/.test(r);
async function read(name,url,projectResult,body){
 try{
  const r=await fetch(url,{method:body?'POST':'GET',redirect:'error',
   headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  if(!r.ok){checks[name]={status:'unavailable',http:r.status};return null}
  const value=await r.json();
  checks[name]={status:'read',...projectResult(value)};
  return value;
 }catch{checks[name]={status:'unavailable',reason:'request_or_response_failed'};return null}
}
const crm='https://cloudresourcemanager.googleapis.com/v1/projects/'+project;
const meta=await read('project',crm,x=>({identityMatches:x.projectId===project,lifecycle:x.lifecycleState,
 parentType:x.parent?.type??null}));
if(meta?.projectId!==project){console.log(JSON.stringify({project,remoteWrites:false,checks},null,2));process.exitCode=1}
else{
 await read('database','https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)',
  x=>({identityMatches:x.name==='projects/'+project+'/databases/(default)',location:x.locationId,type:x.type}));
 await read('billing','https://cloudbilling.googleapis.com/v1/projects/'+project+'/billingInfo',
  x=>({billingEnabled:x.billingEnabled===true}));
 const needed=['firestore.googleapis.com','cloudfunctions.googleapis.com','run.googleapis.com','eventarc.googleapis.com',
  'pubsub.googleapis.com','cloudtasks.googleapis.com','cloudscheduler.googleapis.com','iam.googleapis.com',
  'iamcredentials.googleapis.com','identitytoolkit.googleapis.com','fcm.googleapis.com'];
 const services=new Set();let pageToken='',serviceComplete=false,serviceFailed=false;
 for(let i=0;i<10;i++){
  const url=new URL('https://serviceusage.googleapis.com/v1/projects/'+project+'/services');
  url.searchParams.set('filter','state:ENABLED');url.searchParams.set('pageSize','200');
  if(pageToken)url.searchParams.set('pageToken',pageToken);
  const data=await read('serviceUsagePage',url.toString(),x=>({entries:x.services?.length??0}));
  if(!data){serviceFailed=true;break}
  for(const x of data.services??[])if(typeof x.config?.name==='string')services.add(x.config.name);
  pageToken=data.nextPageToken??'';
  if(!pageToken){serviceComplete=true;break}
 }
 checks.services={status:serviceComplete?'read':'partial',requestFailed:serviceFailed,
  enabledRelevant:needed.filter(x=>services.has(x)),
  notObserved:needed.filter(x=>!services.has(x)),complete:serviceComplete};
 // getIamPolicy uses POST but is a read-only IAM operation.
 const policy=await read('projectIam',crm+':getIamPolicy',x=>{
  const entries=(x.bindings??[]).filter(b=>safeRole(b.role));
  return {bindingCount:entries.length,conditionalCount:entries.filter(b=>!!b.condition).length,
   roles:entries.map(b=>({role:b.role,conditional:!!b.condition,
    serviceAccountMembers:(b.members??[]).filter(m=>m.startsWith('serviceAccount:')).length,
    publicMembers:(b.members??[]).filter(m=>m==='allUsers'||m==='allAuthenticatedUsers').length})),
   inheritedPoliciesReviewed:false};
 },{options:{requestedPolicyVersion:3}});
 let accountPageToken='',complete=false;
 const accounts=[];
 for(let i=0;i<10;i++){
  const url=new URL('https://iam.googleapis.com/v1/projects/'+project+'/serviceAccounts');
  url.searchParams.set('pageSize','100');if(accountPageToken)url.searchParams.set('pageToken',accountPageToken);
  const data=await read('serviceAccountsPage',url.toString(),x=>({entries:x.accounts?.length??0}));
  if(!data)break;
  accounts.push(...(data.accounts??[]));accountPageToken=data.nextPageToken??'';
  if(!accountPageToken){complete=true;break}
 }
 const candidates=accounts.filter(a=>typeof a.email==='string'&&
  /^(atrio-qa-general-push|atrio-qa-auto-[a-z0-9-]+)@atrio-catolico-qa-general\.iam\.gserviceaccount\.com$/.test(a.email));
 checks.serviceAccounts={status:complete?'read':'partial',count:accounts.length,
  candidateCount:candidates.length,complete,accounts:candidates.map(a=>({
   name:a.email.split('@')[0],disabled:a.disabled===true,
   directProjectRoles:(policy?.bindings??[]).filter(b=>safeRole(b.role)&&
    b.members?.includes('serviceAccount:'+a.email)).map(b=>({role:b.role,conditional:!!b.condition}))
  }))};
 for(const a of candidates){
  const name=a.email.split('@')[0];
  const url='https://iam.googleapis.com/v1/projects/'+project+'/serviceAccounts/'+encodeURIComponent(a.email);
  await read('accountIam:'+name,url+':getIamPolicy',x=>({
   roles:(x.bindings??[]).filter(b=>safeRole(b.role)).map(b=>({role:b.role,
    conditional:!!b.condition,memberCount:b.members?.length??0,
    publicMembers:(b.members??[]).filter(m=>m==='allUsers'||m==='allAuthenticatedUsers').length}))
  }),{options:{requestedPolicyVersion:3}});
  await read('accountKeys:'+name,url+'/keys?keyTypes=USER_MANAGED',
   x=>({userManagedKeyCount:x.keys?.length??0}));
 }
 await read('functions','https://cloudfunctions.googleapis.com/v2/projects/'+project+'/locations/-/functions',
  x=>({count:x.functions?.length??0,complete:!x.nextPageToken,
   automaticNamedCount:(x.functions??[]).filter(f=>/push.*auto|auto.*push/i.test(f.name??'')).length}));
 await read('rulesRelease','https://firebaserules.googleapis.com/v1/projects/'+project+'/releases/cloud.firestore',
  x=>({identityMatches:x.name==='projects/'+project+'/releases/cloud.firestore',
   rulesetName:x.rulesetName}));
 console.log(JSON.stringify({project,remoteWrites:false,gate:'review_required',
  inheritedAndCrossProjectPermissionsVerified:false,checks},null,2));
}
