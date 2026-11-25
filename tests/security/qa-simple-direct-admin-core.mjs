// Local only. No deployed handler, no service-account key, no public route.
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
import {reviewedSnapshot} from '../../firebase/qa-geral-celular/pilot/push-receiver-rules.mjs';
import {renderSimpleDirectRules} from '../../firebase/qa-geral-celular/pilot/simple-direct-rules.mjs';
import {createAuthenticatedConversationPushAdmin} from '../../firebase/qa-geral-celular/pilot/conversation-push-operator-auth.mjs';

export const project=identity.projectId;
export const operatorUserinfoUrl='https://www.googleapis.com/oauth2/v2/userinfo';
// Userinfo is an OAuth identity endpoint, not a project-billed Firebase API.
export function googleHeaders(url,access){
 const headers={Authorization:'Bearer '+access};
 if(url!==operatorUserinfoUrl)headers['x-goog-user-project']=project;
 return headers;
}
export const operator='qa-push-operator-local';
export const chatId='qa-nav-alice__qa-nav-bob';
export const uids=Object.keys(identity.accounts);
export const appId='1:835727158563:android:4258e81cc0ccc4df5cb096';
export const packageName='br.com.atriocatolico.qageral.celular';
export const dbId='dc88db76-99c2-46d0-b5e3-df68152c564d';
export const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
export const baseline=reviewedSnapshot();
export const candidate=renderSimpleDirectRules(baseline);
export const candidateHash=hash(candidate);
const policy='2026-11-18plus-qa-v1';
const ms=t=>t?.toMillis?.()??NaN;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const password=()=>randomBytes(48).toString('base64url')+'!Aa9';
const requireOk=(ok,code)=>{if(!ok)throw Error(code)};
export function assertNoEmulator(env=process.env){
 for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_EMULATOR_HUB'])
  requireOk(!env[name],'unexpected_emulator');
 for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])
  requireOk(!env[name]||env[name]===project,'unexpected_project');
}
export function prepare(folder){
 mkdirSync(folder,{mode:0o700});
 const save=(name,contents)=>writeFileSync(join(folder,name),contents,{flag:'wx',mode:0o600});
 save('candidate.rules',candidate);
 save('rollback.rules',baseline.source);
 save('d1-identity.sql',"CREATE TABLE IF NOT EXISTS atrio_qa_identity (name TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL);\nINSERT OR IGNORE INTO atrio_qa_identity (name,project_id) VALUES ('atrio-qa-conversations-pilot','atrio-catolico-qa-general');\nSELECT name,project_id FROM atrio_qa_identity;\n");
 const manifest={project,database:identity.databaseId,appId,packageName,round:identity.roundId,
  worker:'atrio-push-qa-general',d1:dbId,baselineRuleset:baseline.rulesetName,
  baselineSha256:baseline.sha256,candidateSha256:candidateHash,deployAuthorized:false};
 save('manifest.json',JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
export function classifyRules(name,source){
 requireOk(typeof name==='string'&&name.startsWith('projects/'+project+'/rulesets/'),'wrong_rules_project');
 if(name===baseline.rulesetName&&source===baseline.source)return 'baseline';
 if(source===candidate)return 'candidate';
 throw Error('unreviewed_remote_rules');
}
export function validConfig(c,now=Date.now()){
 const p=c?.pushPilot;
 return c?.enabled===true&&c.minorPolicyApproved===true&&c.version==='2026-11-v1'&&
  c.safetyReviewVersion==='2026-11-safety-v1'&&p?.enabled===true&&p.projectId===project&&
  p.databaseId===identity.databaseId&&p.roundId===identity.roundId&&p.ageMode===identity.ageMode&&
  (p.expiresAt===null||ms(p.expiresAt)>now);
}
export function validAge(proof,now=Date.now()){
 return proof?.status==='eligible'&&proof.minimumAge===18&&proof.policyVersion===policy&&
  Object.keys(proof).sort().join('|')==='minimumAge|policyVersion|reviewExpiresAt|status'&&
  ms(proof.reviewExpiresAt)>now;
}
// Firestore readTime is authoritative for persisted server timestamps, not the
// handset clock. Missing metadata fails closed; no future-time grace period.
function timestampOrder(a,b){
 if(!Number.isInteger(a?.seconds)||!Number.isInteger(b?.seconds)||
    !Number.isInteger(a?.nanoseconds)||!Number.isInteger(b?.nanoseconds)||
    a.nanoseconds<0||a.nanoseconds>=1e9||b.nanoseconds<0||b.nanoseconds>=1e9) return NaN;
 return Math.sign(a.seconds-b.seconds||a.nanoseconds-b.nanoseconds);
}
export function admissionChecks(doc,age,uid){
 const a=doc?.data(),p=age?.data();
 const now=Math.max(ms(doc?.readTime),ms(age?.readTime));
 return {
  serverReadTime:Number.isFinite(now),
  ageValid:Number.isFinite(now)&&validAge(p,now),
  active:a?.status==='active',
  identity:Object.hasOwn(identity.accounts,uid)&&a?.email===identity.accounts[uid],
  round:a?.roundId===identity.roundId,
  generation:uuid(a?.generation),
  notFuture:timestampOrder(a?.admittedAt,doc?.readTime)<=0,
  proofNotFuture:timestampOrder(age?.updateTime,age?.readTime)<=0,
  newerThanProof:timestampOrder(age?.updateTime,a?.admittedAt)<0,
  expiry:Number.isFinite(now)&&(a?.expiresAt===null||ms(a?.expiresAt)>now),
 };
}
export function validAdmission(doc,age,uid){
 return Object.values(admissionChecks(doc,age,uid)).every(Boolean);
}
export function assertOperator(user,principal,requireDisabled=true){
 requireOk(user?.uid===operator&&user.emailVerified===true&&principal?.verified_email===true&&
   principal.email===user.email&&typeof user.email==='string'&&
   (user.providerData??[]).every(p=>p.providerId==='password'),'operator_identity_mismatch');
 if(requireDisabled)requireOk(user.disabled===true&&Object.keys(user.customClaims??{}).length===0,'operator_not_closed');
}
export async function closeOperator(auth){
 const results=[];
 for(const action of [()=>auth.updateUser(operator,{disabled:true,password:password()}),
  ()=>auth.setCustomUserClaims(operator,null),()=>auth.revokeRefreshTokens(operator)]){
  try{await action();results.push(true)}catch{results.push(false)}
 }
 const u=await auth.getUser(operator);
 requireOk(results.every(Boolean)&&u.disabled===true&&Object.keys(u.customClaims??{}).length===0,'operator_cleanup_failed');
}
export async function withOperator({auth,db,serverTimestamp,principal,apiKey,signIn,capabilities},work){
 assertOperator(await auth.getUser(operator),principal);
 const secret=password();
 const deadline=Date.now()+5*60_000;
 try{
  await auth.setCustomUserClaims(operator,{atrioQaPushCapabilities:capabilities});
  await auth.updateUser(operator,{password:secret,disabled:false});
  const session=await signIn(apiKey,principal.email,secret);
  requireOk(session.localId===operator&&typeof session.idToken==='string','operator_signin_failed');
  const t=await auth.verifyIdToken(session.idToken,true);
  requireOk(t.uid===operator&&t.aud===project&&t.email===principal.email&&t.email_verified===true&&
    t.firebase?.sign_in_provider==='password'&&Array.isArray(t.atrioQaPushCapabilities)&&
    [...t.atrioQaPushCapabilities].sort().join('|')===[...capabilities].sort().join('|'),'operator_token_mismatch');
  const service=createAuthenticatedConversationPushAdmin({db,auth,serverTimestamp,projectId:project,
    allowedOperators:{[operator]:capabilities}});
  const execute=(action,payload)=>{
   requireOk(Date.now()<deadline,'operator_window_expired');
   return service.execute({authorization:'Bearer '+session.idToken,action,payload});
  };
  return await work(execute);
 }finally{await closeOperator(auth)}
}
export async function restorePair({execute,readAge,readAdmission,now=Date.now()}){
 const tickets=[],admissions=[];
 const reviewExpiresAt=new Date(now+24*60*60_000);
 const expiresAt=new Date(now+4*60_000);
 try{
  for(const uid of uids){
   const result=await execute('issueAge18',{uid,expiresAt,reviewExpiresAt});
   tickets.push({uid,tokenId:result.tokenId});
   await execute('consumeAge18',{uid,tokenId:result.tokenId});
  }
  for(const uid of uids){
   const previous=await readAdmission(uid);
   const result=await execute('admit',{uid,operationKey:randomUUID(),expectedGeneration:previous.data()?.generation??null,expiresAt:null});
   admissions.push({uid,generation:result.generation});
   const current=await readAdmission(uid),proof=await readAge(uid);
   const checks=admissionChecks(current,proof,uid);
   const failures=Object.keys(checks).filter(key=>!checks[key]);
   if(current.data()?.generation!==result.generation)failures.push('expectedGeneration');
   requireOk(failures.length===0,'admission_verification_failed_'+failures.join('_'));
  }
  return {restored:uids,reviewExpiresAt:reviewExpiresAt.toISOString(),admission:'continuous'};
 }catch(e){
  // Compensate only changes this invocation can identify; never restore prior generations.
  let clean=true;
  for(const {uid,generation} of admissions)try{
   await execute('revoke',{uid,operationKey:randomUUID(),expectedGeneration:generation});
  }catch{clean=false}
  for(const {uid,tokenId} of tickets)try{await execute('revokeAge18',{uid,tokenId})}catch{clean=false}
  if(!clean)throw Error('restore_partial_requires_audit');
  throw e;
 }
}
