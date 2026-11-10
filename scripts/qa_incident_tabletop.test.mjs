import test from 'node:test';
import assert from 'node:assert/strict';
import {auditQaIncidentTabletop} from './qa_incident_tabletop.mjs';
const specimen=()=>({
 surface:'dm',intake:'received',reporterVerified:true,
 moderatorAuthorized:true,moderatorAvailable:true,urgencySignal:'none',
 evidenceStatus:'preserved',appealStatus:'none',formerMember:false
});
const check=r=>{
 assert.equal(r.status,'NO_GO');
 assert.equal(r.policyApproved,false);
 assert.equal(r.deploymentAuthorized,false);
 assert.equal(r.actions,'none');
 for(const field of ['realTriagePerformed','realEscalationsSent',
  'realSanctionsApplied','realCasesClosed','deletedCount'])
   assert.equal(r[field],0);
};
test('caso completo jamais autoriza triagem real',()=>{
 const x=auditQaIncidentTabletop([specimen()]);check(x);
 assert.equal(x.stats.inspected,1);assert.equal(x.stats.dm,1);
 assert.ok(Object.isFrozen(x));
 assert.ok(Object.isFrozen(x.stats));
});
test('sinal potencial de urgência exige resposta humana futura sem despachar alertas',()=>{
 const x=auditQaIncidentTabletop([{...specimen(),urgencySignal:'possible'}]);
 check(x);assert.equal(x.stats.possibleUrgency,1);
});
test('urgência desconhecida não é classificada automaticamente como segura',()=>{
 const x=auditQaIncidentTabletop([{...specimen(),urgencySignal:'unknown'}]);
 check(x);assert.equal(x.stats.possibleUrgency,1);
});
test('moderador ausente e não autorizado não viram aprovação',()=>{
 const x=auditQaIncidentTabletop([{
   ...specimen(),moderatorAvailable:false,moderatorAuthorized:false
 }]);
 check(x);assert.equal(x.stats.moderatorNotAvailable,1);
 assert.equal(x.stats.moderatorNotAuthorized,1);
});
test('credenciamento desconhecido bloqueia equivalência com autorizado',()=>{
 const x=auditQaIncidentTabletop([{...specimen(),moderatorAuthorized:null}]);
 check(x);assert.equal(x.stats.moderatorNotAuthorized,1);
});
test('protocolo não recebido e identidade não verificada não são processados',()=>{
 const x=auditQaIncidentTabletop([{
   ...specimen(),intake:'missing',reporterVerified:false
 }]);
 check(x);assert.equal(x.stats.unknownIntake,1);
 assert.equal(x.stats.reporterCheckPending,1);
});
test('apelação pendente exige trilha de revisão e não encerra caso',()=>{
 const x=auditQaIncidentTabletop([{
   ...specimen(),appealStatus:'pending'
 }]);
 check(x);assert.equal(x.stats.pendingAppeals,1);
});
test('recurso desconhecido não equivale a ausência de recurso',()=>{
 const x=auditQaIncidentTabletop([{...specimen(),appealStatus:'unknown'}]);
 check(x);assert.equal(x.stats.unknownAppeals,1);
});
test('ex-integrante é identificado como lacuna do procedimento de evidências',()=>{
 const x=auditQaIncidentTabletop([{
   ...specimen(),surface:'group',formerMember:true
 }]);
 check(x);assert.equal(x.stats.formerMemberCases,1);
 assert.equal(x.stats.group,1);
});
test('evidência ausente ou desconhecida não permite sanção automática',()=>{
 const x=auditQaIncidentTabletop([
   {...specimen(),evidenceStatus:'missing'},
   {...specimen(),evidenceStatus:'unknown'}
 ]);
 check(x);assert.equal(x.stats.missingEvidence,1);
 assert.equal(x.stats.unknownEvidence,1);
});
test('flags externas de aprovação são ignoradas em laboratório',()=>{
 const x=auditQaIncidentTabletop([specimen()],{
   approved:true,approvedBy:'fake',qaDeploymentAuthorized:true,
   actions:'delete-all',slaHours:1
 });
 check(x);
});
test('caso de dados incompletos não é silenciosamente aceito',()=>{
 for(const value of [null,{},[],{...specimen(),appealStatus:'done'},
   {...specimen(),urgencySignal:'critical'},
   {...specimen(),reporterVerified:'true'}]){
   assert.throws(()=>auditQaIncidentTabletop([value]),/qa_incident_invalid_synthetic_fixture/);
 }
});
test('não incorpora ID, texto ou PII do chamador ao relatório',()=>{
 const sensitive='usuario-secreto@invalid.test';
 const corrupted={...specimen(),messageText:sensitive};
 assert.throws(()=>auditQaIncidentTabletop([corrupted]),
   /qa_incident_invalid_synthetic_fixture/);
 const x=JSON.stringify(auditQaIncidentTabletop([specimen()]));
 assert.equal(x.includes(sensitive),false);
 assert.equal(x.includes('qa-alice'),false);
});
test('array inválido, muito grande, ou options inválidos rejeitados',()=>{
 for(const cases of [null,{},'string',Array(1001).fill(specimen())])
   assert.throws(()=>auditQaIncidentTabletop(cases),TypeError);
 assert.throws(()=>auditQaIncidentTabletop([],null),TypeError);
});
test('contagem agregada mantém separação entre DMs e grupos',()=>{
 const x=auditQaIncidentTabletop([
   specimen(),{...specimen(),surface:'group'},
   {...specimen(),surface:'group',formerMember:null}
 ]);
 check(x);assert.deepEqual([x.stats.dm,x.stats.group,x.stats.inspected],[1,2,3]);
 assert.equal(x.stats.unknownFormerMembership,1);
});
