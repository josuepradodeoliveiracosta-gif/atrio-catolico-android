// Offline coordination, intentionally never imported by the deployed Worker.
import {evaluateFinancialGate} from './financial-gate.mjs';
import {evaluateAuthorization} from './authorization-policy.mjs';
import {classifyRisk} from './risk-classification.mjs';
import {buildReportQueue} from './report-queue.mjs';
import {transitionAppeal} from './appeals-review.mjs';
const deny = reason => ({ok:false,reason,remoteAuthorized:false,punishmentAuthorized:false});
// Inputs are trusted synthetic test fixtures only. No callbacks, persistence or I/O.
export function previewTriage(f) {
 try {
  const financial=evaluateFinancialGate(f.financialSnapshot,f.estimate,f.now);
  if(!financial.allowed)return deny('financial_denied');
  const authorization=evaluateAuthorization(f.auth,f.proposal,f.source,f.policy,financial);
  if(!authorization.allowed)return deny('authorization_denied');
  const risk=classifyRisk(f.scope,f.events,f.history,f.findings,f.now);
  if(!risk.ok)return deny('risk_denied');
  const counts=[0,0,0,0];
  for(const r of risk.results) { if(r.punishmentAuthorized!==false||!Number.isInteger(r.level)||r.level<0||r.level>3)return deny('risk_denied'); counts[r.level]++; }
  return {ok:true,counts,requiresAtomicReservation:true,remoteAuthorized:false,punishmentAuthorized:false};
 }catch{return deny('invalid_fixture');}
}
export function previewModeration(ctx,rows,now) {
 try { const q=buildReportQueue(ctx,rows,now); if(!q.ok)return deny('queue_denied'); return {ok:true,groups:q.groups.length,reports:q.groups.reduce((n,g)=>n+g.reportCount,0),coverage:'page_only',remoteAuthorized:false,punishmentAuthorized:false}; } catch { return deny('invalid_fixture'); }
}
export function previewAppeal(ctx,record,request,now) {
 try { const r=transitionAppeal(ctx,record,request,now); if(!r.ok)return deny('appeal_denied'); return {ok:true,state:r.record.state,revision:r.record.revision,remoteAuthorized:false,punishmentAuthorized:false}; } catch { return deny('invalid_fixture'); }
}
