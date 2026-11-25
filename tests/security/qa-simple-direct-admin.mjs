// Default = read only. Never deploys rules or changes configuration/IAM.
import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {initializeFirestore,FieldValue} from 'firebase-admin/firestore';
import {project,operator,chatId,uids,appId,packageName,prepare,classifyRules,validConfig,
 validAge,validAdmission,assertNoEmulator,assertOperator,closeOperator,withOperator,restorePair}
 from './qa-simple-direct-admin-core.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
const fail=(ok,code)=>{if(!ok)throw Error(code)};
const [mode='preflight',arg,extra]=process.argv.slice(2);
if(mode==='prepare'){
 fail(arg&&!extra,'usage_prepare_new_directory');
 console.log(JSON.stringify(prepare(arg),null,2));
}else{
 fail(['preflight','restore','publish','cleanup'].includes(mode)&&!extra&&
  (mode==='publish'?/^[A-Za-z0-9_-]{1,128}$/.test(arg??''):arg===undefined),'invalid_command');
 assertNoEmulator();
 const credential=applicationDefault();
 const app=initializeApp({projectId:project,credential});
 const auth=getAuth(app),db=initializeFirestore(app,{preferRest:true});
 let stage='adc';
 try{
  const access=(await credential.getAccessToken()).access_token;
  const json=async(url,options={})=>{
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),...options});
   if(!response.ok)throw Error('http_'+response.status);
   return response.json();
  };
  const google=url=>json(url,{headers:{Authorization:'Bearer '+access,'x-goog-user-project':project}});
  stage='operator_identity';
  const principal=await google('https://www.googleapis.com/oauth2/v2/userinfo');
  const user=await auth.getUser(operator);
  assertOperator(user,principal,mode!=='cleanup');
  if(mode==='cleanup'){
   await closeOperator(auth);
   console.log('OPERADOR DESATIVADO, CLAIMS REMOVIDAS, SESSOES REVOGADAS');
  }else{
   stage='rules';
   const release=await google('https://firebaserules.googleapis.com/v1/projects/'+project+'/releases/cloud.firestore');
   fail(release.name==='projects/'+project+'/releases/cloud.firestore'&&release.rulesetName?.startsWith('projects/'+project+'/rulesets/'),'wrong_rules_project');
   const rs=await google('https://firebaserules.googleapis.com/v1/'+release.rulesetName);
   fail(rs.source?.files?.length===1,'unexpected_rules_files');
   const rules=classifyRules(release.rulesetName,rs.source.files[0].content);
   const doc=path=>db.doc(path).get();
   const readAge=uid=>doc('users/'+uid+'/chatAgeEligibility/current');
   const readAdmission=uid=>doc('users/'+uid+'/chatPushAdmission/current');
   stage='configuration';
   const cfg=(await doc('app_config/conversations')).data();
   const controls=await Promise.all(['serverInboxControl/writeBoundary','serverInboxControl/pagination'].map(doc));
   const blocks=await Promise.all(uids.map((uid,i)=>doc('users/'+uid+'/blockedMembers/'+uids[1-i])));
   const records=await Promise.all(uids.map(async uid=>{
    const [account,age,admission,devices]=await Promise.all([auth.getUser(uid),readAge(uid),readAdmission(uid),
     db.collection('users/'+uid+'/pushDevices').limit(5).get()]);
    fail(account.email===identity.accounts[uid]&&account.emailVerified===true&&!account.disabled,'qa_account_mismatch');
    return {uid,age,admission,deviceCount:devices.size};
   }));
   stage='auth_config';
   const authConfig=await google('https://identitytoolkit.googleapis.com/admin/v2/projects/'+project+'/config');
   const passwordEnabled=authConfig.signIn?.email?.enabled===true&&authConfig.signIn.email.passwordRequired===true;
   stage='android_config';
   const config=await google('https://firebase.googleapis.com/v1beta1/projects/'+project+'/androidApps/'+appId+'/config');
   const client=JSON.parse(Buffer.from(config.configFileContents,'base64').toString('utf8'));
   fail(client.project_info?.project_id===project,'wrong_android_project');
   const matching=client.client?.filter(c=>c.client_info?.mobilesdk_app_id===appId&&c.client_info?.android_client_info?.package_name===packageName)??[];
   fail(matching.length===1,'wrong_android_app');
   const apiKey=matching[0].api_key?.[0]?.current_key;
   fail(typeof apiKey==='string'&&apiKey.length>20,'missing_api_key');
   const baseReady=validConfig(cfg)&&!controls.some(d=>d.exists)&&!blocks.some(d=>d.exists);
   console.log(JSON.stringify({project,rules,configurationValid:validConfig(cfg),
    directEnabled:cfg?.qaSimpleDirectEnabled===true,managedBoundary:controls.some(d=>d.exists),
    bilateralBlock:blocks.some(d=>d.exists),operatorDisabled:user.disabled,passwordEnabled,
    androidConfigVerified:true,accounts:records.map(r=>({uid:r.uid,age:r.age.data()?.status??'missing',
     ageValid:validAge(r.age.data()),admissionValid:validAdmission(r.admission,r.age,r.uid),
     continuous:r.admission.data()?.expiresAt===null,deviceCount:r.deviceCount})),
    mode,remoteWrites:mode==='preflight'?false:'explicit_operation'},null,2));
   if(mode!=='preflight'){
    stage='mutation_guard';
    fail(rules==='candidate'&&cfg?.qaSimpleDirectEnabled===true&&baseReady&&passwordEnabled,'qa_not_ready_for_mutation');
    const signIn=(key,email,password)=>json('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(key),
     {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
    const capabilities=mode==='restore'?['manage_age18_restoration','consume_age18_restoration','manage_admissions']:['publish_notices'];
    let operation;
    if(mode==='restore'){
     fail(records.every(r=>r.age.data()?.status==='revoked'&&r.age.data()?.policyVersion==='2026-11-18plus-qa-v1'&&r.admission.exists),
      'restore_precondition_changed');
     operation=execute=>restorePair({execute,readAge,readAdmission});
    }else{
     const room=(await doc('chats/'+chatId)).data();
     const event=(await doc('chats/'+chatId+'/messages/'+arg)).data();
     fail(room?.status==='accepted'&&room.lastMessageId===arg&&room.lastSenderUid===event?.uid&&uids.includes(event.uid),'not_latest_canonical_message');
     const sender=records.find(r=>r.uid===event.uid),recipient=records.find(r=>r.uid!==event.uid);
     fail(records.every(r=>validAdmission(r.admission,r.age,r.uid))&&recipient.deviceCount>0,'push_admission_or_device_missing');
     const mute=(await doc('users/'+recipient.uid+'/chatBox/'+chatId)).data();
     fail(!mute||mute.muted===false,'recipient_muted');
     const expiry=Math.min(Date.now()+120_000,...records.map(r=>r.age.data().reviewExpiresAt.toMillis()),
      ...records.map(r=>r.admission.data().expiresAt===null?Infinity:r.admission.data().expiresAt.toMillis()),
      cfg.pushPilot.expiresAt===null?Infinity:cfg.pushPilot.expiresAt.toMillis());
     fail(expiry>Date.now()+10_000,'notice_window_too_short');
     operation=execute=>execute('publish',{senderUid:sender.uid,recipientUid:recipient.uid,
      conversationId:chatId,messageId:arg,expiresAt:new Date(expiry),
      expectedSenderGeneration:sender.admission.data().generation,expectedRecipientGeneration:recipient.admission.data().generation});
    }
    stage=mode;
    const result=await withOperator({auth,db,serverTimestamp:()=>FieldValue.serverTimestamp(),principal,apiKey,signIn,capabilities},operation);
    console.log(JSON.stringify(mode==='restore'?result:{noticePublished:true,replay:result.replay},null,2));
    console.log('OPERADOR DESATIVADO, CLAIMS REMOVIDAS, SESSOES REVOGADAS');
   }
  }
 }catch(e){
  // Never print API responses, credentials, session tokens, email, or message body.
  const code=typeof e?.message==='string'&&/^[a-z0-9_]{1,90}$/.test(e.message)?e.message:'operation_failed';
  console.error('QA abortado:',stage,code);
  process.exitCode=1;
 }finally{await deleteApp(app)}
}
