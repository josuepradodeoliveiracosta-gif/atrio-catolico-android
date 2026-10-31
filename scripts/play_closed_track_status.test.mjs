import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessClosedTrack,inspectCheckedInClosedTrack} from './play_closed_track_status.mjs';

const evidence=()=>JSON.parse(readFileSync(new URL(
  '../docs/google-play-privacidade-evidencias.json',import.meta.url),'utf8'));
test('repositório atual permanece bloqueado para teste fechado',()=>{
  const current=inspectCheckedInClosedTrack();
  assert.equal(current.blocked,true);
  assert.equal(current.eligibleForUpload,false);
  assert.equal(current.verifiedRequirements,0);
  assert.equal(current.outstandingRequirements.length,9);
  assert.equal(current.externalVerification.remoteCloudflareStageVerified,false);
});
test('fontes faltantes de privacidade e AAB são identificadas',()=>{
  const r=assessClosedTrack({evidence:evidence(),files:{}});
  assert.ok(r.blockers.includes('policy_review_draft_missing_or_unsafe'));
  assert.ok(r.blockers.includes('data_safety_review_missing_or_unsafe'));
  assert.ok(r.blockers.includes('play_manifest_permission_overlay_not_verified'));
  assert.ok(r.blockers.includes('target_sdk_36_not_in_this_branch'));
});
test('arquivos operacionais não autorizados permanecem bloqueados',()=>{
  const r=assessClosedTrack({evidence:evidence(),files:{
    webConfig:'active',stageConfig:'active'
  }});
  assert.ok(r.blockers.includes('web_request_config_active_unverified'));
  assert.ok(r.blockers.includes('cloudflare_stage_deploy_config_present'));
  assert.equal(r.eligibleForUpload,false);
});
test('manifesto de evidências incompleto não é aceito',()=>{
  const e=evidence();delete e.requirements.external_portal;
  assert.throws(()=>assessClosedTrack({evidence:e,files:{}}),
    /requisitos_incompletos/);
});
