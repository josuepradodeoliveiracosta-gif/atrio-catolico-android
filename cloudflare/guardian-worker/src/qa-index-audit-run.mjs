// Run only from the dedicated QA GitHub Actions environment with WIF.
import {readQaIndexes} from './qa-index-audit.js';
const result=await readQaIndexes({
 project:process.env.QA_FIREBASE_PROJECT_ID,
 approved:process.env.QA_APPROVED_PROJECT_ID,
 accessToken:process.env.QA_ACCESS_TOKEN
});
console.log('guardian_qa_indexes_audit',JSON.stringify(result));
if(result.status!=='observed'){
 console.error('::error::Não foi possível consultar índices do Firebase QA.');
 process.exitCode=1;
}else{
 const missing=result.composites.filter(x=>x.state!=='ready');
 if(result.repliesCreatedAtGroup!=='ready')missing.push({group:'replies_createdAt',state:result.repliesCreatedAtGroup});
 if(missing.length){
  console.log('::warning::Índice(s) QA ainda não pronto(s). Não implantar scanner.');
 }else console.log('GUARDIAN_QA_INDEXES_ALL_READY');
}
