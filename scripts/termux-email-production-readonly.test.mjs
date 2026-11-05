import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessTokenFromExistingFirebaseCli,
  performTermuxEmailAudit
} from './termux-email-production-readonly.mjs';

const oauth='x'.repeat(170);
const refresh='r'.repeat(80);
const validAccount={tokens:{refresh_token:refresh}};
const mockModules=(calls, account=validAccount)=>()=>{
  return function requirePrivate(path){
    calls.push(['require',path]);
    if(path==='./lib/auth.js')return {
      getProjectDefaultAccount:(cwd)=>{calls.push(['account',cwd]);return account;},
      getGlobalDefaultAccount:()=>account
    };
    if(path==='./lib/apiv2.js')return {
      setRefreshToken:(value)=>{assert.equal(value,refresh);calls.push(['refresh','hidden']);},
      getAccessToken:async()=>{calls.push(['token','hidden']);return oauth;}
    };
    throw Error('unexpected package dependency');
  };
};

test('obtem OAuth do login existente sem imprimir ou salvar credenciais',async()=>{
  const calls=[];
  const exec=(command,args,options)=>{
    calls.push(['exec',command,args]);
    assert.equal(command,'npm');
    assert.deepEqual(args,['root','-g']);
    assert.equal(options.stdio[1],'pipe');
    return '/tmp/qa-global\n';
  };
  const actual=await accessTokenFromExistingFirebaseCli({
    exec,cwd:'/tmp/atrio-repo',requireFactory:mockModules(calls)
  });
  assert.equal(actual,oauth);
  assert.deepEqual(calls.filter(x=>x[0]==='exec').length,1);
  assert.deepEqual(calls.find(x=>x[0]==='account'),['account','/tmp/atrio-repo']);
  assert.equal(calls.some(x=>JSON.stringify(x).includes(refresh)),false);
  assert.ok(calls.every(x=>x[0]!=='writeFile'));
});

test('auditoria chama apenas o inspetor de leitura com token em memoria',async()=>{
  const calls=[];
  const out=await performTermuxEmailAudit({
    expectedRules:'REGRAS OFICIAIS',
    tokenProvider:async()=>{calls.push('auth');return oauth;},
    inspector:async({token,expectedRules})=>{
      assert.equal(token,oauth);
      assert.equal(expectedRules,'REGRAS OFICIAIS');
      calls.push('three-read-only-GET');
      return {ready:false,emailPolicy:{state:'DISABLED'}};
    }
  });
  assert.deepEqual(calls,['auth','three-read-only-GET']);
  assert.deepEqual(out,{ready:false,emailPolicy:{state:'DISABLED'}});
});

test('sem login existente falha fechado antes de chamar API',async()=>{
  const calls=[];
  await assert.rejects(accessTokenFromExistingFirebaseCli({
    npmRoot:'/fake/global',requireFactory:mockModules(calls,{tokens:{}})
  }),/atrio_termux_preflight_firebase_login_unavailable/);
  assert.equal(calls.some(x=>x[0]==='refresh'),false);
});

test('mudanca de API privada do Firebase CLI falha fechado',async()=>{
  await assert.rejects(accessTokenFromExistingFirebaseCli({
    npmRoot:'/fake/global',requireFactory:()=>()=>{throw Error('new package layout');}
  }),/atrio_termux_preflight_firebase_cli_incompatible/);
});

test('erro de refresh nao vaza o token retornado pela API interna',async()=>{
  const secret='sensitive-oauth-refresh';
  const requireFactory=()=>path=>{
    if(path==='./lib/auth.js')return {
      getProjectDefaultAccount:()=>({tokens:{refresh_token:refresh}})
    };
    if(path==='./lib/apiv2.js')return {
      setRefreshToken:()=>{},
      getAccessToken:async()=>{throw Error(secret);}
    };
  };
  await assert.rejects(accessTokenFromExistingFirebaseCli({
    npmRoot:'/fake/global',requireFactory
  }),e=>{
    assert.equal(e.message,'atrio_termux_preflight_firebase_login_refresh_failed');
    assert.equal(JSON.stringify(e).includes(secret),false);
    return true;
  });
});

test('nao invoca Firebase se npm global nao estiver disponivel',async()=>{
  await assert.rejects(accessTokenFromExistingFirebaseCli({
    exec:()=>{throw Error('package unavailable');}
  }),/atrio_termux_preflight_npm_unavailable/);
});
