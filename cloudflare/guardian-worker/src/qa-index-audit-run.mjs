// Run only from the dedicated QA GitHub Actions environment with WIF.
import {readQaIndexes} from './qa-index-audit.js';
import {probeQaRepliesIndex} from './qa-query-probe.js';
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
 }else {
  // Only when metadata says READY: execute the actual collection-group query.
  // REST runQuery uses POST for READS. No writes, no user fields or IDs logged.
  const probe=await probeQaRepliesIndex({
   project:process.env.QA_FIREBASE_PROJECT_ID,
   approved:process.env.QA_APPROVED_PROJECT_ID,
   accessToken:process.env.QA_ACCESS_TOKEN
  });
  console.log('guardian_qa_replies_query_probe',JSON.stringify(probe));
  if(probe.status!=='query_ok'){
   console.error('::error::Índices READY mas consulta paginada QA ainda não validada.');
   process.exitCode=1;
  }else console.log('GUARDIAN_QA_INDEXES_ALL_READY_AND_QUERY_OK');
 }
}
