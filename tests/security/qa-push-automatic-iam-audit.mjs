// Local only. Pass a verified service account EMAIL, never its JSON key.
import {applicationDefault} from 'firebase-admin/app';
import {auditQaIdentity} from './qa-push-automatic-iam-audit-lib.mjs';
const project='atrio-catolico-qa-general';
for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_EMULATOR_HUB'])
 if(process.env[name])throw Error('unexpected_emulator');
for(const name of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])
 if(process.env[name]&&process.env[name]!==project)throw Error('unexpected_project');
const [email]=process.argv.slice(2);
if(process.argv.length!==3||!/^[a-z][a-z0-9-]{4,29}@atrio-catolico-qa-general\.iam\.gserviceaccount\.com$/.test(email??''))
 throw Error('Informe somente o email da conta de serviço QA, nunca a chave');
try{
 const {access_token:token}=await applicationDefault().getAccessToken();
 if(!token)throw Error('adc_unavailable');
 const result=await auditQaIdentity({email,request:async({url,method,body})=>{
  const res=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),
   headers:{Authorization:'Bearer '+token,'x-goog-user-project':project,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  return {status:res.status,body:res.ok?await res.json():null};
 }});
 console.log(JSON.stringify(result,null,2));
}catch{console.error('Auditoria indisponível: ADC ou consulta falhou. Nenhuma alteração remota.');process.exitCode=1}
