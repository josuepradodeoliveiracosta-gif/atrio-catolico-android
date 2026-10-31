import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settingsOf} from './index.js';
import {classify} from './policy.js';

const policy={fields:{
 enabled:{booleanValue:true},allowHold:{booleanValue:true},
 emergencyStop:{booleanValue:false}
}};
const flags={
 GUARDIAN_V2_ENABLED:'true',GUARDIAN_V2_HOLD_ENABLED:'true'
};
const authorized={
 ...flags,GUARDIAN_V2_PRODUCTION_APPROVED:'true',
 GUARDIAN_V2_IDENTITY_APPROVED:'true'
};
test('sem ambas as aprovações de produção e identidade não ativa scanner',()=>{
 for(const patch of [
  {},{GUARDIAN_V2_PRODUCTION_APPROVED:'true'},
  {GUARDIAN_V2_IDENTITY_APPROVED:'true'},
  {GUARDIAN_V2_PRODUCTION_APPROVED:'false',GUARDIAN_V2_IDENTITY_APPROVED:'true'}
 ])assert.deepEqual(settingsOf(policy,{...flags,...patch}),{enabled:false,allowHold:false});
});
test('QA prevalece sobre todas as aprovações e não ativa moderação',()=>{
 assert.deepEqual(settingsOf(policy,{
  ...authorized,GUARDIAN_V2_HOLD_APPROVED:'true',GUARDIAN_V2_TEST_MODE:'true'
 }),{enabled:false,allowHold:false});
});
test('análise autorizada funciona sem habilitar retenção por acidente',()=>{
 assert.deepEqual(settingsOf(policy,authorized),{enabled:true,allowHold:false});
 assert.deepEqual(settingsOf(policy,{...authorized,GUARDIAN_V2_HOLD_APPROVED:'false'}),
  {enabled:true,allowHold:false});
 assert.deepEqual(settingsOf(policy,{...authorized,GUARDIAN_V2_HOLD_APPROVED:'true',
  GUARDIAN_V2_HOLD_ENABLED:'false'}),{enabled:true,allowHold:false});
});
test('retenção só fica habilitada após quarta aprovação exclusiva',()=>{
 const approved={...authorized,GUARDIAN_V2_HOLD_APPROVED:'true'};
 assert.deepEqual(settingsOf(policy,approved),{enabled:true,allowHold:true});
 assert.deepEqual(settingsOf({fields:{...policy.fields,allowHold:{booleanValue:false}}},approved),
   {enabled:true,allowHold:false});
});
test('parada emergencial desliga varredura e retenção apesar das flags',()=>{
 const stopped={fields:{...policy.fields,emergencyStop:{booleanValue:true}}};
 assert.deepEqual(settingsOf(stopped,{...authorized,GUARDIAN_V2_HOLD_APPROVED:'true'}),
   {enabled:false,allowHold:false});
 assert.deepEqual(settingsOf(null,{...authorized,GUARDIAN_V2_HOLD_APPROVED:'true'}),
   {enabled:false,allowHold:false});
});
test('relato de ameaça recebida sem outro indicador de citação não vira punição',()=>{
 const r=classify('Ameaça recebida: "vou te matar amanhã".');
 assert.equal(r.level,'clear');
 assert.equal(r.rule,'none');
});
