import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditIssue200Draft,formatIssue200Summary,DECISIONS,DATA_CLASSES}
  from './qa_issue200_decision_gate.mjs';

const initial=JSON.parse(readFileSync(
 new URL('../docs/qa-homologacao/ISSUE-200-REGISTRO-PENDENTE.json',
 import.meta.url),'utf8'));
const copy=()=>structuredClone(initial);
const check=v=>auditIssue200Draft(v);
const blocked=r=>{
 assert.equal(r.status,'NO_GO');
 assert.equal(r.qaDeploymentAuthorized,false);
 assert.equal(r.productionDeploymentAuthorized,false);
 assert.equal(r.deletionAuthorized,false);
 assert.equal(r.ageMethodVerified,false);
 assert.equal(r.verifiedApprovals,0);
};
test('template completo 18+ mantém todas decisões pendentes',()=>{
 const result=check(copy());
 assert.equal(result.draftValid,true);
 blocked(result);
 assert.equal(result.minimumChatAgeRequirement,18);
 assert.equal(result.pendingDecisions,DECISIONS.length);
 assert.equal(result.pendingRetentionClasses,DATA_CLASSES.length);
 assert.equal(DECISIONS.length,11);
 assert.equal(DATA_CLASSES.length,13);
});
test('idade antiga 16 não é permitida',()=>{
 const value=copy();value.minimumChatAge=16;
 const result=check(value);blocked(result);
 assert.equal(result.draftValid,false);
 assert.ok(result.problems.includes('AGE_REQUIREMENT_MISMATCH'));
});
test('autodeclaração etária não é prova de servidor',()=>{
 const value=copy();value.agePrecheck='local-self-declared-is-verified';
 assert.equal(check(value).draftValid,false);
 blocked(check(value));
});
test('marcações fictícias de aprovação QA/produção são bloqueadas',()=>{
 for(const which of ['qaDeploymentAuthorized','productionDeploymentAuthorized']){
   const value=copy();value[which]=true;
   const result=check(value);blocked(result);
   assert.equal(result.draftValid,false);
   assert.ok(result.problems.includes('UNAUTHORIZED_DEPLOY_FLAG'));
 }
});
test('nenhuma decisão humana pode passar para approved sem revisão do gate',()=>{
 for(const status of ['approved','rejected','done',true]){
   const value=copy();value.decisions.reportIntakeAndTriage.status=status;
   const result=check(value);blocked(result);
   assert.equal(result.draftValid,false);
   assert.ok(result.problems.includes('DECISION_NOT_PENDING:reportIntakeAndTriage'));
 }
});
test('um responsável ou uma deliberação inventada não viram aprovação',()=>{
 const value=copy();
 value.decisions.moderatorAssignmentsAndAccess.reviewedBy='fake-reviewer';
 value.governance.policyOwner='fake-owner';
 const result=check(value);blocked(result);
 assert.equal(result.draftValid,false);
 assert.ok(result.problems.includes('GOVERNANCE_NOT_REVIEWED'));
});
test('prazo de exclusão presumido para mensagens é bloqueado',()=>{
 const value=copy();value.retention.directMessages.periodDays=30;
 const result=check(value);blocked(result);
 assert.equal(result.draftValid,false);
 assert.ok(result.problems.includes('RETENTION_NOT_PENDING:directMessages'));
});
test('um hold declarado falso não basta para autorizar retenção',()=>{
 const value=copy();value.retention.groupReports.preservationRule='no_hold';
 const result=check(value);blocked(result);
 assert.equal(result.draftValid,false);
 assert.ok(result.problems.includes('RETENTION_NOT_PENDING:groupReports'));
});
test('campos e categorias não auditados não são aceitos',()=>{
 const value=copy();value.retention.unknownSensitiveCollection={};
 value.minorPolicyApproved=true;
 const result=check(value);blocked(result);
 assert.equal(result.draftValid,false);
 assert.ok(result.problems.includes('ROOT_STRUCTURE_INVALID'));
 assert.ok(result.problems.includes('RETENTION_CLASSES_INVALID'));
});
test('nenhuma classe de dados pode desaparecer silenciosamente',()=>{
 for(const key of ['backups','auditTrails','groupReports']){
   const value=copy();delete value.retention[key];
   const result=check(value);blocked(result);
   assert.equal(result.draftValid,false);
   assert.ok(result.problems.includes('RETENTION_CLASSES_INVALID'));
 }
});
test('identidades e textos suspeitos não entram na saída do gate',()=>{
 const marker='EMAIL-SECRETO-EXEMPLO@invalid.test';
 const value=copy();value.decisions.reportIntakeAndTriage.proposal=marker;
 const result=check(value);
 const rendered=JSON.stringify(result)+'\n'+formatIssue200Summary(result);
 blocked(result);
 assert.equal(result.draftValid,false);
 assert.equal(rendered.includes(marker),false);
});
test('falha fechada para estrutura nula, lista ou sem a issue 200',()=>{
 for(const value of [null,[],{},'bad',12]){
   const result=check(value);blocked(result);
   assert.equal(result.draftValid,false);
 }
 const wrong=copy();wrong.issueNumber=199;
 assert.equal(check(wrong).draftValid,false);
});
test('a auditoria não modifica o registro nem concede exclusão',()=>{
 const data=copy(),before=JSON.stringify(data);
 const result=check(data);blocked(result);
 assert.equal(before,JSON.stringify(data));
 assert.ok(formatIssue200Summary(result).includes('NO-GO'));
 assert.equal(JSON.stringify(result).includes('chat_reports/'),false);
});

test('caderno humano cobre 11 decisões, 13 classes, fontes e NO-GO',()=>{
 const document=readFileSync(new URL(
  '../docs/qa-homologacao/ISSUE-200-CADERNO-DELIBERACAO.md',
  import.meta.url),'utf8');
 for(const key of DECISIONS)
   assert.ok(document.includes('| `'+key+'` |'),'Decisão faltante no caderno');
 for(const key of DATA_CLASSES)
   assert.ok(document.includes('| `'+key+'` |'),'Classe faltante no caderno');
 assert.equal(document.split('| `trustedAgeProof` |').length-1,1);
 assert.ok(document.includes('NÃO APROVADA / NO-GO'));
 assert.ok(document.includes('art. 15 do Marco Civil'));
 assert.ok(document.includes('28/10/2026'));
 assert.ok(document.includes('Somente então revisar o fechamento #200'));
 assert.equal(check(copy()).draftValid,true);
 blocked(check(copy()));
});
