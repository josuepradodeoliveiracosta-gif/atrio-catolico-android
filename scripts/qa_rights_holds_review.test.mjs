import test from 'node:test';
import assert from 'node:assert/strict';
import {auditQaRightsAndHolds,KINDS,CLASSES}
 from './qa_rights_holds_review.mjs';

const specimen=(extra={})=>({
 requestKind:'access',dataClass:'directMessages',
 requesterRelation:'self',identityEvidence:'synthetically-checked',
 openReport:false,legalHold:false,appeal:'none',
 childrenReviewed:true,...extra
});
const evalReq=(...xs)=>auditQaRightsAndHolds(xs);
function blocked(x){
 assert.equal(x.status,'NO_GO');
 assert.equal(x.actions,'none');
 for(const key of ['verifiedRequests','accessExportsProduced',
  'correctionsPerformed','erasuresPerformed','backupsChanged','noticesSent'])
  assert.equal(x[key],0);
 for(const key of ['policyApproved','realIdentityVerified',
  'deploymentAuthorized','deletionAuthorized'])
  assert.equal(x[key],false);
}
test('solicitação completa não vira acesso ou exportação de dados',()=>{
 const x=evalReq(specimen());blocked(x);assert.equal(x.stats.access,1);
});
test('pedido de exclusão jamais remove conteúdo ou backups',()=>{
 const x=evalReq(specimen({requestKind:'erasure',dataClass:'backups'}));
 blocked(x);assert.equal(x.stats.backupRequests,1);
 assert.equal(x.stats.erasure,1);
});
test('retenção legal e denúncia aberta exigem revisão humana',()=>{
 const x=evalReq(specimen({legalHold:true}),
  specimen({openReport:true}));blocked(x);
 assert.equal(x.stats.legalHoldOrReport,2);
});
test('sinais legais desconhecidos nunca equivalem à ausência',()=>{
 const x=evalReq(specimen({legalHold:null}),
  specimen({openReport:null}));blocked(x);
 assert.equal(x.stats.holdOrReportUnknown,2);
});
test('preservação confirmada prevalece sobre indicador desconhecido',()=>{
 const x=evalReq(specimen({legalHold:true,openReport:null}));
 blocked(x);assert.equal(x.stats.legalHoldOrReport,1);
 assert.equal(x.stats.holdOrReportUnknown,0);
});
test('recurso pendente exige preservação e revisão fora do laboratório',()=>{
 const x=evalReq(specimen({appeal:'pending',requestKind:'review'}));
 blocked(x);assert.equal(x.stats.appealPending,1);
 assert.equal(x.stats.review,1);
});
test('apelação desconhecida não é encerramento automático',()=>{
 const x=evalReq(specimen({appeal:'unknown'}));blocked(x);
 assert.equal(x.stats.appealUnknown,1);
});
test('origem do solicitante não verificada impede exportação ou correção',()=>{
 const x=evalReq(specimen({
  requesterRelation:'other',identityEvidence:'missing',
  requestKind:'correction'
 }));blocked(x);assert.equal(x.stats.requesterNotMatched,1);
 assert.equal(x.stats.identityUnconfirmed,1);
 assert.equal(x.stats.correction,1);
});
test('identidade desconhecida também não equivale à autenticação',()=>{
 const x=evalReq(specimen({identityEvidence:'unknown'}));blocked(x);
 assert.equal(x.stats.identityUnconfirmed,1);
});
test('subcoleções não revisadas impedem qualquer plano de eliminação',()=>{
 const x=evalReq(specimen({childrenReviewed:false}),
  specimen({childrenReviewed:null}));blocked(x);
 assert.equal(x.stats.childrenUnreviewed,1);
 assert.equal(x.stats.childrenUnknown,1);
});
test('protocolos de denúncia são contabilizados sem expor o conteúdo',()=>{
 const x=evalReq(specimen({dataClass:'directReports'}),
  specimen({dataClass:'groupReports'}));blocked(x);
 assert.equal(x.stats.reportRequests,2);
});
test('status de política fictícia não concede autorização',()=>{
 const x=auditQaRightsAndHolds([specimen()],{
  approved:true,legalReviewed:true,approvedBy:'qa',days:30,
  deleteNow:true,identityVerified:true
 });blocked(x);
});
test('classes de retenção continuam completas e sem prazos fixados',()=>{
 assert.equal(CLASSES.length,13);assert.equal(KINDS.length,5);
 for(const item of CLASSES){
  const x=evalReq(specimen({dataClass:item}));blocked(x);
 }
});
test('dados adicionais ou classes estranhas são rejeitados',()=>{
 const secret='pessoa@invalid.test';
 for(const v of [
   {...specimen(),email:secret},
   {...specimen(),dataClass:'unknown'},
   {...specimen(),legalHold:'false'},
   {...specimen(),appeal:'approved'}
 ]){
  assert.throws(()=>evalReq(v),/qa_rights_invalid_synthetic_fixture/);
 }
 const result=JSON.stringify(evalReq(specimen()));
 assert.equal(result.includes(secret),false);
});
test('entrada nula, arrays grandes ou objetos malformados falham fechados',()=>{
 for(const val of [null,{},'invalid',Array(1001).fill(specimen())])
  assert.throws(()=>auditQaRightsAndHolds(val),TypeError);
 for(const val of [null,[],undefined,12])
  if(val!==undefined)
   assert.throws(()=>auditQaRightsAndHolds([],val),TypeError);
});
test('resumo não modifica fixtures e é imutável',()=>{
 const indata=[specimen({requestKind:'objection'})];
 const before=JSON.stringify(indata);
 const result=auditQaRightsAndHolds(indata);
 blocked(result);
 assert.equal(JSON.stringify(indata),before);
 assert.equal(Object.isFrozen(result),true);
 assert.equal(Object.isFrozen(result.stats),true);
 assert.equal(result.stats.objection,1);
});
