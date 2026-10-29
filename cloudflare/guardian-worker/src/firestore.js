// REST Firestore service-account adapter. Never bundle credentials in Android.
const PROJECT='atrio-catolico';
const API='https://firestore.googleapis.com/v1';
const ROOT=API+'/projects/'+PROJECT+'/databases/(default)/documents';
const RESOURCE='projects/'+PROJECT+'/databases/(default)/documents';
const projectValid=id=>typeof id==='string' && /^[a-z][a-z0-9-]{4,29}$/.test(id);
const IDENT=/^[A-Za-z0-9_-]{1,128}$/;
const field=(doc,key)=>doc?.fields?.[key];
export const string=(doc,key)=>field(doc,key)?.stringValue||'';
export const bool=(doc,key)=>field(doc,key)?.booleanValue===true;
export const str=v=>({stringValue:v});
export const timestamp=v=>({timestampValue:v});
export const enc=encodeURIComponent;
export const pathOf=doc=>doc?.name?.split('/documents/')[1]||'';
const b64url=bytes=>{const s=(typeof bytes==='string'?new TextEncoder().encode(bytes):new Uint8Array(bytes));let b='';for(const c of s)b+=String.fromCharCode(c);return btoa(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
let cached;
export async function token(env) {
  const intended=env.GUARDIAN_FIREBASE_PROJECT_ID;
  if(!projectValid(intended))throw Error('service_not_configured');
  if(intended===PROJECT && env.GUARDIAN_V2_PRODUCTION_APPROVED!=='true')
    throw Error('production_access_not_approved');
  if(cached?.project===intended && cached.exp>Date.now()+60_000)return cached.value;
  const config=JSON.parse(env.GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON||'null');
  if(!projectValid(intended)||config?.project_id!==intended||!config.client_email||!config.private_key)
    throw Error('service_not_configured');
  const der=Uint8Array.from(atob(config.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const iat=Math.floor(Date.now()/1000);
  const signed=b64url(JSON.stringify({alg:'RS256',typ:'JWT'}))+'.'+b64url(JSON.stringify({iss:config.client_email,sub:config.client_email,aud:'https://oauth2.googleapis.com/token',scope:'https://www.googleapis.com/auth/datastore',iat,exp:iat+900}));
  const sig=b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(signed)));
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signed+'.'+sig})});
  if(!response.ok)throw Error('service_auth_failed');const data=await response.json();
  if(!data.access_token)throw Error('service_token_missing');
  cached={project:intended,value:data.access_token,exp:Date.now()+Math.min(600_000,Number(data.expires_in||900)*1000-60_000)};return cached.value;
}
export class Firestore {
  constructor(access,project=PROJECT,api=API){
    if(!projectValid(project)||!['https://firestore.googleapis.com/v1','http://127.0.0.1:8089/v1'].includes(api))throw Error('invalid_backend');
    this.access=access;this.project=project;this.root=api+'/projects/'+project+'/databases/(default)/documents';
    // REST endpoint (root) and Firestore resource names (resource) are different.
    this.resource='projects/'+project+'/databases/(default)/documents';
  }
  async send(path,method='GET',payload){
    const r=await fetch(this.root+path,{method,headers:{Authorization:'Bearer '+this.access,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});
    if(r.status===404 && method==='GET')return null;
    if(!r.ok){
      // Firestore REST uses 400/409/412 for optimistic-write precondition failures.
      // Only map documented concurrency codes; do not mask INVALID_ARGUMENT.
      let reason='';
      try{reason=(await r.json()).error?.status||'';}catch{}
      const conflict=['ALREADY_EXISTS','FAILED_PRECONDITION','ABORTED'].includes(reason);
      const e=Error('firestore_'+(conflict?'conflict':'http_'+r.status));
      e.status=conflict?409:r.status;
      throw e;
    }
    return r.status===204?{}:r.json();
  }
  get(path){return this.send('/'+path.split('/').map(enc).join('/'));}
  async scan(group,minutes=20,max=80){
    if(!['posts','replies','reports'].includes(group))throw Error('invalid_group');
    const cut=new Date(Date.now()-minutes*60_000).toISOString();
    const sq={structuredQuery:{from:[{collectionId:group,allDescendants:group==='replies'}],where:{fieldFilter:{field:{fieldPath:'createdAt'},op:'GREATER_THAN_OR_EQUAL',value:timestamp(cut)}},orderBy:[{field:{fieldPath:'createdAt'},direction:'DESCENDING'}],limit:max}};
    const result=await this.send(':runQuery','POST',sq);
    if(!Array.isArray(result))throw Error('invalid_scan');
    return result.map(x=>x.document).filter(Boolean);
  }
  // Strict read-only remote QA query: synthetic fixture flag checked by Firestore.
  // Use only via shadow scan, never general production moderation.
  async scanQa(group,minutes=20,max=15){
    if(!/^atrio-catolico-qa(?:-[a-z0-9-]+)?$/.test(this.project) || this.project.length>30)
      throw Error('qa_project_required');
    if(!['posts','replies','reports'].includes(group) || minutes<1 || minutes>20 ||
      !Number.isInteger(max) || max<1 || max>15)throw Error('qa_limits_invalid');
    const cut=new Date(Date.now()-minutes*60_000).toISOString();
    const eq={fieldFilter:{field:{fieldPath:'qaFixture'},op:'EQUAL',value:{booleanValue:true}}};
    const recent={fieldFilter:{field:{fieldPath:'createdAt'},op:'GREATER_THAN_OR_EQUAL',value:timestamp(cut)}};
    const columns=group==='reports'?['qaFixture']:['body','title','qaFixture'];
    const sq={structuredQuery:{
      from:[{collectionId:group,allDescendants:group==='replies'}],
      select:{fields:columns.map(fieldPath=>({fieldPath}))},
      where:{compositeFilter:{op:'AND',filters:[eq,recent]}},
      orderBy:[{field:{fieldPath:'createdAt'},direction:'DESCENDING'}],
      limit:max
    }};
    const result=await this.send(':runQuery','POST',sq);
    if(!Array.isArray(result))throw Error('invalid_qa_query');
    return result.map(x=>x.document).filter(Boolean);
  }
  commit(writes){return this.send(':commit','POST',{writes});}
  async create(path,fields){return this.commit([{update:{name:this.resource+'/'+path,fields},currentDocument:{exists:false}}]);}
  async update(path,fields,oldTime){const keys=Object.keys(fields);return this.commit([{update:{name:this.resource+'/'+path,fields},updateMask:{fieldPaths:keys},currentDocument:{updateTime:oldTime}}]);}
}
export async function actorId(request,env){
  const m=/^Bearer ([A-Za-z0-9._-]{100,5000})$/.exec(request.headers.get('authorization')||'');
  if(!m||!env.FIREBASE_WEB_API_KEY)return null;
  const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+enc(env.FIREBASE_WEB_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:m[1]})});
  if(!r.ok)return null;const user=(await r.json()).users?.[0];return user&&!user.disabled&&IDENT.test(user.localId)?user.localId:null;
}
export async function caseId(path){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('atrio-guardian-v2:'+path)));return 'guard_'+[...digest].slice(0,16).map(n=>n.toString(16).padStart(2,'0')).join('');}
export {ROOT,RESOURCE};