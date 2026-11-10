import test from 'node:test';
import assert from 'node:assert/strict';
import {auditQaRetentionFixtures,QA_RETENTION_CLASSES}
  from './qa_retention_evidence_inventory.mjs';
import {planRetention} from '../cloudflare/push-worker/src/retention-plan.js';

const empty=()=>Object.fromEntries(QA_RETENTION_CLASSES.map(name=>[name,[]]));
const safe=extra=>({
  legalHold:false,openReports:false,appealPending:false,
  parentMissing:false,unreviewedChildren:false,...extra
});
const audit=(name,fixtures,policy=undefined)=>{
  const x=empty();x[name]=fixtures;
  return auditQaRetentionFixtures(x,{policy});
};
const assertNeverDeletes=result=>{
  assert.equal(result.status,'NO_GO');
  assert.equal(result.action,'none');
  assert.equal(result.policyApproved,false);
  assert.equal(result.deletionAuthorized,false);
  assert.equal(result.deletedCount,0);
  assert.equal(result.deletionCandidateCount,0);
  assert.equal(result.completedMilestones,2);
};

test('nenhum prazo ou política é inferido da lista vazia',()=>{
  const result=auditQaRetentionFixtures(empty());
  assertNeverDeletes(result);
  assert.equal(result.missingClasses.length,0);
  assert.equal(result.totals.inspected,0);
  assert.equal(Object.isFrozen(result),true);
});

test('denúncia aberta, impedimento legal ou recurso suspende a triagem',()=>{
  const result=audit('groupReports',[
    safe({legalHold:true}),
    safe({openReports:true}),
    safe({appealPending:true}),
    safe()
  ]);
  assertNeverDeletes(result);
  assert.equal(result.classes.groupReports.held,3);
  assert.equal(result.classes.groupReports.reviewOnly,1);
  assert.equal(result.classes.groupReports.inspected,4);
});

test('apagar documento pai não pode considerar subcoleções inspecionadas',()=>{
  const result=audit('groupMessages',[
    safe({parentMissing:true,unreviewedChildren:true}),
    safe({unreviewedChildren:true}),
    safe({parentMissing:true})
  ]);
  assertNeverDeletes(result);
  assert.equal(result.classes.groupMessages.orphanRisk,3);
});

test('ausência, null, string e zero NÃO são evidência negativa',()=>{
  const result=audit('directMessages',[
    safe({openReports:undefined}),
    safe({legalHold:null}),
    safe({appealPending:'false'}),
    safe({unreviewedChildren:0}),
    safe({parentMissing:undefined}),
    null
  ]);
  assertNeverDeletes(result);
  assert.equal(result.classes.directMessages.unknown,6);
});

test('hold explícito prevalece sobre desconhecimento do outro indicador',()=>{
  const result=audit('directReports',[
    safe({openReports:true,legalHold:null}),
    safe({legalHold:true,appealPending:undefined})
  ]);
  assertNeverDeletes(result);
  assert.equal(result.classes.directReports.held,2);
});

test('fixture totalmente especificada ainda exige política e decisão humana',()=>{
  const result=audit('groupInvites',[safe(),safe()],{
    approved:true,approvedBy:'fake-reviewer',days:1,
    deployAuthorized:true
  });
  assertNeverDeletes(result);
  assert.equal(result.classes.groupInvites.reviewOnly,2);
  assert.equal(result.totals.reviewOnly,2);
});

test('campo faltante de inventário é registrado e não omitido silenciosamente',()=>{
  const result=auditQaRetentionFixtures({groupReports:[safe()]});
  assertNeverDeletes(result);
  assert.equal(result.missingClasses.length,QA_RETENTION_CLASSES.length-1);
  assert.ok(result.missingClasses.includes('backups'));
  assert.ok(result.missingClasses.includes('auditTrails'));
});

test('inventário inclui mensagens, denúncias, convites, acesso, auditoria e backups',()=>{
  const categories=new Set(QA_RETENTION_CLASSES);
  for(const key of ['directMessages','groupMessages','directReports',
    'groupReports','groupInvites','hiddenMessages','chatAgeEligibility',
    'groupEligibility','chatPreferences','auditTrails','backups'])
    assert.ok(categories.has(key),key);
  assert.equal(categories.size,QA_RETENTION_CLASSES.length);
});

test('o resultado jamais reproduz identificadores, textos ou dados pessoais',()=>{
  const secret='mensagem-privada-qa-nao-imprimir';
  const result=audit('groupMessages',[
    safe({id:'uid-secret',text:secret,cpf:'000.000.000-00',
      messageId:'identificador-secreto'})
  ]);
  const text=JSON.stringify(result);
  for(const value of [secret,'uid-secret','000.000.000-00',
    'identificador-secreto'])assert.equal(text.includes(value),false);
  assertNeverDeletes(result);
});

test('entrada não é mutada nem confundida com prova real',()=>{
  const inputs=empty();inputs.groupReports=[safe()];
  const original=JSON.stringify(inputs);
  const result=auditQaRetentionFixtures(inputs);
  assertNeverDeletes(result);
  assert.equal(JSON.stringify(inputs),original);
  assert.equal(result.limitations.includes(
    'synthetic_fixtures_not_authentic_evidence'),true);
});

test('entradas malformadas e classes inventadas não são aceitas',()=>{
  for(const invalid of [null,[],123,{},'invalid']){
    if(invalid&&typeof invalid==='object'&&!Array.isArray(invalid))continue;
    assert.throws(()=>auditQaRetentionFixtures(invalid),TypeError);
  }
  assert.throws(()=>auditQaRetentionFixtures({newUnknownCollection:[]}),
    TypeError);
  assert.throws(()=>auditQaRetentionFixtures({backups:'a'}),TypeError);
  assert.throws(()=>auditQaRetentionFixtures({
    backups:Array.from({length:10001},()=>safe())
  }),TypeError);
});

test('simulador legado, mesmo com prazo fictício, sempre faz dry-run',()=>{
  const now=Date.parse('2026-11-10T12:00:00Z');
  const groups=[
    {status:'closed',closedAt:'2026-09-01T00:00:00Z',
      legalHold:false,openReports:false},
    {status:'closed',closedAt:'2026-09-01T00:00:00Z',
      legalHold:true,openReports:false}
  ];
  const legacy=planRetention({
    approved:true,approvedBy:'laboratorio',days:30
  },groups,now);
  assert.equal(legacy.action,'dry_run_only');
  assert.equal(legacy.deletedCount,0);
  assert.equal(legacy.eligibleCount,1);
  assert.equal(legacy.heldCount,1);
  assertNeverDeletes(audit('groupMetadata',groups));
});

test('política ausente no simulador legado também produz zero candidatos',()=>{
  const legacy=planRetention(undefined,[
    {status:'closed',closedAt:'2026-08-01T00:00:00Z',
      legalHold:false,openReports:false}
  ],Date.parse('2026-11-10T12:00:00Z'));
  assert.equal(legacy.ready,false);
  assert.equal(legacy.eligibleCount,0);
  assert.equal(legacy.deletedCount,0);
  assertNeverDeletes(auditQaRetentionFixtures(empty()));
});
