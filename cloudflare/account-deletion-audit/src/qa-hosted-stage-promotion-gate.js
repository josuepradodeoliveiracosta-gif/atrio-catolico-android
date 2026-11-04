/**
 * Read-only, offline QA stage promotion preflight for sanitized operator
 * evidence. NOT a deploy tool, a trust root or a production release gate.
 * A self-authored/forged snapshot can pass; human-reviewed API evidence and
 * compiled artifact signature are still mandatory outside this module.
 */
const NAME='atrio-privacy-freeze-qa-internal';
const CLIENTS=['avatar','guardian','push'];
const PRODUCTION=['atrio-avatares','atrio-guardian-v2','atrio-push'];
const HEX40=/^[a-f0-9]{40}$/;
const HEX64=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const plain=x=>x!==null&&typeof x==='object'&&
  !Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const fail=why=>{throw Error('qa_stage_promotion_invalid:'+why);};
const requiredStage=Object.freeze({
  ATRIO_PRIVACY_STAGE_ID:'plain_text',
  STAGE_FREEZE_DB:'d1',
  STAGE_ADMIN_HMAC:'secret_text',
  STAGE_AVATAR_HMAC:'secret_text',
  STAGE_GUARDIAN_HMAC:'secret_text',
  STAGE_PUSH_HMAC:'secret_text',
  STAGE_RECONCILER_HMAC:'secret_text'
});
const requiredClient=Object.freeze({
  ATRIO_QA_CONSUMER_FIXTURE:'plain_text',
  ATRIO_QA_CONSUMER_HMAC:'secret_text',
  ATRIO_QA_CONSUMER_ROLE:'plain_text',
  PRIVACY_FREEZE_STAGE:'service'
});
function bindingsMatch(bindings,wanted){
  if(!Array.isArray(bindings)||bindings.length!==Object.keys(wanted).length)
    return false;
  const seen=new Set();
  return bindings.every(b=>{
    if(!plain(b)||typeof b.name!=='string'||seen.has(b.name)||
      wanted[b.name]!==b.type)return false;
    seen.add(b.name);
    if(b.type==='service'&&b.service!==NAME)return false;
    if(b.type==='d1'&&b.databaseName!=='atrio-privacy-freeze-stage-fixtures')
      return false;
    // Never include secrets or account identifiers in sanitized evidence.
    if(Object.hasOwn(b,'text')||Object.hasOwn(b,'value')||
       Object.hasOwn(b,'secret'))return false;
    return true;
  });
}
export function assessQaHostedStagePromotion(evidence){
  if(!plain(evidence)||!HEX40.test(evidence.candidateCommit||'')||
    !Array.isArray(evidence.workers)||evidence.workers.length!==4||
    !Array.isArray(evidence.productionWorkers)||
    evidence.productionWorkers.length!==3||
    !plain(evidence.fixtureDb))fail('shape');
  const expected=[NAME,...CLIENTS.map(x=>'atrio-privacy-qa-client-'+x)];
  const names=evidence.workers.map(w=>w?.name);
  if(new Set(names).size!==4 || !expected.every(x=>names.includes(x)))
    fail('worker_set');
  const blockers=[];
  const block=(label,ok)=>{if(!ok)blockers.push(label);};
  const a=evidence.artifact;
  block('artifact:missing_reproducible_signed_build',
    plain(a)&&a.commit===evidence.candidateCommit&&
    HEX64.test(a.sha256||'')&&a.independentReviewVerified===true);
  for(const name of expected){
    const w=evidence.workers.find(x=>x.name===name);
    if(!plain(w))fail('worker');
    const id=name===NAME?'stage':name.slice('atrio-privacy-qa-client-'.length);
    block(id+':code_provenance_missing',
      HEX40.test(w.commit||'')&&w.commit===evidence.candidateCommit&&
      UUID.test(w.versionId||'')&&
      UUID.test(w.deployedVersionId||'')&&
      w.versionId===w.deployedVersionId);
    block(id+':public_exposure_not_disproven',
      w.subdomainEnabled===false&&w.previewEnabled===false&&
      w.zoneRoutesAudited===true&&w.zoneRoutesCount===0);
    block(id+':cron_not_verified_disabled',w.cronCount===0);
    block(id+':bindings_not_verified',
      bindingsMatch(w.bindings,name===NAME?requiredStage:requiredClient));
  }
  for(const liveName of PRODUCTION){
    const v=evidence.productionWorkers.find(x=>x?.name===liveName);
    block('production:'+liveName+':qa_binding_not_disproven',
      plain(v)&&v.qaStageServiceBindingPresent===false);
  }
  const db=evidence.fixtureDb;
  block('stage_d1:fixture_ledger_not_clean',
    db.name==='atrio-privacy-freeze-stage-fixtures'&&
    db.verifiedReadOnly===true&&
    db.fixtureAccountCount===2&&db.pendingOperations===0&&
    db.frozenWithPending===0);
  return Object.freeze({
    state:blockers.length?'blocked':'metadata_preflight_only',
    blockers:Object.freeze(blockers.sort()),
    qaStageReadyForManualReview:blockers.length===0,
    hostedCodeDeployedByThisCheck:false,
    productionIntegrated:false,
    destructiveOperationsAuthorized:false,
    googlePlayReleaseAuthorized:false,
    requiresVersionUploadReview:true,
    requiresIndependentIamAndRetentionReview:true
  });
}
