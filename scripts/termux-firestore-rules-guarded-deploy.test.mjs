import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  guardedRulesUpdate,EXPECTED
} from './termux-firestore-rules-guarded-deploy.mjs';

const rules=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
const token='qa-test-token-in-memory-abcdefghijklmnopqrstuvwxyz';

test('hash auditado na captura Termux impede transposicao de caracteres',()=>{
  const hashAudited='9c7678a7dfbadececb30d5f770a25fb81c6f5926fedafc75e303c7e3bb3e6a02';
  const previousTypo='9c7678a7dfbadecceb30d5f770a25fb81c6f5926fedafc75e303c7e3bb3e6a02';
  assert.equal(EXPECTED.oldRulesSha256,hashAudited);
  assert.notEqual(EXPECTED.oldRulesSha256,previousTypo);
});
const f=(published=EXPECTED.oldRulesSha256,stage='before',policy='MISSING')=>({
  project:EXPECTED.project,
  rules:{
    localSha256:EXPECTED.newRulesSha256,
    deployedSha256:published,
    exactRepositoryMatch:stage==='after',
    verificationHelperPresent:stage==='after',
    authClaimPresent:stage==='after',
    guardOccurrences:stage==='after'?29:0
  },
  emailPolicy:{state:policy}
});
const policyName='projects/atrio-catolico/databases/(default)/documents/app_config/community_rules';
const community=(enabled,version='2026-11-v1')=>Response.json({
  name:policyName,
  fields:{enabled:{booleanValue:enabled},version:{stringValue:version}}
});
const factory=({
  apply=false,inspected=[f()],communityResponse=()=>new Response('',{status:404}),
  execute=()=>{throw Error('NO_FIREBASE_DEPLOY_ALLOWED');}
}={})=>{
  let inspections=0,calls=0,deployed=0;
  const opts={
    apply,localRules:rules,tokenProvider:async()=>token,
    inspector:async(args)=>{
      assert.equal(args.token,token);
      assert.equal(args.expectedRules,rules);
      assert.equal(typeof args.fetcher,'function');
      return inspected[Math.min(inspections++,inspected.length-1)];
    },
    fetcher:async(url,request)=>{
      calls++;
      assert.equal(request.method,'GET');
      assert.equal(request.headers.Authorization,'Bearer '+token);
      assert.ok(url.endsWith('/documents/app_config/community_rules'));
      return communityResponse();
    },
    execute:(command,args,options)=>{
      deployed++;
      if(execute)execute(command,args,options);
    }
  };
  return {opts,stats:()=>({inspections,calls,deployed})};
};

test('inspecao padrao apenas GET e nenhum deploy, backup ou ativacao',async()=>{
  const x=factory();
  const out=await guardedRulesUpdate(x.opts);
  assert.equal(out.mode,'READ_ONLY_PREFLIGHT');
  assert.equal(out.canApplyRules,true);
  assert.equal(out.deployed,false);
  assert.equal(out.backupModified,false);
  assert.equal(out.emailPolicyActivated,false);
  assert.equal(out.releaseApproved,false);
  assert.deepEqual(x.stats(),{inspections:1,calls:1,deployed:0});
});

test('--apply so deploya Firestore Rules ao projeto correto apos dupla verificacao',async()=>{
  const x=factory({
    apply:true,
    inspected:[f(),f(),f(EXPECTED.newRulesSha256,'after')],
    execute:(command,args,options)=>{
      assert.equal(command,'firebase');
      assert.deepEqual(args,[
        'deploy','--only','firestore:rules',
        '--project','atrio-catolico','--non-interactive'
      ]);
      assert.equal(options.stdio,'inherit');
      assert.equal(options.timeout,180000);
    }
  });
  const out=await guardedRulesUpdate(x.opts);
  assert.equal(out.deployed,true);
  assert.equal(out.emailPolicyStillMissing,true);
  assert.equal(out.rulesPublishedSha256,EXPECTED.newRulesSha256);
  assert.equal(out.backupModified,false);
  assert.deepEqual(x.stats(),{inspections:3,calls:3,deployed:1});
});

test('mudanca de hash publicado bloqueia imediatamente o deploy',async()=>{
  const x=factory({
    apply:true,
    inspected:[f('a'.repeat(64))]
  });
  await assert.rejects(guardedRulesUpdate(x.opts),
    /atrio_rules_deploy_before_published_sha_changed/);
  assert.equal(x.stats().deployed,0);
});

test('regras locais divergentes ou politicas ativas impedem substituicao',async()=>{
  let called=0;
  await assert.rejects(guardedRulesUpdate({
    localRules:rules+'\n// alterado',
    tokenProvider:async()=>{called++;return token;}
  }),/atrio_rules_deploy_local_sha_mismatch/);
  assert.equal(called,0);
  const activeEmail=factory({apply:true,inspected:[f(EXPECTED.oldRulesSha256,'before','ACTIVE')]});
  await assert.rejects(guardedRulesUpdate(activeEmail.opts),
    /atrio_rules_deploy_before_email_policy_changed/);
  assert.equal(activeEmail.stats().deployed,0);
  const activeConsent=factory({
    apply:true,communityResponse:()=>community(true)
  });
  await assert.rejects(guardedRulesUpdate(activeConsent.opts),
    /atrio_rules_deploy_community_consent_gate_active/);
  assert.equal(activeConsent.stats().deployed,0);
});

test('falha de rede e resposta administrativa invalida falham fechado',async()=>{
  for(const response of [
    ()=>new Response('',{status:403}),
    ()=>Response.json({fields:{enabled:{booleanValue:false}}}),
    ()=>{throw Error('offline');}
  ]){
    const x=factory({apply:true,communityResponse:response});
    await assert.rejects(guardedRulesUpdate(x.opts),
      /atrio_rules_deploy_community_policy_(unavailable|invalid)/);
    assert.equal(x.stats().deployed,0);
  }
});

test('segunda leitura impede deploy se houver alteracao concorrente',async()=>{
  const x=factory({apply:true,inspected:[f(),f('b'.repeat(64))]});
  await assert.rejects(guardedRulesUpdate(x.opts),
    /atrio_rules_deploy_before_published_sha_changed/);
  assert.equal(x.stats().deployed,0);
});

test('falha na CLI nao informa sucesso nem altera backup',async()=>{
  const x=factory({
    apply:true,
    inspected:[f(),f()],
    execute:()=>{throw Error('firebase deploy falhou com credencial sensivel');}
  });
  await assert.rejects(guardedRulesUpdate(x.opts),e=>{
    assert.equal(e.message,'atrio_rules_deploy_firebase_cli_failed_check_remote_state');
    return true;
  });
  assert.equal(x.stats().deployed,1);
});

test('mesmo com CLI exitosa, divergencia depois exige nova auditoria',async()=>{
  const x=factory({
    apply:true,
    inspected:[f(),f(),f('c'.repeat(64),'after')],
    execute:()=>{}
  });
  await assert.rejects(guardedRulesUpdate(x.opts),
    /atrio_rules_deploy_after_published_sha_changed/);
  assert.equal(x.stats().deployed,1);
});
