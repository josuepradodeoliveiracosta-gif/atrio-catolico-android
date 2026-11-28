// Local QA only. Not imported by the Worker, not a remote authorization layer.
import {createHash} from 'node:crypto';
import {classify,decide} from '../../cloudflare/guardian-worker/src/policy.js';
import {evaluateFinancialGate} from './financial-gate.mjs';
import {evaluateAuthorization} from './authorization-policy.mjs';
const exact=(v,ks)=>v!==null&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===ks.length&&ks.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)||{},'value'));
const fixtureId=v=>typeof v==='string'&&/^fixture_[A-Za-z0-9_-]{1,100}$/.test(v);
const fixturePath=v=>typeof v==='string'&&/^posts\/fixture_[A-Za-z0-9_-]{1,100}(?:\/replies\/fixture_[A-Za-z0-9_-]{1,100})?$/.test(v);
const noRemote=Object.freeze({remoteAuthorized:false,punishmentAuthorized:false,writesAuthorized:false});
const deny=reason=>Object.freeze({ok:false,reason,...noRemote});
// Synthetic cost envelope only; not a measurement or reservation of provider quotas.
const estimate=Object.freeze({reads:8,writes:4,deletes:0,storageBytes:16384,workerRequests:1,workerCpuMs:8,newPaidService:false,additionalProducts:false,artifactUpload:false});
export function previewOfficialForum(f){
 try {
  if(!exact(f,['now','financialSnapshot','auth','policy','source','body'])||!exact(f.source,['ownerUid','targetPath','revision','eligible'])||!fixtureId(f.source.ownerUid)||!fixturePath(f.source.targetPath)||!exact(f.auth,['environment','project','role','uid','authenticated','active','sessionFresh','identitySeparated'])||!fixtureId(f.auth.uid)||f.auth.uid===f.source.ownerUid||!exact(f.policy,['enabled','autonomousWriteEnabled','emergencyStop','allowHold','revision'])||typeof f.body!=='string'||f.body.length>4000) return deny('invalid_fixture');
  const budget=evaluateFinancialGate(f.financialSnapshot,estimate,f.now);
  if(!budget.allowed)return deny('financial_denied');
  const caseId='guard_'+createHash('sha256').update('atrio-guardian-v2:'+f.source.targetPath).digest('hex').slice(0,32);
  const proposal={operation:'propose_case',caseId,expectedRevision:f.source.revision,expectedPolicyRevision:f.policy.revision,status:'review'};
  if(!evaluateAuthorization(f.auth,proposal,f.source,f.policy,budget).allowed)return deny('authorization_denied');
  const action=decide(classify(f.body,{}));
  if(!['clear','warn','review'].includes(action))return deny('unexpected_action');
  if(action==='warn'&&!evaluateAuthorization(f.auth,{...proposal,status:'warned'},f.source,f.policy,budget).allowed)return deny('authorization_denied');
  return Object.freeze({ok:true,action,requiresAtomicReservation:action!=='clear',...noRemote});
 }catch{return deny('invalid_fixture');}
}
