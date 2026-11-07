import test from 'node:test';
import assert from 'node:assert/strict';
import {planRetention} from './retention-plan.js';
const now=Date.parse('2026-11-07T12:00:00Z');
const group=(days,extra={})=>({
  status:'closed',
  closedAt:new Date(now-days*86_400_000).toISOString(),
  legalHold:false,openReports:false,...extra
});
const policy={approved:true,approvedBy:'qa',days:30};
test('sem política aprovada não há candidatos',()=>{
  for(const p of [undefined,{approved:false,days:30},{approved:true},{...policy,days:0}]) {
    const out=planRetention(p,[group(100)],now);
    assert.equal(out.eligibleCount,0);
    assert.equal(out.deletedCount,0);
    assert.equal(out.action,'none');
  }
});
test('revisão só considera grupos encerrados além do prazo',()=>{
  const out=planRetention(policy,[group(32),group(29),group(100,{status:'active'})],now);
  assert.equal(out.eligibleCount,1);
  assert.equal(out.unknownCount,1);
});
test('denúncias ou impedimento legal impedem a seleção',()=>{
  const out=planRetention(policy,[group(90,{openReports:true}),group(80,{legalHold:true}),group(50)],now);
  assert.equal(out.heldCount,2);
  assert.equal(out.eligibleCount,1);
});
test('datas inválidas e futuras não entram',()=>{
  const out=planRetention(policy,[group(-3),group(99,{closedAt:'wrong'})],now);
  assert.equal(out.eligibleCount,0);
  assert.equal(out.unknownCount,2);
});
test('a saída não revela nomes nem mensagens e nunca apaga',()=>{
  const out=planRetention(policy,[group(70,{id:'secret-id',text:'segredo'})],now);
  assert.equal(out.action,'dry_run_only');
  assert.equal(out.deletedCount,0);
  assert.equal(JSON.stringify(out).includes('secret-id'),false);
  assert.equal(JSON.stringify(out).includes('segredo'),false);
});
test('parâmetros inválidos são recusados',()=>{
  assert.throws(()=>planRetention(policy,{},now),TypeError);
  assert.throws(()=>planRetention(policy,[],NaN),TypeError);
});

test('ausência de informação sobre denúncias não vira liberação implícita',()=>{
  const out=planRetention(policy,[group(80,{openReports:undefined}),
    group(90,{openReports:null}),group(100,{openReports:0})],now);
  assert.equal(out.eligibleCount,0);
  assert.equal(out.unknownCount,3);
  assert.equal(out.deletedCount,0);
});
test('ausência de informação sobre impedimento legal impede pré-seleção',()=>{
  const out=planRetention(policy,[group(80,{legalHold:undefined}),
    group(90,{legalHold:null}),group(100,{legalHold:'false'})],now);
  assert.equal(out.eligibleCount,0);
  assert.equal(out.unknownCount,3);
});
test('um bloqueio confirmado prevalece sobre outro indicador desconhecido',()=>{
  const out=planRetention(policy,[
    group(50,{legalHold:true,openReports:undefined}),
    group(70,{legalHold:null,openReports:true})
  ],now);
  assert.equal(out.heldCount,2);
  assert.equal(out.eligibleCount,0);
});
test('data de encerramento em formato numérico não é aceita como evidência',()=>{
  const out=planRetention(policy,[group(60,{closedAt:0}),
    group(90,{closedAt:null})],now);
  assert.equal(out.unknownCount,2);
  assert.equal(out.deletedCount,0);
});
