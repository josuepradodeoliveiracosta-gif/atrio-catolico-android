import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {guardedEmailPolicyRollout,EXPECTED} from './termux-email-policy-rollout.mjs';

const rules=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
const token='qa-firebase-cli-oauth-'+'s'.repeat(120);
const name=EXPECTED.document;
const writtenAt='2026-11-05T19:00:00.000000Z';
const olderAt='2026-11-05T18:50:00.000000Z';

function report({state='MISSING',updatedAt=null,hash=EXPECTED.rulesSha,
  project=EXPECTED.project}={}){
  return {
    project,
    rules:{
      localSha256:hash,deployedSha256:hash,exactRepositoryMatch:true,
      verificationHelperPresent:true,authClaimPresent:true,guardOccurrences:28
    },
    emailPolicy:{state,updatedAt},
    ready:state==='ACTIVE'
  };
}
const response=(value,status=200)=>new Response(JSON.stringify(value),{status});
function harness({
  mode='check',
  observations=[report()],
  expectedMethod=null,
  writeStatus=200,
  writeDocument,
  fetchError=false
}={}){
  let audits=0,writes=0,tokenCalls=0;
  const inspector=async({token:current,expectedRules})=>{
    assert.equal(current,token);
    assert.equal(expectedRules,rules);
    return observations[Math.min(audits++,observations.length-1)];
  };
  const fetcher=async(url,options)=>{
    writes++;
    assert.equal(options.method,expectedMethod);
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    assert.equal(options.headers['Content-Type'],'application/json');
    assert.equal(options.cache,'no-store');
    assert.equal(typeof options.signal,'object');
    assert.ok(url.startsWith('https://firestore.googleapis.com/v1/projects/atrio-catolico/'));
    const body=JSON.parse(options.body);
    assert.equal(body.fields.version.stringValue,EXPECTED.version);
    if(expectedMethod==='POST'){
      assert.equal(new URL(url).searchParams.get('documentId'),'email_verification');
      assert.equal(body.fields.enabled.booleanValue,true);
    }
    if(expectedMethod==='PATCH'){
      const params=new URL(url).searchParams;
      assert.equal(params.get('updateMask.fieldPaths'),'enabled');
      assert.equal(params.get('currentDocument.updateTime'),olderAt);
      assert.equal(body.fields.enabled.booleanValue,false);
    }
    if(fetchError)throw Error('private-token-should-not-leak');
    if(writeStatus!==200)return response({error:'private-token-should-not-leak'},writeStatus);
    return response(writeDocument||{
      name,updateTime:writtenAt,
      fields:{enabled:{booleanValue:mode==='activate'},version:{stringValue:EXPECTED.version}}
    });
  };
  const opts={mode,localRules:rules,
    tokenProvider:async()=>{tokenCalls++;return token;},
    inspector,fetcher};
  return {opts,stats:()=>({audits,writes,tokenCalls})};
}

