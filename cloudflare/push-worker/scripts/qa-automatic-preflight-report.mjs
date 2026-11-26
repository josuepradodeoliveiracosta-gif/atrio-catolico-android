// Offline only. Read an explicit JSON evidence file, never contact a provider,
// invoke a shell, inspect credentials or change any remote resource.
import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {reviewQaAutomaticPreflight} from './qa-automatic-preflight-review.mjs';

const expected=Object.freeze({
 observedAt:null,projectId:'atrio-catolico-qa-general',workerName:'atrio-push-qa-general',
 databaseId:'dc88db76-99c2-46d0-b5e3-df68152c564d',
 workersPlan:null,firebaseBillingEnabled:null,deploymentId:null,versionId:null,singleVersion:null,cronCount:null,
 firestoreReadsRemaining:null,d1RowsReadRemaining:null,d1RowsWrittenRemaining:null,workerRequestsRemaining:null,
 secretIdentityVerified:false,effectivePermissionsVerified:false,noFirestoreWritePermission:false,authRevocationVerified:false,qaDevicesVerified:false,
 manualQuiesced:false,pendingDrained:false,rollbackVerified:false,abuseProtectionVerified:false,metricsAvailable:false,explicitTrialApproval:false
});
export function evidenceTemplate(){return {...expected}}
export function reportEvidence(e,now=Date.now()){
 if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).some(k=>!Object.hasOwn(expected,k)))throw Error('invalid_evidence_fields');
 // Reject structured values and excessively long strings; output only the
 // named checks and their status, never echo submitted values.
 for(const v of Object.values(e)){
  if(v!==null&&(!['string','number','boolean'].includes(typeof v)||(typeof v==='string'&&v.length>128)))throw Error('invalid_evidence_value');
 }
 const report=reviewQaAutomaticPreflight(e,now);
 return {...report,source:'operator_supplied_unverified',independentVerification:false};
}
function main(args){
 if(args.length===1&&args[0]==='--template'){
  console.log(JSON.stringify(evidenceTemplate(),null,2));return;
 }
 if(args.length!==1||args[0].startsWith('-'))throw Error('use_explicit_json_path_or_template');
 const file=resolve(args[0]),stat=statSync(file);
 if(!stat.isFile()||stat.size>16384)throw Error('invalid_evidence_file');
 const report=reportEvidence(JSON.parse(readFileSync(file,'utf8')));
 console.log(JSON.stringify(report,null,2));
 if(report.status!=='ready_for_human_review')process.exitCode=2;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{main(process.argv.slice(2))}catch{console.error('Relatório inválido. Use --template ou informe o arquivo JSON de evidências; nunca inclua credenciais.');process.exitCode=1}
}
