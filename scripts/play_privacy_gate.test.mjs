import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessPrivacyEvidence,assertQaSafetySources,REQUIREMENTS} from './play_privacy_gate.mjs';

const base=()=>JSON.parse(readFileSync(new URL('../docs/google-play-privacidade-evidencias.json',import.meta.url),'utf8'));
const proof=row=>({...row,verified:true,
  evidenceUrl:'https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions',
  reviewedBy:'reviewer-qa',reviewedAt:'2026-10-31T12:00:00Z'});
test('manifesto é bloqueado por padrão mesmo com testes verdes',()=>{
  const r=assessPrivacyEvidence(base());
  assert.equal(r.ready,false);
  assert.equal(r.pending.length,REQUIREMENTS.length);
  assert.equal(r.releaseAuthorized,false);
});
test('autorização isolada não libera um AAB',()=>{
  const r=base();r.releaseAuthorized=true;
  assert.throws(()=>assessPrivacyEvidence(r),/autorizacao_sem_homologacao/);
});
test('prova ausente ou URL demonstrativa é rejeitada',()=>{
  const r=base();r.requirements.external_portal={...r.requirements.external_portal,
    verified:true,evidenceUrl:'https://portal.example/',reviewedBy:'testador',
    reviewedAt:'2026-10-31T12:00:00Z'};
  assert.throws(()=>assessPrivacyEvidence(r),/comprovacao_insuficiente/);
});
test('nove evidências, revisadas manualmente, são necessárias para avaliação',()=>{
  const r=base();
  for(const key of REQUIREMENTS)r.requirements[key]=proof(r.requirements[key]);
  assert.equal(assessPrivacyEvidence(r).ready,false);
  r.releaseAuthorized=true;
  assert.equal(assessPrivacyEvidence(r).ready,true);
  delete r.requirements.data_safety;
  assert.throws(()=>assessPrivacyEvidence(r),/requisitos_incompletos/);
});
test('evidência incompleta não pode ser parcialmente declarada verificada',()=>{
  const r=base();r.requirements.in_app_request.reviewedBy='testador';
  assert.throws(()=>assessPrivacyEvidence(r),/evidencia_inconsistente/);
});
test('fonte do pedido Android/web e simulador permanecem no modo seguro',()=>{
  assert.equal(assertQaSafetySources(),true);
});
test('remover consulta do servidor ou desativar guardas falha fechado',()=>{
  const f='app/src/main/java/br/com/atriocatolico/AccountDeletionRequestSection.kt';
  const reader=path=>{
    const s=readFileSync(new URL('../'+path,import.meta.url),'utf8');
    return path===f?s.replace('Source.SERVER','Source.CACHE'):s;
  };
  assert.throws(()=>assertQaSafetySources(reader),/fonte_qa_alterada/);
});
