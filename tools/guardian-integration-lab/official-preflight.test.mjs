import test from 'node:test';
import assert from 'node:assert/strict';
import {previewOfficialForum as run} from './official-preflight.mjs';
import {LIMITS} from './financial-gate.mjs';
const now=Date.parse('2026-11-28T04:00:00Z'),revision='2026-11-28T00:00:00Z';
const zero=()=>Object.fromEntries(Object.keys(LIMITS).map(k=>[k,0]));
const fixture=()=>({now,financialSnapshot:{firebasePlan:'Spark',firebaseBillingEnabled:false,workerPlan:'Free',githubPublic:true,standardRunner:true,paidExtras:false,observedAt:now,firestoreDay:'2026-11-27',workerDay:'2026-11-28',usage:zero(),reserved:zero()},auth:{environment:'offline-fixture',project:'guardian-v2-qa-fixture',role:'triage',uid:'fixture_bot',authenticated:true,active:true,sessionFresh:true,identitySeparated:true},policy:{enabled:true,autonomousWriteEnabled:true,emergencyStop:false,allowHold:false,revision},source:{ownerUid:'fixture_owner',targetPath:'posts/fixture_post',revision,eligible:true},body:'Paz e bem.'});
const check=(action,body,path)=>{const f=fixture();f.body=body;if(path)f.source.targetPath=path;const r=run(f);assert.deepEqual(r,{ok:true,action,requiresAtomicReservation:action!=='clear',remoteAuthorized:false,punishmentAuthorized:false,writesAuthorized:false});};
test('official clear',()=>check('clear','Paz e bem.'));
test('official warn',()=>check('warn','https://a.invalid https://b.invalid https://c.invalid https://d.invalid'));
test('official phishing only review even reply',()=>check('review','Informe sua senha https://example.invalid','posts/fixture_post/replies/fixture_reply'));
test('official religious quote',()=>check('clear','Citação: vou te machucar'));
for(const [name,change,reason] of [
 ['paid',f=>f.financialSnapshot.firebasePlan='Blaze','financial_denied'],
 ['old metrics',f=>f.financialSnapshot.observedAt-=300001,'financial_denied'],
 ['quota',f=>f.financialSnapshot.usage.reads=42499,'financial_denied'],
 ['reservation',f=>f.financialSnapshot.reserved.writes=17000,'financial_denied'],
 ['missing usage',f=>delete f.financialSnapshot.usage.reads,'financial_denied'],
 ['shared identity',f=>f.auth.identitySeparated=false,'authorization_denied'],
 ['inactive',f=>f.auth.active=false,'authorization_denied'],
 ['observer',f=>f.auth.role='observer','authorization_denied'],
 ['emergency',f=>f.policy.emergencyStop=true,'authorization_denied'],
 ['hold',f=>f.policy.allowHold=true,'authorization_denied'],
 ['disabled',f=>f.policy.enabled=false,'authorization_denied'],
 ['invalid date',f=>f.source.revision='2026-02-30T00:00:00Z','authorization_denied'],
 ['real env',f=>f.auth.environment='production','authorization_denied'],
 ['private chat',f=>f.source.targetPath='conversations/fixture_x','invalid_fixture'],
 ['feed excluded',f=>f.source.targetPath='feed_posts/fixture_x','invalid_fixture'],
 ['real user',f=>f.source.ownerUid='real_user','invalid_fixture'],
 ['self',f=>f.source.ownerUid=f.auth.uid,'invalid_fixture'],
 ['long text',f=>f.body='x'.repeat(4001),'invalid_fixture'],
 ['unknown field',f=>f.override=true,'invalid_fixture'],
 ['executable property',f=>Object.defineProperty(f,'body',{get(){throw Error('not invoked')}}),'invalid_fixture']
]) test(name,()=>{const f=fixture();change(f);assert.deepEqual(run(f),{ok:false,reason,remoteAuthorized:false,punishmentAuthorized:false,writesAuthorized:false});});
test('null',()=>assert.equal(run(null).ok,false));
test('no private contents in output',()=>{const f=fixture();f.body='Informe sua senha https://example.invalid';const s=JSON.stringify(run(f));for(const v of [f.body,f.source.ownerUid,f.source.targetPath,f.auth.uid])assert.equal(s.includes(v),false);});