test('somente leitura por padrão — sem deploy, sem documentos, sem backup',async()=>{
  const h=harness();
  const result=await guardedEmailPolicyRollout(h.opts);
  assert.equal(result.mode,'CHECK');
  assert.equal(result.canActivate,true);
  assert.equal(result.modified,false);
  assert.equal(result.backupModified,false);
  assert.equal(result.releaseApproved,false);
  assert.deepEqual(h.stats(),{audits:1,writes:0,tokenCalls:1});
});
test('ativação cria documento somente ausente após dupla inspeção e verifica o resultado',async()=>{
  const h=harness({mode:'activate',expectedMethod:'POST',
    observations:[report(),report(),report({state:'ACTIVE',updatedAt:writtenAt})]});
  const result=await guardedEmailPolicyRollout(h.opts);
  assert.equal(result.modified,true);
  assert.equal(result.emailPolicyAfter,'ACTIVE');
  assert.equal(result.releaseApproved,false);
  assert.equal(result.needsRealAccountQa,true);
  assert.deepEqual(h.stats(),{audits:3,writes:1,tokenCalls:1});
});
test('desativação emergencial faz patch com updateTime precondicional',async()=>{
  const h=harness({mode:'disable',expectedMethod:'PATCH',
    observations:[
      report({state:'ACTIVE',updatedAt:olderAt}),
      report({state:'ACTIVE',updatedAt:olderAt}),
      report({state:'DISABLED',updatedAt:writtenAt})
    ]});
  const result=await guardedEmailPolicyRollout(h.opts);
  assert.equal(result.modified,true);
  assert.equal(result.emailPolicyAfter,'DISABLED');
  assert.equal(result.releaseApproved,false);
  assert.deepEqual(h.stats(),{audits:3,writes:1,tokenCalls:1});
});
test('politica pré-existente impede criação; política ausente impede rollback',async()=>{
  const a=harness({mode:'activate',observations:[report({state:'ACTIVE',updatedAt:olderAt})]});
  await assert.rejects(guardedEmailPolicyRollout(a.opts),/atrio_email_rollout_policy_not_missing/);
  assert.equal(a.stats().writes,0);
  const b=harness({mode:'disable'});
  await assert.rejects(guardedEmailPolicyRollout(b.opts),
    /atrio_email_rollout_policy_not_active_or_missing_update_time/);
  assert.equal(b.stats().writes,0);
});
test('alterações concorrentes antes do POST impedem ativação',async()=>{
  const h=harness({mode:'activate',observations:[
    report(),report({state:'ACTIVE',updatedAt:olderAt})
  ]});
  await assert.rejects(guardedEmailPolicyRollout(h.opts),
    /atrio_email_rollout_policy_changed_before_write/);
  assert.equal(h.stats().writes,0);
});
test('fingerprint ou guardas divergentes impedem qualquer escrita',async()=>{
  for(const invalid of [
    report({hash:'a'.repeat(64)}),
    report({project:'outro-projeto'}),
    {...report(),rules:{...report().rules,guardOccurrences:0}},
    {...report(),rules:{...report().rules,authClaimPresent:false}},
    {...report(),rules:{...report().rules,exactRepositoryMatch:false}}
  ]){
    const h=harness({mode:'activate',observations:[invalid]});
    await assert.rejects(guardedEmailPolicyRollout(h.opts),
      /atrio_email_rollout_(production_rules_not_approved|project_or_local_rules_changed)/);
    assert.equal(h.stats().writes,0);
  }
});
test('arquivo local alterado falha antes de usar qualquer OAuth',async()=>{
  let called=0;
  await assert.rejects(guardedEmailPolicyRollout({
    localRules:rules+'\n// modificacao nao auditada',mode:'activate',
    tokenProvider:async()=>{called++;return token;}
  }),/atrio_email_rollout_local_rules_not_approved/);
  assert.equal(called,0);
});
test('servidor nega POST concorrente e nunca faz overwrite automático',async()=>{
  for(const status of [409,412]){
    const h=harness({mode:'activate',writeStatus:status,
      expectedMethod:'POST',observations:[report(),report()]});
    await assert.rejects(guardedEmailPolicyRollout(h.opts),
      /atrio_email_rollout_write_precondition_failed/);
    assert.equal(h.stats().writes,1);
  }
});
test('erro de rede não imprime tokens ou mensagem da resposta remota',async()=>{
  const h=harness({mode:'activate',expectedMethod:'POST',
    observations:[report(),report()],fetchError:true});
  await assert.rejects(guardedEmailPolicyRollout(h.opts),e=>{
    assert.equal(e.message,'atrio_email_rollout_write_network_uncertain_check_before_retry');
    assert.equal(JSON.stringify(e).includes('private-token'),false);
    return true;
  });
});
test('escrita aceita pelo servidor mas pós-auditoria errada não aprova conclusão',async()=>{
  const h=harness({mode:'activate',expectedMethod:'POST',
    observations:[report(),report(),report()]});
  await assert.rejects(guardedEmailPolicyRollout(h.opts),
    /atrio_email_rollout_post_write_audit_mismatch/);
  assert.equal(h.stats().writes,1);
});
test('campos ou updateTime inesperados não permitem falso sucesso',async()=>{
  const h=harness({mode:'activate',expectedMethod:'POST',
    observations:[report(),report()],
    writeDocument:{name,fields:{enabled:{booleanValue:true},
      version:{stringValue:EXPECTED.version}}}});
  await assert.rejects(guardedEmailPolicyRollout(h.opts),
    /atrio_email_rollout_unexpected_document_after_write/);
});
test('estado inválido não permite ativação',async()=>{
  const h=harness({mode:'activate',
    observations:[report({state:'INVALID'})]});
  await assert.rejects(guardedEmailPolicyRollout(h.opts),
    /atrio_email_rollout_unexpected_email_policy_state/);
  assert.equal(h.stats().writes,0);
});
