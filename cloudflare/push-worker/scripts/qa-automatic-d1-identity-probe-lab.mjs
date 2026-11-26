// Private identity diagnostic. No route, scheduled handler, default fetch,
// D1 binding, raw credentials or provider response in the returned report.
import {createD1HttpLab} from './qa-automatic-d1-http-lab.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
const root='https://firestore.googleapis.com/v1/projects/'+identity.projectId+'/databases/'+identity.databaseId+'/documents';
const oauth='https://oauth2.googleapis.com/token';
const auth='https://identitytoolkit.googleapis.com/v1/projects/'+identity.projectId+'/accounts:lookup';
const expected='atrio-qa-general-push@'+identity.projectId+'.iam.gserviceaccount.com';
const uids=Object.keys(identity.accounts);
const validTx=x=>typeof x==='string'&&/^[A-Za-z0-9+/=_-]{1,4096}$/.test(x);
export async function probeQaIdentityLab({enabled=false,env,fetchImpl}={}){
 const report={status:'blocked',projectMatches:false,accountMatches:false,oauthAccepted:false,
  readOnlyTransactionOpened:false,readOnlyTransactionClosed:false,qaAccountsVerified:false,
  externalAttempts:0,firestoreWrites:0,fcmAttempts:0,activationAuthorized:false};
 if(enabled!==true||typeof fetchImpl!=='function')return report;
 let serviceAccount;
 try{serviceAccount=JSON.parse(env?.QA_FIREBASE_SERVICE_ACCOUNT_JSON??'null')}catch{return report}
 report.projectMatches=serviceAccount?.project_id===identity.projectId;
 report.accountMatches=serviceAccount?.client_email===expected;
 if(!report.projectMatches||!report.accountMatches)return report;
 const destinations=[oauth,root+':beginTransaction',root+':rollback',auth];
 const http=createD1HttpLab({enabled:true,kind:'tick',serviceAccount,webApiKey:env?.QA_FIREBASE_WEB_API_KEY,
  fetchImpl:async(url,init)=>{
   if(destinations[report.externalAttempts]!==url||init?.method!=='POST'||init.redirect!=='manual')throw Error('probe_destination_denied');
   report.externalAttempts++;
   const r=await fetchImpl(url,init);
   if(url===oauth&&r?.status===200)report.oauthAccepted=true;
   return r;
  }});
 const read=(suffix,body)=>http.transport({url:root+suffix,method:'POST',redirect:'error',body});
 try{
  const begin=await read(':beginTransaction',{options:{readOnly:{}}});
  if(begin.status!==200||!validTx(begin.body?.transaction))return report;
  report.readOnlyTransactionOpened=true;
  const closed=await read(':rollback',{transaction:begin.body.transaction});
  if(closed.status!==200)return report;
  report.readOnlyTransactionClosed=true;
  const accounts=await http.lookupAccounts(uids);
  if(!uids.every(uid=>accounts[uid]?.uid===uid&&accounts[uid].email===identity.accounts[uid]&&accounts[uid].emailVerified===true&&accounts[uid].disabled===false))return report;
  report.qaAccountsVerified=true;
  report.status='probe_passed';
 }catch{/* no response, error, assertion, token or identity data escapes */}
 return report;
}
